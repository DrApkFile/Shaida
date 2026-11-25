// Groth16 with snarkjs (a dependency, GPL-3.0: not bundled) and the pinned ceremony vkey, on a single-threaded bn128
// curve: no worker threads, so Node exits after a verify and a browser needs no worker script. The same wiring as the
// bot's (packages/shaida-underwrite/src/node.ts; measured there: 44 ms and 89 MB for a first verify).
import { INCOME_FINAL_VKEY, type Groth16Proof } from "@shaida/proofs";

interface Snarkjs {
  groth16: { verify(vkey: Readonly<Record<string, unknown>>, signals: string[], proof: Groth16Proof): Promise<boolean> };
}
interface Ffjavascript {
  buildBn128(singleThread: boolean): Promise<unknown>;
}

let loaded: Promise<Snarkjs> | null = null;

export async function groth16Verify(signals: readonly string[], proof: Groth16Proof): Promise<boolean> {
  loaded ??= (async () => {
    const snarkjs = (await import("snarkjs")) as unknown as Snarkjs;
    const ff = (await import("ffjavascript")) as unknown as Ffjavascript;
    const g = globalThis as { curve_bn128?: unknown };
    if (!g.curve_bn128) g.curve_bn128 = await ff.buildBn128(true);
    return snarkjs;
  })();
  loaded.catch(() => { loaded = null; });
  return (await loaded).groth16.verify(INCOME_FINAL_VKEY, [...signals], proof);
}
