// Node wiring for the engine (server route and CLI): Groth16 with the ceremony's final vkey, ledger reads pinned to a
// checked index snapshot's block, dates and root times from that snapshot. Not imported by browser code.
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { CheckedTrees } from "@shaida/index";
import { datesForRange, INCOME_FINAL_VKEY, type Groth16Proof, type TimedLeaf, type VerifyDeps } from "@shaida/proofs";
import { chainUnreachable, LedgerNotReadable, type UnderwriteDeps } from "./decide";
import { rootFormedAt, type DatedLeaf } from "./root-time";

interface Snarkjs {
  groth16: { verify(vkey: Readonly<Record<string, unknown>>, signals: string[], proof: Groth16Proof): Promise<boolean> };
}
interface Ffjavascript {
  buildBn128(singleThread: boolean): Promise<unknown>;
}

let groth16: Promise<(signals: readonly string[], proof: Groth16Proof) => Promise<boolean>> | null = null;

/**
 * snarkjs groth16.verify with the final vkey, on a single-threaded bn128 curve. By default snarkjs builds the curve
 * with one worker thread per CPU the host reports; measured 2026-11-23 on this laptop (4 CPUs): 731 ms and 146 MB RSS
 * for the first verify, against 44 ms and 89 MB single-threaded. ffjavascript 0.3.1 reuses a curve already in
 * globalThis.curve_bn128, so it is seeded there first (snarkjs is loaded before, since loading ffjavascript resets it).
 */
export const nodeGroth16: VerifyDeps["verifyGroth16"] = async (signals, proof) => {
  groth16 ??= (async () => {
    const snarkjs = (await import("snarkjs")) as unknown as Snarkjs;
    const ff = (await import("ffjavascript")) as unknown as Ffjavascript;
    const g = globalThis as { curve_bn128?: unknown };
    if (!g.curve_bn128) g.curve_bn128 = await ff.buildBn128(true);
    return (s: readonly string[], p: Groth16Proof) => snarkjs.groth16.verify(INCOME_FINAL_VKEY, [...s], p);
  })();
  groth16.catch(() => { groth16 = null; });
  return (await groth16)(signals, proof);
};

/** A checked ledger snapshot with block times: dates for PRD §5 step 8, root times for ProofTooOld. */
export interface LedgerView {
  readonly trees: CheckedTrees;
  readonly timed: readonly TimedLeaf[];
  readonly dated: readonly DatedLeaf[];
}

/** `blockTime` is called once per distinct block; the caller may cache across views (block times never change). */
export async function ledgerViewOf(trees: CheckedTrees, blockTime: (block: bigint) => Promise<bigint>): Promise<LedgerView> {
  const times = new Map<string, Promise<bigint>>();
  const timeOf = (b: string) => {
    let p = times.get(b);
    if (!p) { p = blockTime(BigInt(b)); times.set(b, p); }
    return p;
  };
  const leaves = await Promise.all(trees.snapshot.ledgerLeaves.map(async (l) => ({ l, time: await timeOf(l.block) })));
  return {
    trees,
    timed: leaves.map(({ l, time }) => ({ index: l.index, time, vouch: l.kind === "vouch" })),
    dated: leaves.map(({ l, time }) => ({ leaf: BigInt(l.leaf), time })),
  };
}

const ledgerAbi = parseAbi(["function isKnownRoot(bytes32 root) view returns (bool)"]);
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export interface NodeDepsOptions {
  readonly client: PublicClient;
  readonly ledger: Address;
  readonly now: () => bigint;
  /** Loads (once per deps) the checked snapshot; may throw LedgerNotReadable. Any other failure reads as ChainUnreachable. */
  readonly view: () => Promise<LedgerView>;
  readonly verifyGroth16?: VerifyDeps["verifyGroth16"];
}

/** The engine's deps over a real chain. The ledger is loaded only when a step needs it (a malformed link reads nothing). */
export function nodeUnderwriteDeps(o: NodeDepsOptions): UnderwriteDeps {
  let loaded: Promise<LedgerView> | null = null;
  const view = (): Promise<LedgerView> =>
    (loaded ??= o.view().catch((e: unknown) => {
      throw e instanceof LedgerNotReadable ? e : chainUnreachable("the ledger index", e);
    }));
  return {
    now: o.now,
    isKnownRoot: async (root) => {
      const v = await view();
      try {
        return await o.client.readContract({ address: o.ledger, abi: ledgerAbi, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: v.trees.block });
      } catch (e) {
        throw chainUnreachable("ShaidaLedger.isKnownRoot", e);
      }
    },
    verifyGroth16: o.verifyGroth16 ?? nodeGroth16,
    resolveRange: async (from, to) => datesForRange((await view()).timed, from, to),
    rootTime: async (root) => rootFormedAt((await view()).dated, root),
  };
}
