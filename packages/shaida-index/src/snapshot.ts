// The leaf snapshot /api/index serves and the cursor it persists: one JSON document. Bigints travel as decimal
// strings. Parsed with .strict() at every boundary (the server's store, the client's fetch).
import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/, "lowercase 32-byte hex");
const address = z.string().regex(/^0x[0-9a-f]{40}$/, "lowercase address");
const hexBytes = z.string().regex(/^0x([0-9a-f]{2})*$/, "lowercase hex bytes");
const block = z.string().regex(/^(0|[1-9][0-9]*)$/, "decimal block number");

export const vouchLeafSchema = z
  .object({ kind: z.literal("vouch"), index: z.number().int().nonnegative(), leaf: hex32, payerId: z.number().int().positive(), commitment: hex32, block })
  .strict();
export const sweepLeafSchema = z
  .object({ kind: z.literal("sweep"), index: z.number().int().nonnegative(), leaf: hex32, nullifier: hex32, sweepCommitment: hex32, block })
  .strict();
export const ledgerLeafSchema = z.discriminatedUnion("kind", [vouchLeafSchema, sweepLeafSchema]);

export const memoSchema = z.object({ commitment: hex32, memo: hexBytes, block, tx: hex32 }).strict();

export const contractsSchema = z.object({ pool: address, ledger: address, memo: address }).strict();

export const snapshotSchema = z
  .object({
    v: z.literal(1),
    chainId: z.number().int().positive(),
    contracts: contractsSchema,
    /** First block indexed (the earliest deploy block of the three contracts). */
    startBlock: block,
    /** Last block fully read; startBlock − 1 before the first page. The cursor. */
    syncedTo: block,
    /** Pool leaves in insertion order: Shielded commitments, and Transferred newCommitments[0] then [1]. */
    poolLeaves: z.array(hex32),
    ledgerLeaves: z.array(ledgerLeafSchema),
    memos: z.array(memoSchema),
    /**
     * Empty when every leaf index matched its position and the leaf counts matched the contracts' nextIndex at
     * syncedTo. Anything here means the trees are incomplete: no client may build on them.
     */
    problems: z.array(z.string()),
    /** syncedTo at which the counts were last checked against the chain, or null before the first check. */
    checkedAt: block.nullable(),
  })
  .strict();

export type Snapshot = z.infer<typeof snapshotSchema>;
export type LedgerLeaf = z.infer<typeof ledgerLeafSchema>;
export type Memo = z.infer<typeof memoSchema>;
export type Contracts = z.infer<typeof contractsSchema>;

/** Complete = no problem recorded and the counts were checked at the cursor. */
export const isComplete = (s: Snapshot): boolean => s.problems.length === 0 && s.checkedAt === s.syncedTo;

export interface IndexTarget {
  readonly chainId: number;
  readonly contracts: Contracts;
  readonly startBlock: bigint;
}

export function emptySnapshot(t: IndexTarget): Snapshot {
  return {
    v: 1,
    chainId: t.chainId,
    contracts: lower(t.contracts),
    startBlock: t.startBlock.toString(),
    syncedTo: (t.startBlock - 1n).toString(),
    poolLeaves: [],
    ledgerLeaves: [],
    memos: [],
    problems: [],
    checkedAt: null,
  };
}

export const lower = (c: Contracts): Contracts => ({
  pool: c.pool.toLowerCase(),
  ledger: c.ledger.toLowerCase(),
  memo: c.memo.toLowerCase(),
});

/** Whether a stored snapshot belongs to this deployment (same chain, contracts and start block). */
export function sameTarget(s: Snapshot, t: IndexTarget): boolean {
  const c = lower(t.contracts);
  return (
    s.chainId === t.chainId &&
    s.startBlock === t.startBlock.toString() &&
    s.contracts.pool === c.pool &&
    s.contracts.ledger === c.ledger &&
    s.contracts.memo === c.memo
  );
}
