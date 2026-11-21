// Gloam's IncrementalMerkleTreePoseidon, rebuilt from an ordered list of leaves (depth 20, zero leaf = 0,
// zeros[i+1] = Poseidon(zeros[i], zeros[i])). ShaidaLedger uses that library for its V/S tree.
import { MAX_LEAVES, TREE_DEPTH } from "./field";
import { hashPair } from "./hash";

export interface MerklePath {
  readonly pathElements: readonly bigint[];
  /** pathIndices[i] = 1 when the node at level i is a right child: the bits of the leaf index. */
  readonly pathIndices: readonly (0 | 1)[];
}

const ZEROS: readonly bigint[] = (() => {
  const zeros = [0n];
  for (let i = 0; i < TREE_DEPTH; i++) zeros.push(hashPair(zeros[i]!, zeros[i]!));
  return zeros;
})();

/** zeros[0..DEPTH]; zeros[DEPTH] is the empty tree's root. */
export const zeroHashes = (): readonly bigint[] => ZEROS;

export class LedgerTree {
  /** layers[0] = leaves, layers[DEPTH] = [root]; a missing right node is the zero hash of its level. */
  private readonly layers: readonly (readonly bigint[])[];

  constructor(leaves: readonly bigint[]) {
    if (BigInt(leaves.length) > MAX_LEAVES) throw new RangeError(`more than 2^${TREE_DEPTH} leaves`);
    const layers: bigint[][] = [[...leaves]];
    for (let level = 0; level < TREE_DEPTH; level++) {
      const below = layers[level]!;
      const above: bigint[] = [];
      for (let i = 0; i < below.length; i += 2) {
        above.push(hashPair(below[i]!, below[i + 1] ?? ZEROS[level]!));
      }
      layers.push(above);
    }
    this.layers = layers;
  }

  get size(): number {
    return this.layers[0]!.length;
  }

  get root(): bigint {
    return this.layers[TREE_DEPTH]![0] ?? ZEROS[TREE_DEPTH]!;
  }

  leaf(index: number): bigint | undefined {
    return this.layers[0]![index];
  }

  path(index: number): MerklePath {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`leaf ${index} is not in a tree of ${this.size}`);
    }
    const pathElements: bigint[] = [];
    const pathIndices: (0 | 1)[] = [];
    let i = index;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const isRight = (i & 1) === 1;
      pathIndices.push(isRight ? 1 : 0);
      pathElements.push(this.layers[level]![isRight ? i - 1 : i + 1] ?? ZEROS[level]!);
      i >>= 1;
    }
    return { pathElements, pathIndices };
  }
}
