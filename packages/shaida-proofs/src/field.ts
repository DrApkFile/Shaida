/** BN254 scalar field order: every circuit signal and Poseidon input is below it. */
export const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Ledger tree depth, equal to Gloam's IncrementalMerkleTreePoseidon.DEPTH. */
export const TREE_DEPTH = 20 as const;
export const MAX_LEAVES = 1n << BigInt(TREE_DEPTH);

/** Payment slots in one income.circom proof (BUILD_CONTRACT: frozen; D12). */
export const INCOME_SLOTS = 4 as const;

/** Proofs in one bundle (D12): a period holds at most INCOME_SLOTS × MAX_BUNDLE_PROOFS = 32 payments. */
export const MAX_BUNDLE_PROOFS = 8 as const;

/**
 * Default rounding step for each proof's threshold share in a bundle (D13): whole tUSD8 (6 decimals). A share capped
 * at its proof's sum then shows that sum only to the step. A request may ask for a coarser step (a multiple of this).
 */
export const SHARE_STEP = 1_000_000n;

/** Leaf tags, equal to ShaidaLedger.VOUCH_TAG / SWEEP_TAG and the circuit's VOUCH_TAG() / SWEEP_TAG(). */
export const VOUCH_TAG = 1n;
export const SWEEP_TAG = 2n;

/** income.circom bounds: each amount < 2^64; a proof's threshold < 2^68 (above any sum of its 4 amounts). */
export const AMOUNT_LIMIT = 1n << 64n;
export const THRESHOLD_LIMIT = 1n << 68n;

/** tUSD8 on Aevum testnet 44005, as a field element (Gloam encodes an asset as BigInt(address)). */
export const TUSD8_ADDRESS = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
export const TUSD8_FIELD = BigInt(TUSD8_ADDRESS);
