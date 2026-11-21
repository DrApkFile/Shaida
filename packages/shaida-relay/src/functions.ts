// One spec per relayed function: its body, key, gas cap, rails and the single call it may make.
import { encodeFunctionData, parseSignature, type Address, type Hex } from "viem";
import type { z } from "zod";
import { depositorAbi, ledgerAbi, memoBoardAbi } from "./abi";
import { payerRefusal, signerRefusal, spendRefusal, tokenRefusal, windowRefusal } from "./checks";
import type { PinnedReader } from "./reads";
import * as S from "./schemas";
import type { Call, Refusal, RelayContracts, RelayFn } from "./types";
import { depositTypedData, lateVouchTypedData, vouchTypedData } from "./typed-data";

export interface CheckContext {
  readonly chainId: number;
  readonly contracts: RelayContracts;
  readonly nowSec: bigint;
}

export interface FnSpec<B> {
  readonly fn: RelayFn;
  readonly schema: z.ZodType<B, z.ZodTypeDef, unknown>;
  /** Explicit gas limit ceiling; an estimate above it is refused. Measured gas: evidence/fork-gas.md. */
  readonly gasCap: bigint;
  key(b: B): string;
  payer(b: B): Address | null;
  offchain(b: B, ctx: CheckContext): Promise<Refusal | null>;
  onchain(b: B, r: PinnedReader, ctx: CheckContext): Promise<Refusal | null>;
  call(b: B, c: RelayContracts): Call;
}

const transferTuple = (t: S.VouchedPayBody["transfer"]) => ({ proof: t.proof, root: t.root, nullifier: t.nullifier, newCommitments: [t.newCommitments[0], t.newCommitments[1]] as const });

const deposit: FnSpec<S.DepositBody> = {
  fn: "deposit",
  schema: S.depositBody,
  gasCap: 1_600_000n, // measured 1,346,538
  key: (b) => `commitment:${b.commitment}`,
  payer: (b) => b.payer,
  offchain: async (b, ctx) => {
    if (b.validAfter > ctx.nowSec) return { code: "SignatureInvalid", message: "The authorization is not valid yet. Sign again with validAfter 0; nothing was sent." };
    const typed = depositTypedData(ctx.chainId, ctx.contracts.token, { payer: b.payer, depositor: ctx.contracts.depositor, amount: b.amount, validAfter: b.validAfter, validBefore: b.validBefore, commitment: b.commitment });
    return windowRefusal(b.validBefore, ctx.nowSec, "authorization") ?? (await signerRefusal(typed, b.signature, b.payer));
  },
  onchain: async (b, r, ctx) =>
    (await tokenRefusal(r, ctx.contracts, b.payer)) ??
    (await payerRefusal(r, ctx.contracts, b.payer)) ??
    ((await r.bool(ctx.contracts.pool, "commitmentSeen", [b.commitment])) ? { code: "InputRejected", message: "This note is already in the pool. Nothing was sent." } : null),
  call: (b, c) => {
    const { v, r, s, yParity } = parseSignature(b.signature);
    const auth = { validAfter: b.validAfter, validBefore: b.validBefore, v: Number(v ?? BigInt(yParity + 27)), r, s };
    return { to: c.depositor, data: encodeFunctionData({ abi: depositorAbi, functionName: "depositWithAuthorization", args: [b.payer, b.amount, b.commitment, b.shieldProof, auth] }) };
  },
};

const vouchedPay: FnSpec<S.VouchedPayBody> = {
  fn: "vouchedPay",
  schema: S.vouchedPayBody,
  gasCap: 3_200_000n, // measured 2,766,976
  key: (b) => `nullifier:${b.transfer.nullifier}`,
  payer: (b) => b.payer,
  offchain: async (b, ctx) =>
    windowRefusal(b.deadline, ctx.nowSec, "vouch signature") ??
    (await signerRefusal(vouchTypedData(ctx.chainId, ctx.contracts.ledger, b.transfer, b.deadline), b.signature, b.payer)),
  onchain: async (b, r, ctx) =>
    (await tokenRefusal(r, ctx.contracts, b.payer)) ??
    (await payerRefusal(r, ctx.contracts, b.payer)) ??
    (await spendRefusal(r, ctx.contracts, b.transfer)) ??
    ((await r.bool(ctx.contracts.ledger, "vouched", [b.transfer.newCommitments[0]])) ? { code: "AlreadyVouched", message: "This payment already has its vouch. Nothing was sent." } : null),
  call: (b, c) => ({ to: c.ledger, data: encodeFunctionData({ abi: ledgerAbi, functionName: "vouchedPayFor", args: [transferTuple(b.transfer), b.payer, b.deadline, b.signature] }) }),
};

const lateVouch: FnSpec<S.LateVouchBody> = {
  fn: "lateVouch",
  schema: S.lateVouchBody,
  gasCap: 1_200_000n, // one ledger insert (~0.93M) + signature check
  key: (b) => `vouch:${b.commitment}`,
  payer: (b) => b.payer,
  offchain: async (b, ctx) =>
    windowRefusal(b.deadline, ctx.nowSec, "late-vouch signature") ??
    (await signerRefusal(lateVouchTypedData(ctx.chainId, ctx.contracts.ledger, b.commitment, b.deadline), b.signature, b.payer)),
  onchain: async (b, r, ctx) =>
    (await payerRefusal(r, ctx.contracts, b.payer)) ??
    ((await r.bool(ctx.contracts.ledger, "vouched", [b.commitment])) ? { code: "AlreadyVouched", message: "This payment already has its vouch. Nothing was sent." } : null) ??
    ((await r.bool(ctx.contracts.pool, "commitmentSeen", [b.commitment])) ? null : { code: "InputRejected", message: "The pool has no payment with this commitment. Nothing was sent." }),
  call: (b, c) => ({ to: c.ledger, data: encodeFunctionData({ abi: ledgerAbi, functionName: "lateVouchFor", args: [b.commitment, b.payer, b.deadline, b.signature] }) }),
};

const sweep: FnSpec<S.SweepBody> = {
  fn: "sweep",
  schema: S.sweepBody,
  gasCap: 3_100_000n, // measured 2,697,283
  key: (b) => `nullifier:${b.transfer.nullifier}`,
  payer: () => null,
  offchain: async () => null,
  onchain: (b, r, ctx) => spendRefusal(r, ctx.contracts, b.transfer),
  call: (b, c) => ({ to: c.ledger, data: encodeFunctionData({ abi: ledgerAbi, functionName: "sweep", args: [transferTuple(b.transfer)] }) }),
};

const memo: FnSpec<S.MemoBody> = {
  fn: "memo",
  schema: S.memoBody,
  gasCap: 250_000n, // 21k + calldata (≤ 2 KB) + one log
  key: (b) => `memo:${b.commitment}`,
  payer: () => null,
  offchain: async () => null,
  onchain: async (b, r, ctx) =>
    (await r.bool(ctx.contracts.ledger, "vouched", [b.commitment])) ? null : { code: "InputRejected", message: "The relayer posts memos only for vouched payments. Nothing was sent." },
  call: (b, c) => ({ to: c.memo, data: encodeFunctionData({ abi: memoBoardAbi, functionName: "postMemo", args: [b.commitment, b.memo as Hex] }) }),
};

export interface BodyOf {
  deposit: S.DepositBody;
  vouchedPay: S.VouchedPayBody;
  lateVouch: S.LateVouchBody;
  sweep: S.SweepBody;
  memo: S.MemoBody;
}

export const SPECS: { readonly [F in RelayFn]: FnSpec<BodyOf[F]> } = { deposit, vouchedPay, lateVouch, sweep, memo };
