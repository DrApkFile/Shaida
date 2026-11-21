import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildShieldBoundIntent, verifyGroth16 } from "@gloamtrade/sdk";
import * as snarkjs from "snarkjs";
import { TUSD8_ADDRESS } from "@shaida/proofs";
import { loadCircuit, memProver, type Groth16Lib } from "../src/index";
import { REPO } from "../scripts/node-env";

const CIRCUITS = join(REPO, "contracts/lib/gloam/app/public/circuits");
/** Served file → file on disk. The dev key has the same name one directory up (REALITY_SPIKES: fails on chain). */
const FINAL: Record<string, string> = { "shield.wasm": "shield.wasm", "shield_final.zkey": "final/shield_final.zkey" };
const serve = (files: Record<string, string>) => async (url: string): Promise<ArrayBuffer> => {
  const name = url.split("/").at(-1) ?? "";
  const b = readFileSync(join(CIRCUITS, files[name] ?? assert.fail(`not served: ${name}`)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("browser prover", () => {
  it("P07 refuses a served key that is not Gloam's final ceremony key (the same-named dev key)", async () => {
    const r = await loadCircuit("/gloam", "shield", serve({ ...FINAL, "shield_final.zkey": "shield_final.zkey" }));
    assert.equal(r.ok ? "ok" : r.error.code, "NotConfigured");
    assert.match(r.ok ? "" : r.error.message, /not Gloam's final ceremony file/);
  });

  it("P07 proves from the checked bytes, and the proof verifies against Gloam's final shield vkey", async () => {
    const r = await loadCircuit("/gloam", "shield", serve(FINAL));
    assert.ok(r.ok, r.ok ? "" : r.error.message);
    const seen: { proof: unknown; publicSignals: string[] }[] = [];
    const lib = snarkjs as unknown as Groth16Lib;
    const recording: Groth16Lib = { groth16: { fullProve: async (i, w, z) => { const out = await lib.groth16.fullProve(i, w, z); seen.push(out); return out; } } };
    await buildShieldBoundIntent({ amountWei: 1_000_000n, asset: TUSD8_ADDRESS, chainId: 440050, poolAddress: "0x00000000000000000000000000000000000000a1", prover: memProver(recording, r.value) });
    assert.equal(seen.length, 1);
    const vkey = JSON.parse(readFileSync(join(CIRCUITS, "final/shield_vkey.json"), "utf8")) as object;
    assert.equal(await verifyGroth16(vkey as never, seen[0]!.publicSignals, seen[0]!.proof as never), true);
  });
});
