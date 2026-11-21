// Recipient side: open the memo board with the receive key (in the browser), derive each payment's state from the
// checked snapshot, and build the sweep into a fresh note only the recipient knows.
import { buildPrivateSendIntent, decodeNotePackage, isSealedTicket, noteCommitmentPoseidon, noteNullifierPoseidon, openSealedTicket, fieldToHex, hexToField, type ReceiveKey } from "@gloamtrade/sdk";
import { hexToString, type Address, type Hex } from "viem";
import { poolIndexOf, type CheckedTrees, type Memo } from "@shaida/index";
import { TUSD8_ADDRESS, shaidaError, type Result } from "@shaida/proofs";
import type { FlowContext } from "./payer";
import { sdkPath, toNote, transferOf, type Note } from "./notes";

export interface IncomingPayment {
  readonly note: Note;
  /** The payer's private note, readable only here. */
  readonly privateNote: string | null;
  readonly memoBlock: bigint;
  readonly memoTx: Hex;
}

/** Why a memo is not a payment to this key. Expected for most memos: the board is shared by everyone. */
type NotOurs = "not-a-ticket" | "sealed-to-someone-else" | "wrong-network" | "does-not-open-commitment";

async function openOne(m: Memo, key: ReceiveKey, ctx: Pick<FlowContext, "chainId" | "contracts">): Promise<IncomingPayment | NotOurs> {
  const text = hexToString(m.memo as Hex).trim();
  if (!isSealedTicket(text)) return "not-a-ticket";
  let plain: string;
  try {
    plain = await openSealedTicket(text, key);
  } catch {
    return "sealed-to-someone-else"; // AES-GCM refuses a ticket sealed to another key: that is the normal case
  }
  const pack = decodeNotePackage(plain);
  const asset = TUSD8_ADDRESS.toLowerCase();
  if (pack.pool.toLowerCase() !== ctx.contracts.pool || pack.asset.toLowerCase() !== asset || (pack.chainId !== undefined && pack.chainId !== ctx.chainId)) return "wrong-network";
  const commitment = fieldToHex(await noteCommitmentPoseidon(hexToField(pack.secret), BigInt(pack.amountWei), pack.asset));
  if (commitment.toLowerCase() !== m.commitment || pack.commitment.toLowerCase() !== m.commitment) return "does-not-open-commitment";
  const nullifier = fieldToHex(await noteNullifierPoseidon(hexToField(pack.secret), hexToField(commitment)));
  return {
    note: toNote({ secret: pack.secret, commitment, nullifier, amountWei: pack.amountWei, asset }),
    privateNote: pack.note ?? null,
    memoBlock: BigInt(m.block),
    memoTx: m.tx as Hex,
  };
}

/** Payments sealed to `key`, oldest first, one per commitment (a repeated memo is ignored). */
export async function openInbox(memos: readonly Memo[], key: ReceiveKey, ctx: Pick<FlowContext, "chainId" | "contracts">): Promise<IncomingPayment[]> {
  const out = new Map<string, IncomingPayment>();
  for (const m of memos) {
    if (out.has(m.commitment)) continue;
    const opened = await openOne(m, key, ctx);
    if (typeof opened !== "string") out.set(m.commitment, opened);
  }
  return [...out.values()];
}

/** What the checked snapshot says about one payment. `isSpent` is read at the snapshot's block. */
export type ChainView =
  | { readonly kind: "not-in-pool" }
  | { readonly kind: "unvouched" }
  | { readonly kind: "unspent" }
  | { readonly kind: "swept"; readonly sweepCommitment: Hex; readonly sweepLeafIndex: number }
  | { readonly kind: "spent-elsewhere" };

export async function chainViewOf(t: CheckedTrees, p: IncomingPayment, isSpent: (nullifier: Hex, block: bigint) => Promise<boolean>): Promise<ChainView> {
  if (poolIndexOf(t, p.note.commitment) < 0) return { kind: "not-in-pool" };
  const sweep = t.snapshot.ledgerLeaves.find((l) => l.kind === "sweep" && l.nullifier === p.note.nullifier);
  if (sweep && sweep.kind === "sweep") return { kind: "swept", sweepCommitment: sweep.sweepCommitment as Hex, sweepLeafIndex: sweep.index };
  if (await isSpent(p.note.nullifier, t.block)) return { kind: "spent-elsewhere" };
  const vouched = t.snapshot.ledgerLeaves.some((l) => l.kind === "vouch" && l.commitment === p.note.commitment);
  return vouched ? { kind: "unspent" } : { kind: "unvouched" };
}

export interface PreparedSweep {
  /** The recipient's fresh note. Store it BEFORE submitting: if the sweep lands, it is the only copy of the money. */
  readonly fresh: Note;
  readonly transfer: ReturnType<typeof transferOf>;
  body(): Record<string, unknown>;
}

/** Moves the whole payment into a fresh note (and a zero change note), as Gloam's sweepReceivedNote does. */
export async function prepareSweep(ctx: FlowContext, t: CheckedTrees, p: IncomingPayment): Promise<Result<PreparedSweep>> {
  const index = poolIndexOf(t, p.note.commitment);
  if (index < 0) return { ok: false, error: shaidaError("UnknownRoot", "This payment is not in the checked pool tree yet. Resync; nothing was sent.") };
  const amount = BigInt(p.note.amountWei);
  const intent = await buildPrivateSendIntent({
    secretHex: p.note.secret, amountInWei: amount, amountPayWei: amount, asset: p.note.asset as Address, path: sdkPath(t.pool, index),
    prove: ctx.provers.transfer, chainId: ctx.chainId, poolAddress: ctx.contracts.pool,
  });
  const transfer = transferOf(intent.exec);
  return { ok: true, value: { fresh: toNote(intent.paymentNote), transfer, body: () => ({ chainId: ctx.chainId, transfer }) } };
}
