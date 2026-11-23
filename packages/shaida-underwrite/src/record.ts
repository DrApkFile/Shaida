// "Record decision" (D30): IncomeVerifier.attest for each proof of an APPROVED link, from the bot's own key. Least
// privilege: off unless switched on, a key used for nothing else, a daily count and gas cap claimed atomically before
// anything is signed, one record per proof ever, persisted before the send, and an unclear send never resent.
import { keccak256, type Address, type Hex } from "viem";
import { decodeFragment, incomeLinkSchema, shaidaError, type ShaidaError } from "@shaida/proofs";
import { ATTEST_GAS, proofKeyOf, verifierCallData } from "./calldata";
import type { Decision } from "./decide";
import type { AttestRecord, RecordStore } from "./record-store";

export interface RecorderConfig {
  readonly enabled: boolean;
  /** Attest transactions per UTC day, across every request. */
  readonly dailyCount: number;
  /** Gas limits reserved per UTC day (each attest reserves ATTEST_GAS; nothing is released). */
  readonly dailyGas: bigint;
}
export const RECORDER_DEFAULTS: RecorderConfig = { enabled: false, dailyCount: 3, dailyGas: 3n * ATTEST_GAS };

/** The node answered sendRawTransaction with an error: the tx was not taken. Anything else thrown is "no answer". */
export class SendRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendRefused";
  }
}

export interface RecorderChain {
  readonly chainId: number;
  readonly incomeVerifier: Address;
  /** IncomeVerifier.check as an eth_call with CHECK_GAS: null when it returned true, else the refusal. */
  check(data: Hex): Promise<ShaidaError | null>;
  balance(address: Address): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  pendingNonce(address: Address): Promise<number>;
  sendRaw(raw: Hex): Promise<void>;
  receipt(hash: Hex): Promise<{ readonly status: "success" | "reverted"; readonly gasUsed: bigint; readonly blockNumber: bigint } | null>;
}

export interface AttestTx {
  readonly type: "legacy";
  readonly chainId: number;
  readonly nonce: number;
  readonly to: Address;
  readonly data: Hex;
  readonly gas: bigint;
  readonly gasPrice: bigint;
  readonly value: 0n;
}

export interface RecorderDeps {
  readonly config: RecorderConfig;
  /** null when the bot's key or network is not set up: RecorderUnavailable. */
  readonly chain: RecorderChain | null;
  readonly signer: { readonly address: Address; signTransaction(tx: AttestTx): Promise<Hex> } | null;
  readonly store: RecordStore;
  /** One recording at a time (nonces), across the processes that share the store. */
  readonly withLock: <T>(task: () => Promise<T>) => Promise<T>;
  readonly nowMs: () => number;
  readonly newId: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long one request waits for each receipt before answering with the record still pending. */
  readonly receiptWaitMs: number;
  readonly log: (line: Readonly<Record<string, string | number | null>>) => void;
}

export type RecordOutcome =
  | { readonly ok: true; readonly repeated: boolean; readonly records: readonly AttestRecord[] }
  | { readonly ok: false; readonly error: ShaidaError; readonly records: readonly AttestRecord[] };

const refuse = (code: Parameters<typeof shaidaError>[0], message: string, records: readonly AttestRecord[] = []): RecordOutcome => ({ ok: false, error: shaidaError(code, message), records });
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function recordDecision(decision: Decision, fragment: string, deps: RecorderDeps): Promise<RecordOutcome> {
  if (decision.kind !== "APPROVE") return refuse("InputRejected", `Only an APPROVE is recorded; this decision is ${decision.kind}. Nothing was sent.`);
  if (!deps.config.enabled) return refuse("NotConfigured", "Recording is switched off on this bot. The decision stands; nothing was sent.");
  const decoded = decodeFragment(fragment);
  const link = decoded.ok ? incomeLinkSchema.safeParse(decoded.json) : null;
  if (!link?.success) throw new Error("an APPROVED link no longer parses");
  const proofs = link.data.proofs.map((p) => ({ ...p, key: proofKeyOf(p.proof, p.publicSignals) }));

  const existing = await Promise.all(proofs.map((p) => deps.store.get(p.key)));
  if (existing.every((r) => r !== null)) return { ok: true, repeated: true, records: await Promise.all(existing.map((r) => settle(r!, deps))) };
  if (existing.some((r) => r !== null)) {
    return refuse("AlreadyRecorded", "Some proofs of this link were already recorded by the bot (in another link). Nothing was sent.", existing.filter((r): r is AttestRecord => r !== null));
  }
  const { chain, signer } = deps;
  if (!chain || !signer) return refuse("RecorderUnavailable", "The bot has no recording key for this network. The decision stands; nothing was sent.");

  return deps.withLock(async () => {
    for (const p of proofs) {
      const no = await chain.check(verifierCallData("check", p.proof, p.publicSignals));
      if (no) return refuse(no.code, `IncomeVerifier.check refused proof ${proofs.indexOf(p) + 1}: ${no.message}`);
    }
    const gasPrice = await chain.gasPrice();
    const need = BigInt(proofs.length) * ATTEST_GAS * gasPrice;
    if ((await chain.balance(signer.address)) < need) {
      deps.log({ event: "underwrite-recorder-low-balance", bot: signer.address, needWei: need.toString() });
      return refuse("RecorderUnavailable", "The bot's key does not hold enough gas for this record. The decision stands; nothing was sent.");
    }
    const day = utcDay(deps.nowMs());
    const claimId = deps.newId();
    const at = new Date(deps.nowMs()).toISOString();
    const claimed: AttestRecord[] = proofs.map((p) => ({
      claimId, proofKey: p.key, decisionId: decision.decisionId, policy: `${decision.policy.id}@${decision.policy.version}`, chainId: chain.chainId,
      day, state: "claimed", hash: null, nonce: null, gasLimit: ATTEST_GAS.toString(), gasUsed: null, block: null, error: null, at,
    }));
    const c = await deps.store.claim(day, claimed, { count: deps.config.dailyCount, gas: deps.config.dailyGas, gasEach: ATTEST_GAS });
    if (!c.ok && c.why === "taken") return refuse("AlreadyRecorded", "Another request recorded this proof just now. Nothing was sent.");
    if (!c.ok) {
      const u = await deps.store.usage(day);
      return refuse("AttestCapReached", `Today's record cap is reached (${u.count} of ${deps.config.dailyCount} records, ${u.gas} of ${deps.config.dailyGas} gas reserved). The decision stands; nothing was sent.`);
    }
    const out: AttestRecord[] = [];
    for (const [i, r] of claimed.entries()) {
      const p = proofs[i]!;
      const sent = await signAndSend(r, verifierCallData("attest", p.proof, p.publicSignals), gasPrice, chain, signer, deps);
      out.push(sent);
      if (sent.state !== "pending") return { ok: false, error: shaidaError(sent.state === "unknown" ? "TxOutcomeUnknown" : "TxRejected", sent.error ?? "not sent"), records: [...out, ...claimed.slice(i + 1)] };
    }
    return { ok: true, repeated: false, records: await Promise.all(out.map((r) => settle(r, deps, deps.receiptWaitMs))) };
  });
}

async function signAndSend(r: AttestRecord, data: Hex, gasPrice: bigint, chain: RecorderChain, signer: NonNullable<RecorderDeps["signer"]>, deps: RecorderDeps): Promise<AttestRecord> {
  const tx: AttestTx = { type: "legacy", chainId: chain.chainId, nonce: await chain.pendingNonce(signer.address), to: chain.incomeVerifier, data, gas: ATTEST_GAS, gasPrice, value: 0n };
  const raw = await signer.signTransaction(tx);
  const signed: AttestRecord = { ...r, hash: keccak256(raw), nonce: tx.nonce };
  await deps.store.put(signed); // persisted before the send: a crash after this line leaves a hash to check, never a resend
  deps.log({ event: "underwrite-record", proof: r.proofKey.slice(0, 12), state: "signed", hash: signed.hash, nonce: tx.nonce });
  try {
    await chain.sendRaw(raw);
    return move(signed, "pending", null, deps);
  } catch (e) {
    const why = e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e);
    if (e instanceof SendRefused) return move(signed, "dropped", `The node refused the record (${why}). Nothing was sent; the bot does not retry this proof.`, deps);
    return move(signed, "unknown", `The node did not answer (${why}). The record may have gone through: it is checked by its hash and never sent again.`, deps);
  }
}

async function move(r: AttestRecord, state: AttestRecord["state"], error: string | null, deps: RecorderDeps, extra: Partial<AttestRecord> = {}): Promise<AttestRecord> {
  const next: AttestRecord = { ...r, ...extra, state, error };
  await deps.store.put(next);
  deps.log({ event: "underwrite-record", proof: r.proofKey.slice(0, 12), state, hash: r.hash, nonce: r.nonce });
  return next;
}

/** Reads a sent record's receipt by its hash (waiting up to `waitMs`). Never signs or sends. */
async function settle(r: AttestRecord, deps: RecorderDeps, waitMs = 0): Promise<AttestRecord> {
  if (!r.hash || !deps.chain || (r.state !== "pending" && r.state !== "unknown" && r.state !== "claimed")) return r;
  const started = deps.nowMs();
  for (;;) {
    const receipt = await deps.chain.receipt(r.hash as Hex);
    if (receipt) {
      return move(r, receipt.status === "success" ? "mined" : "reverted", receipt.status === "success" ? null : "IncomeVerifier.attest reverted; nothing was recorded.", deps, { gasUsed: receipt.gasUsed.toString(), block: receipt.blockNumber.toString() });
    }
    if (deps.nowMs() - started >= waitMs) return r;
    await deps.sleep(1_500);
  }
}
