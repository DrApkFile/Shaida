import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeBoundNotePoseidon, verifyGroth16 } from "@gloamtrade/sdk";
import * as snarkjs from "snarkjs";
import type { Address, Hex } from "viem";
import type { CheckedTrees } from "@shaida/index";
import { LedgerTree, TUSD8_ADDRESS } from "@shaida/proofs";
import {
  afterSubmit, emptyVault, inboxEntrySchema, loadCircuit, memProver, openVault, prepareSweep, prepareWithdraw, sealVault, seen, splitPartOf, startSweep, sweptNotes,
  type FlowContext, type Groth16Lib, type IncomingPayment, type Note,
} from "../src/index";
import { REPO } from "../scripts/node-env";

const CIRCUITS = join(REPO, "contracts/lib/gloam/app/public/circuits");
const FINAL: Record<string, string> = { "unshield.wasm": "unshield.wasm", "unshield_final.zkey": "final/unshield_final.zkey" };
const serve = (files: Record<string, string>) => async (url: string): Promise<ArrayBuffer> => {
  const name = url.split("/").at(-1) ?? "";
  const b = readFileSync(join(CIRCUITS, files[name] ?? assert.fail(`not served: ${name}`)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const TO = "0x00000000000000000000000000000000000000f5" as Address;
const asset = TUSD8_ADDRESS.toLowerCase() as Address;
const noProving = { chainId: 440050, contracts: { pool: POOL }, proveUnshield: async () => assert.fail("must not prove") };

async function note(amount: bigint): Promise<Note> {
  const n = await makeBoundNotePoseidon(amount, asset);
  return { secret: n.secret.toLowerCase() as Hex, commitment: n.commitment.toLowerCase() as Hex, nullifier: n.nullifier.toLowerCase() as Hex, amountWei: amount.toString(), asset };
}

/** A checked-trees stand-in holding exactly these pool leaves (the index and root checks are tested in shaida-index). */
function treesOf(leaves: readonly Hex[]): CheckedTrees {
  const snapshot = { poolLeaves: leaves.map((l) => l.toLowerCase()), ledgerLeaves: [], memos: [] } as unknown as CheckedTrees["snapshot"];
  return { snapshot, block: 100n, pool: new LedgerTree(leaves.map((l) => BigInt(l))), ledger: new LedgerTree([]) };
}

describe("withdraw (pool.unshield of a swept note)", () => {
  it("P08 refuses a note that is not in the checked pool tree, or holds 0, before any proving", async () => {
    const outside = await prepareWithdraw(noProving, treesOf([(await note(1n)).commitment]), await note(1_500_000n), TO);
    assert.equal(outside.ok ? "ok" : outside.error.code, "UnknownRoot");
    const zero = await note(0n);
    const empty = await prepareWithdraw(noProving, treesOf([zero.commitment]), zero, TO);
    assert.equal(empty.ok ? "ok" : empty.error.code, "InputRejected");
  });

  it("P08 lists only swept notes holding money, and a vault written before withdrawals opens with none", async () => {
    const [a, z] = [await note(1_500_000n), await note(0n)];
    const inbox = [{ state: "swept", fresh: a }, { state: "swept", fresh: z }, { state: "sweeping", fresh: await note(7n) }, { state: "seen", fresh: null }];
    assert.deepEqual(sweptNotes(inbox).map((n) => n.amountWei), ["1500000"]);
    const { withdrawals: _, ...older } = emptyVault(440050);
    const opened = await openVault(await sealVault(older as never, "correct horse battery"), "correct horse battery");
    assert.deepEqual(opened.ok ? opened.data.withdrawals : null, []);
  });

  it("F4 a split sweep's part is the largest whole tUSD8 below the payment; 1 tUSD8 or less cannot be split", () => {
    const U = 1_000_000n;
    assert.equal(splitPartOf(1_500_000n, U), U);
    assert.equal(splitPartOf(2n * U, U), U);
    assert.equal(splitPartOf(2_250_000n, U), 2n * U);
    assert.equal(splitPartOf(U, U), null);
    assert.equal(splitPartOf(700_000n, U), null);
    assert.throws(() => splitPartOf(U, 0n), /positive/);
  });

  it("F4 a split sweep's two notes are both listed for withdrawal; a refused sweep forgets both; older vault entries have none", async () => {
    const [part, rest] = [await note(1_000_000n), await note(500_000n)];
    const sweeping = startSweep(seen("0xc1"), part, rest);
    assert.deepEqual(sweptNotes([{ ...sweeping, state: "swept" }]).map((n) => n.amountWei), ["1000000", "500000"]);
    const refused = afterSubmit(sweeping, { ok: false, error: { code: "RateLimited", message: "later" } });
    assert.deepEqual([refused.state, refused.fresh, refused.rest], ["seen", null, null]);
    const older = { commitment: "0xc2", state: "swept", fresh: part, requestId: null, hash: null, lastError: null };
    assert.ok(inboxEntrySchema.safeParse(older).success, "an entry saved before split sweeps still opens");
    assert.deepEqual(sweptNotes([inboxEntrySchema.parse(older)]).map((n) => n.amountWei), ["1000000"]);
  });

  it("F4 refuses a split that leaves nothing in one of the notes, before any proving", async () => {
    const pay = await note(1_500_000n);
    const p: IncomingPayment = { note: pay, privateNote: null, memoBlock: 1n, memoTx: "0x01" };
    const ctx = { chainId: 440050, contracts: { pool: POOL, ledger: POOL, depositor: POOL }, provers: { shield: null, transfer: null }, nowSec: () => 0n } as unknown as FlowContext;
    for (const split of [0n, 1_500_000n, 2_000_000n]) {
      const r = await prepareSweep(ctx, treesOf([pay.commitment]), p, { split });
      assert.equal(r.ok ? "ok" : r.error.code, "InputRejected", `split ${split}`);
    }
  });

  it("P09 proves with Gloam's final unshield key (hash-checked), binding this note, recipient and amount; the proof verifies", async () => {
    const dev = await loadCircuit("/gloam", "unshield", serve({ ...FINAL, "unshield_final.zkey": "unshield_final.zkey" }));
    assert.equal(dev.ok ? "ok" : dev.error.code, "NotConfigured", "the same-named dev key is refused");
    const loaded = await loadCircuit("/gloam", "unshield", serve(FINAL));
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.error.message);
    const seen: { proof: unknown; publicSignals: string[] }[] = [];
    const lib = snarkjs as unknown as Groth16Lib;
    const recording: Groth16Lib = { groth16: { fullProve: async (i, w, z) => { const out = await lib.groth16.fullProve(i, w, z); seen.push(out); return out; } } };
    const n = await note(1_500_000n);
    const t = treesOf([(await note(3n)).commitment, n.commitment]);
    const w = await prepareWithdraw({ chainId: 440050, contracts: { pool: POOL }, proveUnshield: memProver(recording, loaded.value) }, t, n, TO);
    assert.ok(w.ok, w.ok ? "" : w.error.message);
    const body = w.value.body() as { nullifier: string; to: string; amount: string; asset: string; root: string };
    assert.deepEqual([body.nullifier, body.to, body.amount, body.asset], [n.nullifier, TO, "1500000", asset]);
    assert.equal(BigInt(body.root), t.pool.root);
    const vkey = JSON.parse(readFileSync(join(CIRCUITS, "final/unshield_vkey.json"), "utf8")) as object;
    assert.equal(await verifyGroth16(vkey as never, seen[0]!.publicSignals, seen[0]!.proof as never), true);
  });
});
