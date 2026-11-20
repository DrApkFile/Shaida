// Proves in a dedicated Web Worker: loads wasm + zkey once per variant, then witness -> Groth16 prove -> verify,
// timing each step. snarkjs (GPL-3.0) is the browser build copied next to this file.
import type { RunRequest, Timings, Variant, WorkerReply } from "./messages.js";

interface MemFile {
  type: "mem";
  data?: Uint8Array;
}
interface SnarkjsGlobal {
  curves: { getCurveFromName(name: string): Promise<unknown> };
  wtns: { calculate(input: unknown, wasm: Uint8Array, out: MemFile): Promise<void> };
  groth16: {
    prove(zkey: Uint8Array, wtns: Uint8Array): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
declare const self: DedicatedWorkerGlobalScope & { snarkjs: SnarkjsGlobal };
self.importScripts("snarkjs.min.js");
const snarkjs = self.snarkjs;

interface Loaded {
  readonly wasm: Uint8Array;
  readonly zkey: Uint8Array;
  readonly vkey: unknown;
}
const loaded = new Map<Variant, Loaded>();
let curveReady = false;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function run({ variant, input }: RunRequest): Promise<Timings> {
  let zkeyLoadMs: number | null = null;
  let wasmLoadMs: number | null = null;
  let curveInitMs: number | null = null;
  const cold = !loaded.has(variant);
  if (cold) {
    let t = performance.now();
    const zkey = await fetchBytes(`circuits/${variant}.zkey`);
    zkeyLoadMs = performance.now() - t;
    t = performance.now();
    const wasm = await fetchBytes(`circuits/${variant}.wasm`);
    wasmLoadMs = performance.now() - t;
    const vkey: unknown = await (await fetch(`circuits/${variant}_vkey.json`)).json();
    loaded.set(variant, { wasm, zkey, vkey });
  }
  if (!curveReady) {
    const t = performance.now();
    await snarkjs.curves.getCurveFromName("bn128");
    curveInitMs = performance.now() - t;
    curveReady = true;
  }
  const { wasm, zkey, vkey } = loaded.get(variant)!;
  let t = performance.now();
  const wtns: MemFile = { type: "mem" };
  await snarkjs.wtns.calculate(input, wasm, wtns);
  const witnessMs = performance.now() - t;
  if (!wtns.data) throw new Error("witness calculation returned no data");
  t = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns.data);
  const proveMs = performance.now() - t;
  t = performance.now();
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  const verifyMs = performance.now() - t;
  return { cold, zkeyLoadMs, wasmLoadMs, curveInitMs, witnessMs, proveMs, verifyMs, totalMs: witnessMs + proveMs + verifyMs, verified };
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  let reply: WorkerReply;
  try {
    reply = { type: "result", variant: e.data.variant, timings: await run(e.data) };
  } catch (err) {
    reply = { type: "error", variant: e.data.variant, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
