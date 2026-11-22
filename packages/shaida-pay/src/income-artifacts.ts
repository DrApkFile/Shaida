// The income circuit's FINAL artifacts (D27), checked by sha256 before use. Only these pins exist: no throwaway key
// can be loaded by this module. fetchBytes is injected (browser fetch, or a file read in Node).
import { shaidaError, type Result } from "@shaida/proofs";
import pins from "../income-artifacts.json";

export const INCOME_ARTIFACTS = pins;

const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface IncomeArtifacts {
  readonly wasm: Uint8Array;
  readonly zkey: Uint8Array;
}

/** Loads income.wasm and income_final.zkey from `base` and refuses either unless its hash is the pinned one. */
export async function loadIncomeArtifacts(base: string, fetchBytes: (url: string) => Promise<ArrayBuffer>, digest: (b: ArrayBuffer) => Promise<ArrayBuffer>): Promise<Result<IncomeArtifacts>> {
  const out: { wasm?: Uint8Array; zkey?: Uint8Array } = {};
  for (const kind of ["wasm", "zkey"] as const) {
    const pin = pins[kind];
    let bytes: ArrayBuffer;
    try {
      bytes = await fetchBytes(`${base}/${pin.file}`);
    } catch (e) {
      return { ok: false, error: shaidaError("NotConfigured", `Could not load ${pin.file} (${e instanceof Error ? e.message : String(e)}). Nothing was built.`) };
    }
    const sha = hexOf(await digest(bytes));
    if (sha !== pin.sha256) {
      return { ok: false, error: shaidaError("NotConfigured", `The served ${pin.file} is not the ceremony's final file (sha256 ${sha.slice(0, 12)}…, pinned ${pin.sha256.slice(0, 12)}…). Nothing was built.`) };
    }
    out[kind] = new Uint8Array(bytes);
  }
  if (!out.wasm || !out.zkey) return { ok: false, error: shaidaError("NotConfigured", "The income circuit did not load. Nothing was built.") };
  return { ok: true, value: { wasm: out.wasm, zkey: out.zkey } };
}
