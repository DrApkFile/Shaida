// Withdrawals: pool.unshield of a swept note, in full, to an address the recipient chose. The proof binds the asset,
// recipient and amount, so the relayer only pays the gas. Withdrawals are public and reveal their amounts (LIMITS.md):
// the app never withdraws by itself; the recipient batches them at a quiet time, to a fresh address they control.
import { buildUnshieldIntent, type Prover } from "@gloamtrade/sdk";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { poolIndexOf, type CheckedTrees } from "@shaida/index";
import { shaidaError, type Result } from "@shaida/proofs";
import { sdkPath, type Note } from "./notes";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s.toLowerCase() as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase() as Address);

/** One withdrawal sent from this browser. Its outcome is read from the chain (the note's nullifier), never resent. */
export const withdrawalSchema = z
  .object({ nullifier: hex32, to: address, amountWei: z.string().regex(/^[1-9][0-9]{0,30}$/), requestId: z.string().nullable(), hash: z.string().nullable(), at: z.string() })
  .strict();
export type Withdrawal = z.output<typeof withdrawalSchema>;

export interface WithdrawContext {
  readonly chainId: number;
  readonly contracts: { readonly pool: Address };
  readonly proveUnshield: Prover;
}

export interface PreparedWithdraw {
  readonly note: Note;
  readonly to: Address;
  readonly amount: bigint;
  body(): Record<string, unknown>;
}

const unshieldArgs = z.tuple([z.string().regex(/^0x[0-9a-fA-F]+$/), hex32, hex32, address, address, z.bigint()]);

/** Proves the unshield of `note` (spent in full) to `to`, against the checked pool tree. Nothing is sent here. */
export async function prepareWithdraw(ctx: WithdrawContext, t: CheckedTrees, note: Note, to: Address): Promise<Result<PreparedWithdraw>> {
  const index = poolIndexOf(t, note.commitment);
  if (index < 0) return { ok: false, error: shaidaError("UnknownRoot", "This note is not in the checked pool tree yet. Resync; nothing was sent.") };
  const amount = BigInt(note.amountWei);
  if (amount === 0n) return { ok: false, error: shaidaError("InputRejected", "This note holds 0 tUSD8: there is nothing to withdraw. Nothing was sent.") };
  const intent = await buildUnshieldIntent({
    secretHex: note.secret, amountWei: amount, asset: note.asset, to, path: sdkPath(t.pool, index), prove: ctx.proveUnshield, chainId: ctx.chainId, poolAddress: ctx.contracts.pool,
  });
  const [proof, root, nullifier, asset, recipient, amt] = unshieldArgs.parse(intent.exec.args);
  if (nullifier !== note.nullifier || recipient !== to.toLowerCase() || amt !== amount) throw new Error("the unshield intent does not match the note it was built for");
  const body = { chainId: ctx.chainId, proof: proof.toLowerCase(), root, nullifier, asset, to: recipient, amount: amount.toString() };
  return { ok: true, value: { note, to: recipient, amount, body: () => body } };
}

/** The money in the vault's swept notes: each one can be withdrawn once, in full. Zero notes are left out. */
export function sweptNotes(inbox: readonly { state: string; fresh: Note | null }[]): Note[] {
  return inbox.flatMap((e) => (e.state === "swept" && e.fresh && BigInt(e.fresh.amountWei) > 0n ? [e.fresh] : []));
}
