// The circuit, this package and ShaidaLedger must agree on every leaf and root. The contract half of this check is
// contracts/test/IncomeVectors.t.sol, which replays the same vectors through the real ledger.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TUSD8_FIELD, zeroHashes } from "../src/index.js";
import { ledgerVectors } from "../scripts/ledger-vectors.js";
import { PKG, runCircuit } from "./helpers/circuit.js";
import { buildSingleProof } from "./helpers/scenario.js";

const GLOAM_IMT = join(PKG, "../../contracts/lib/gloam/contracts/src/lib/IncrementalMerkleTreePoseidon.sol");
const VECTORS = join(PKG, "../../contracts/test/fixtures/income-vectors.json");

describe("ledger format: circuit = JS = ShaidaLedger", () => {
  it("zero hashes and the empty root equal Gloam's IncrementalMerkleTreePoseidon constants", () => {
    const sol = readFileSync(GLOAM_IMT, "utf8");
    const zeros = [...sol.matchAll(/self\.zeros\[(\d+)\] = (\d+);/g)].map((m) => [Number(m[1]), BigInt(m[2]!)] as const);
    const emptyRoot = sol.match(/uint256 z =\s*(\d+);/);
    assert.equal(zeros.length, 20);
    for (const [i, z] of zeros) assert.equal(zeroHashes()[i], z, `zeros[${i}]`);
    assert.equal(zeroHashes()[20], BigInt(emptyRoot![1]!), "empty root");
  });

  it("the committed vectors are what the generator produces (re-run `pnpm vectors` if not)", () => {
    const committed: unknown = JSON.parse(readFileSync(VECTORS, "utf8"));
    assert.deepEqual(committed, ledgerVectors().json);
  });

  it("the circuit proves income over the vector leaves, so its V and S hashes equal the ledger's", async () => {
    const v = ledgerVectors();
    const r = buildSingleProof({
      ledgerLeaves: v.leaves,
      ledgerRoot: v.root,
      asset: TUSD8_FIELD,
      threshold: 4_000_000n,
      fromIndex: 0n,
      toIndex: 3n,
      context: 7n,
      payments: v.records,
    });
    if (!r.ok) assert.fail(`${r.error.code}: ${r.error.message}`);
    assert.deepEqual(r.value.counted.map((c) => [c.vouchIndex, c.sweepIndex]), [[0, 2], [1, 3]]);
    assert.equal((await runCircuit(r.value.input)).accepted, true);
  });
});
