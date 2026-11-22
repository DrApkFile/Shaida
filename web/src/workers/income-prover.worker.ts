// One income proof, in its own Web Worker (D27): the page starts a fresh worker per proof and terminates it after
// the answer. Proves from the bytes the page already checked against the final pins, then verifies the proof with
// the committed final vkey before answering. Note secrets arrive in `input` and never leave this worker or the page.
import type { CircuitInput, Groth16Proof } from "@shaida/proofs";

export interface ProveRequest {
  readonly wasm: Uint8Array;
  readonly zkey: Uint8Array;
  readonly input: CircuitInput;
  readonly vkey: Readonly<Record<string, unknown>>;
}

export type ProveReply =
  | { readonly ok: true; readonly proof: Groth16Proof; readonly publicSignals: string[]; readonly proveMs: number; readonly verifyMs: number }
  | { readonly ok: false; readonly message: string };

type Mem = { readonly type: "mem"; readonly data: Uint8Array };
interface Snarkjs {
  groth16: {
    fullProve(input: CircuitInput, wasm: Mem, zkey: Mem): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(vkey: Readonly<Record<string, unknown>>, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<ProveRequest>) => void) | null;
  postMessage(m: ProveReply): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  const reply = (m: ProveReply) => scope.postMessage(m);
  try {
    const snarkjs = (await import("snarkjs")) as unknown as Snarkjs;
    const t0 = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(e.data.input, { type: "mem", data: e.data.wasm }, { type: "mem", data: e.data.zkey });
    const t1 = performance.now();
    const ok = await snarkjs.groth16.verify(e.data.vkey, publicSignals, proof);
    const t2 = performance.now();
    if (!ok) { reply({ ok: false, message: "The proof made here does not verify with the final vkey. No link was made." }); return; }
    reply({ ok: true, proof, publicSignals, proveMs: Math.round(t1 - t0), verifyMs: Math.round(t2 - t1) });
  } catch (err) {
    reply({ ok: false, message: `Proving stopped: ${err instanceof Error ? err.message : String(err)}. No link was made.` });
  }
};
