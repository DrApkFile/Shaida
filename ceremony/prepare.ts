// Ceremony step 0: groth16 setup from income.r1cs and the Hermez 2^17 ptau, after checking both hashes. Writes
// work/income_0000.zkey (no contribution yet; deterministic from its inputs) and starts record.json.
//   PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau pnpm --filter @shaida/ceremony prepare-setup
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ceremonyPaths, PTAU_BLAKE2B, PTAU_NAME, R1CS, R1CS_SHA256, requireFile, SNARKJS_VERSION } from "./src/config.js";
import { blake2bFile, recordedPath, sha256File } from "./src/files.js";
import { main } from "./src/main.js";
import { writeRecord } from "./src/record.js";
import { assertSnarkjsVersion, CapturingLogger, newZkey } from "./src/snarkjs.js";

main("prepare", async () => {
  const paths = ceremonyPaths();
  if (existsSync(paths.record)) throw new Error(`${paths.record} exists: the ceremony was already prepared. Nothing was changed.`);
  assertSnarkjsVersion();
  const ptau = requireFile(process.env.PTAU_PATH ?? "", "PTAU_PATH (the Hermez 2^17 ptau)");
  if (basename(ptau) !== PTAU_NAME) console.log(`note: ptau file is named ${basename(ptau)}, expected ${PTAU_NAME}; checking its hash.`);

  console.log(`checking blake2b of ${ptau} (~144 MB)…`);
  const ptauHash = await blake2bFile(ptau);
  if (ptauHash !== PTAU_BLAKE2B) throw new Error(`ptau blake2b is ${ptauHash}, not the Hermez value in briefing/CEREMONY.md. Nothing was written.`);
  console.log("✓ ptau blake2b matches briefing/CEREMONY.md");

  requireFile(R1CS, "income.r1cs (run `make build` first)");
  const r1csHash = await sha256File(R1CS);
  if (r1csHash !== R1CS_SHA256) throw new Error(`income.r1cs sha256 is ${r1csHash}, not the frozen circuit ${R1CS_SHA256} (D12/D13). Nothing was written.`);
  console.log("✓ income.r1cs sha256 matches the frozen circuit");

  mkdirSync(paths.work, { recursive: true });
  const out = join(paths.work, "income_0000.zkey");
  if (existsSync(out)) throw new Error(`${out} exists without a record: move it away first.`);
  await newZkey(R1CS, ptau, out, new CapturingLogger());
  const zkey = { path: recordedPath(out), sha256: await sha256File(out) };
  writeRecord(paths, {
    v: 1,
    dryRun: paths.dryRun,
    snarkjs: SNARKJS_VERSION,
    circuit: { r1cs: recordedPath(R1CS), r1csSha256: r1csHash },
    ptau: { name: PTAU_NAME, blake2b: ptauHash },
    setup: { zkey, at: new Date().toISOString() },
    verified: [],
    beaconAnnouncement: null,
    beacon: null,
    final: null,
  });
  console.log(`✓ ${zkey.path}\n  sha256 ${zkey.sha256}\n  record: ${recordedPath(paths.record)}${paths.dryRun ? " (DRY RUN)" : ""}`);
});
