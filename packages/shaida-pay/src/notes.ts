// Gloam notes as Shaida keeps them, and the conversions to the SDK's shapes.
import { z } from "zod";
import type { Address, Hex } from "viem";
import type { PoseidonMerklePath } from "@gloamtrade/sdk";
import type { LedgerTree } from "@shaida/proofs";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s.toLowerCase() as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase() as Address);
/** Base units. Zero is a real note: the change of a pay that spends a whole note. */
const amount = z.string().regex(/^(0|[1-9][0-9]{0,30})$/);

/** A spendable note. `secret` is the money: it never leaves the browser except inside a proof or a sealed memo. */
export const noteSchema = z.object({ secret: hex32, commitment: hex32, nullifier: hex32, amountWei: amount, asset: address }).strict();
export type Note = z.output<typeof noteSchema>;

/** The SDK's NoteExport (seed dropped: Shaida never makes short links). */
export const toNote = (n: { secret: string; commitment: string; nullifier: string; amountWei: string; asset: string }): Note =>
  noteSchema.parse({ secret: n.secret, commitment: n.commitment, nullifier: n.nullifier, amountWei: n.amountWei, asset: n.asset });

/** A membership path in the SDK's format, from a checked tree. */
export function sdkPath(tree: LedgerTree, leafIndex: number): PoseidonMerklePath {
  const p = tree.path(leafIndex);
  const leaf = tree.leaf(leafIndex);
  if (leaf === undefined) throw new RangeError(`no leaf ${leafIndex}`);
  return { leafIndex, leaf, pathElements: [...p.pathElements], pathIndices: p.pathIndices.map(Number), root: tree.root };
}

const transferArgs = z.tuple([z.string(), hex32, hex32, z.tuple([hex32, hex32])]);
const shieldArgs = z.tuple([z.string(), z.bigint(), hex32, z.string().regex(/^0x[0-9a-fA-F]*$/)]);

/** The pool.transfer arguments of a built SDK intent, checked. */
export function transferOf(exec: { args: readonly unknown[] }): { proof: Hex; root: Hex; nullifier: Hex; newCommitments: [Hex, Hex] } {
  const [proof, root, nullifier, cs] = transferArgs.parse(exec.args);
  return { proof: proof.toLowerCase() as Hex, root, nullifier, newCommitments: [cs[0], cs[1]] };
}

/** The pool.shieldBound arguments of a built SDK intent, checked. */
export function shieldOf(exec: { args: readonly unknown[] }): { amount: bigint; commitment: Hex; proof: Hex } {
  const [, amt, commitment, proof] = shieldArgs.parse(exec.args);
  return { amount: amt, commitment, proof: proof.toLowerCase() as Hex };
}
