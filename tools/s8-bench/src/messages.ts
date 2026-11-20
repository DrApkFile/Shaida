// Page <-> worker protocol for spike S8.
import type { CircuitInput } from "@shaida/proofs";

export type Variant = "income8" | "income4";

export interface RunRequest {
  readonly type: "run";
  readonly variant: Variant;
  readonly input: CircuitInput;
}

export interface Timings {
  /** First run in this worker (always, with a fresh worker per run): fetched wasm and zkey and set up the curve. */
  readonly cold: boolean;
  readonly zkeyLoadMs: number | null;
  readonly wasmLoadMs: number | null;
  readonly curveInitMs: number | null;
  readonly witnessMs: number;
  readonly proveMs: number;
  readonly verifyMs: number;
  /** witness + prove + verify (loads excluded; they are listed separately). */
  readonly totalMs: number;
  readonly verified: boolean;
}

export type WorkerReply =
  | { readonly type: "result"; readonly variant: Variant; readonly timings: Timings }
  | { readonly type: "error"; readonly variant: Variant; readonly message: string };
