// Payer side: a gasless deposit (the payer only signs EIP-3009), then vouched private pays to a recipient's
// Gloam receive address, each with a sealed memo for the recipient's inbox.
import { buildPrivateSendIntent, buildShieldBoundIntent, encodeNotePackage, sealToReceiveTag, isReceiveTag, type Prover } from "@gloamtrade/sdk";
import { stringToHex, type Address, type Hex } from "viem";
import { poolIndexOf, type CheckedTrees } from "@shaida/index";
import { TUSD8_ADDRESS, shaidaError, type Result } from "@shaida/proofs";
import { depositTypedData, vouchTypedData } from "@shaida/relay";
import { sdkPath, shieldOf, toNote, transferOf, type Note } from "./notes";

export interface FlowContext {
  readonly chainId: number;
  readonly contracts: { readonly pool: Address; readonly ledger: Address; readonly depositor: Address };
  readonly provers: { readonly shield: Prover; readonly transfer: Prover };
  readonly nowSec: () => bigint;
}

/** Signatures are asked for 30 minutes (the relayer accepts up to an hour). */
export const SIGNATURE_WINDOW_SECONDS = 1800n;
const ASSET = TUSD8_ADDRESS.toLowerCase() as Address;

export interface PreparedDeposit {
  /** The new note. Store it (encrypted) BEFORE asking for the signature: it is the only copy. */
  readonly note: Note;
  readonly typedData: ReturnType<typeof depositTypedData>;
  /** The /api/relay/deposit body once the payer has signed `typedData`. */
  body(signature: Hex): Record<string, unknown>;
}

export async function prepareDeposit(ctx: FlowContext, payer: Address, amount: bigint): Promise<PreparedDeposit> {
  const intent = await buildShieldBoundIntent({ amountWei: amount, asset: ASSET, chainId: ctx.chainId, poolAddress: ctx.contracts.pool, prover: ctx.provers.shield });
  const { commitment, proof } = shieldOf(intent.exec);
  const note = toNote({ secret: intent.note.secret, commitment, nullifier: intent.note.nullifier, amountWei: amount.toString(), asset: ASSET });
  const validBefore = ctx.nowSec() + SIGNATURE_WINDOW_SECONDS;
  const typedData = depositTypedData(ctx.chainId, ASSET, { payer, depositor: ctx.contracts.depositor, amount, validAfter: 0n, validBefore, commitment });
  return {
    note,
    typedData,
    body: (signature) => ({ chainId: ctx.chainId, payer, amount: amount.toString(), commitment, shieldProof: proof, validAfter: "0", validBefore: validBefore.toString(), signature }),
  };
}

export interface PreparedPay {
  /** The recipient's note (the payer knows its secret until the recipient sweeps). */
  readonly payment: Note;
  /** What stays with the payer. Store it before submitting. */
  readonly change: Note;
  readonly transfer: ReturnType<typeof transferOf>;
  /** UTF-8 bytes of the sealed ticket (gloam2t.…), as GloamPayMemo stores it. */
  readonly memo: Hex;
  readonly typedData: ReturnType<typeof vouchTypedData>;
  body(signature: Hex): Record<string, unknown>;
  memoBody(): Record<string, unknown>;
}

/** Spends `source` into a payment of `amount` to `recipientTag` plus change. Refuses before proving. */
export async function preparePay(
  ctx: FlowContext,
  trees: CheckedTrees,
  args: { readonly payer: Address; readonly source: Note; readonly amount: bigint; readonly recipientTag: string; readonly privateNote?: string },
): Promise<Result<PreparedPay>> {
  if (!isReceiveTag(args.recipientTag)) return { ok: false, error: shaidaError("InputRejected", "That is not a Gloam receive address (gloamr1.…). Nothing was sent.") };
  const have = BigInt(args.source.amountWei);
  if (args.amount <= 0n || args.amount > have) {
    return { ok: false, error: shaidaError("InputRejected", `The amount must be between 1 base unit and this note's ${have}. Nothing was sent.`) };
  }
  const index = poolIndexOf(trees, args.source.commitment);
  if (index < 0) return { ok: false, error: shaidaError("UnknownRoot", "Your note is not in the checked pool tree yet. Resync; nothing was sent.") };

  const intent = await buildPrivateSendIntent({
    secretHex: args.source.secret, amountInWei: have, amountPayWei: args.amount, asset: ASSET, path: sdkPath(trees.pool, index),
    prove: ctx.provers.transfer, chainId: ctx.chainId, poolAddress: ctx.contracts.pool,
  });
  const transfer = transferOf(intent.exec);
  const payment = toNote(intent.paymentNote);
  const change = toNote(intent.changeNote);
  const pack = encodeNotePackage({ pool: ctx.contracts.pool, asset: ASSET, amountWei: payment.amountWei, secret: payment.secret, commitment: payment.commitment, chainId: ctx.chainId, ...(args.privateNote ? { note: args.privateNote } : {}) });
  const memo = stringToHex(await sealToReceiveTag(pack, args.recipientTag));
  const deadline = ctx.nowSec() + SIGNATURE_WINDOW_SECONDS;
  const typedData = vouchTypedData(ctx.chainId, ctx.contracts.ledger, transfer, deadline);
  return {
    ok: true,
    value: {
      payment, change, transfer, memo, typedData,
      body: (signature) => ({ chainId: ctx.chainId, payer: args.payer, transfer, deadline: deadline.toString(), signature }),
      memoBody: () => ({ chainId: ctx.chainId, commitment: payment.commitment, memo }),
    },
  };
}
