// `snarkjs zkey verify` of a zkey against income.r1cs and the Hermez ptau. On success records the zkey with every
// contribution hash it carries (the authoritative list: it comes from the file itself) and keeps the full log.
// Refuses a zkey that does not extend the last verified one, or whose hash for contribution n differs from the one
// its contributor reported (--expect n:hash, whitespace ignored, several separated by commas).
//   PTAU_PATH=… pnpm --filter @shaida/ceremony verify --zkey work/income_0002.zkey --expect "2:<hash they sent>"
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ceremonyPaths, PTAU_BLAKE2B, R1CS, R1CS_SHA256, requireFile } from "./src/config.js";
import { blake2bFile, recordedPath, sha256File } from "./src/files.js";
import { main, parseArgs, required } from "./src/main.js";
import { type Contribution, lastVerified, readRecord, writeRecord } from "./src/record.js";
import { assertSnarkjsVersion, CapturingLogger, verifyFromR1cs } from "./src/snarkjs.js";

function parseExpect(text: string | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (text === undefined) return out;
  for (const part of text.split(",")) {
    const m = /^\s*(\d+)\s*:([\s0-9a-fA-F]+)$/.exec(part);
    const hash = m?.[2]!.replace(/\s+/g, "").toLowerCase();
    if (!m || !/^[0-9a-f]{128}$/.test(hash!)) throw new Error(`--expect "${part}" is not n:<128 hex chars>`);
    out.set(Number(m[1]), hash!);
  }
  return out;
}

/** Why a zkey that verified must still not be recorded, or null. */
function refuseToRecord(got: readonly Contribution[], prev: readonly Contribution[], expect: ReadonlyMap<number, string>): string | null {
  const extendsPrev = got.length > prev.length && prev.every((c, k) => got[k]?.hash === c.hash);
  if (!extendsPrev) return `its contributions do not extend the last verified zkey's ${prev.length}`;
  for (const [n, hash] of expect) {
    const c = got.find((x) => x.n === n);
    if (c?.hash !== hash) return `contribution #${n} in the zkey is ${c?.hash ?? "missing"}, not the hash its contributor reported`;
  }
  return null;
}

main("verify", async () => {
  const args = parseArgs(process.argv.slice(2), ["zkey", "expect"]);
  const paths = ceremonyPaths();
  assertSnarkjsVersion();
  const record = readRecord(paths);
  const zkey = requireFile(resolve(paths.root, required(args, "zkey")), "zkey");
  const expect = parseExpect(args.get("expect"));
  const ptau = requireFile(process.env.PTAU_PATH ?? "", "PTAU_PATH (the Hermez 2^17 ptau)");

  if ((await sha256File(R1CS)) !== R1CS_SHA256) throw new Error("income.r1cs is not the frozen circuit (D13).");
  if ((await blake2bFile(ptau)) !== PTAU_BLAKE2B) throw new Error("PTAU_PATH is not the Hermez 2^17 ptau.");
  const sha = await sha256File(zkey);
  if (record.verified.some((v) => v.zkey.sha256 === sha)) throw new Error(`zkey ${sha} is already verified in the record.`);
  if (record.beaconAnnouncement !== null && record.beacon === null) {
    throw new Error(`the beacon (block ${record.beaconAnnouncement.blockNumber}) is announced: no contribution can be added before it is applied.`);
  }

  if (record.beacon !== null && sha !== record.beacon.out.sha256) throw new Error("the beacon was applied; only its output can be verified now.");

  console.log(`verifying ${zkey} (sha256 ${sha}); this takes a few minutes…`);
  const logger = new CapturingLogger();
  const outcome = await verifyFromR1cs(R1CS, ptau, zkey, logger);
  const refusal = outcome.ok ? refuseToRecord(outcome.contributions, lastVerified(record)?.contributions ?? [], expect) : `the zkey did not verify: ${outcome.why}`;

  // one log per attempt, refused ones included (failed runs stay on record)
  mkdirSync(paths.logs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(paths.logs, `verify-${sha.slice(0, 16)}-${stamp}.txt`);
  const verdict = refusal === null ? "RESULT: ZKey Ok, recorded" : `RESULT: NOT RECORDED (${refusal})`;
  writeFileSync(logFile, `zkey ${recordedPath(zkey)} sha256 ${sha}\n${verdict}\n\n${logger.text()}`);
  if (refusal !== null || !outcome.ok) throw new Error(`${refusal}. Log: ${recordedPath(logFile)}. Nothing was recorded.`);

  record.verified.push({
    zkey: { path: recordedPath(zkey), sha256: sha },
    circuitHash: outcome.circuitHash,
    contributions: outcome.contributions,
    log: recordedPath(logFile),
    at: new Date().toISOString(),
    superseded: null,
  });
  writeRecord(paths, record);
  console.log(`✓ verified; ${outcome.contributions.length} contribution(s) recorded${expect.size ? `, reported hash(es) for #${[...expect.keys()].join(", #")} match` : ""}.`);
  for (const c of outcome.contributions) console.log(`  #${c.n} ${c.name || "(no name)"}: ${c.hash}`);
});
