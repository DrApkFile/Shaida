// In-browser Groth16 proving from bytes whose sha256 matches the pins (gloam-artifacts.json). The bytes are proved
// from directly (snarkjs reads `{type: "mem"}`), so what was checked is what is used. snarkjs is injected.
import { packGroth16Proof, type Prover } from "@gloamtrade/sdk";
import { shaidaError, type Result } from "@shaida/proofs";
import pins from "../gloam-artifacts.json";

type Mem = { readonly type: "mem"; readonly data: Uint8Array };
export interface Groth16Lib {
  groth16: { fullProve(input: Record<string, string | string[]>, wasm: Mem, zkey: Mem): Promise<{ proof: unknown; publicSignals: string[] }> };
}

export type Circuit = "shield" | "transfer" | "unshield";
export const ARTIFACT_FILES = { shield: pins.shield, transfer: pins.transfer, unshield: pins.unshield } as const;

const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Fetches one circuit's wasm and final key from `base` and refuses either if its hash is not the pinned one. */
export async function loadCircuit(base: string, circuit: Circuit, fetchBytes: (url: string) => Promise<ArrayBuffer>): Promise<Result<{ wasm: Mem; zkey: Mem }>> {
  const out: Partial<Record<"wasm" | "zkey", Mem>> = {};
  for (const kind of ["wasm", "zkey"] as const) {
    const pin = ARTIFACT_FILES[circuit][kind];
    let bytes: ArrayBuffer;
    try {
      bytes = await fetchBytes(`${base}/${pin.file}`);
    } catch (e) {
      return { ok: false, error: shaidaError("NotConfigured", `Could not load the ${circuit} circuit (${e instanceof Error ? e.message : String(e)}). Nothing was built.`) };
    }
    const sha = hexOf(await crypto.subtle.digest("SHA-256", bytes));
    if (sha !== pin.sha256) {
      return { ok: false, error: shaidaError("NotConfigured", `The served ${pin.file} is not Gloam's final ceremony file (sha256 ${sha.slice(0, 12)}…). Nothing was built.`) };
    }
    out[kind] = { type: "mem", data: new Uint8Array(bytes) };
  }
  if (!out.wasm || !out.zkey) return { ok: false, error: shaidaError("NotConfigured", `The ${circuit} circuit did not load. Nothing was built.`) };
  return { ok: true, value: { wasm: out.wasm, zkey: out.zkey } };
}

export function memProver(lib: Groth16Lib, a: { wasm: Mem; zkey: Mem }): Prover {
  return async (input) => {
    const { proof, publicSignals } = await lib.groth16.fullProve(input, a.wasm, a.zkey);
    return { proofBytes: packGroth16Proof(proof as Parameters<typeof packGroth16Proof>[0]), publicSignals };
  };
}
