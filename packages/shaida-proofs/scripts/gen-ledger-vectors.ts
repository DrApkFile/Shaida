// Writes contracts/test/fixtures/income-vectors.json. test/ledger-format.test.ts fails if the file is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PKG } from "../test/helpers/circuit.js";
import { ledgerVectors } from "./ledger-vectors.js";

export const VECTORS_FILE = join(PKG, "../../contracts/test/fixtures/income-vectors.json");
writeFileSync(VECTORS_FILE, `${JSON.stringify(ledgerVectors().json, null, 2)}\n`);
console.log(`✓ ${VECTORS_FILE}`);
