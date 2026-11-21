// Takes the latest verified zkey off the chain without deleting anything: its record entry and verify log stay,
// marked superseded with the reason, and its file moves to work/superseded/. The next contribution then starts
// again from the previous active zkey (or the setup). Refused once the beacon is announced.
//   pnpm --filter @shaida/ceremony supersede --sha256 <zkey sha256> --reason "why"
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ceremonyPaths, REPO } from "./src/config.js";
import { recordedPath, sha256File } from "./src/files.js";
import { main, parseArgs, required } from "./src/main.js";
import { latestZkeySha, readRecord, writeRecord } from "./src/record.js";
import { cannotSupersede } from "./src/supersede-rules.js";

main("supersede", async () => {
  const args = parseArgs(process.argv.slice(2), ["sha256", "reason"]);
  const paths = ceremonyPaths();
  const record = readRecord(paths);
  const sha = required(args, "sha256").toLowerCase();
  const reason = required(args, "reason").trim();
  if (reason.length < 10) throw new Error("give a reason of at least 10 characters. Nothing was changed.");
  const why = cannotSupersede(record, sha);
  if (why) throw new Error(`${why} Nothing was changed.`);
  const entry = record.verified.find((v) => v.zkey.sha256 === sha)!;

  // move the file aside (only if it is the recorded file, unchanged) so the redo can use the same name
  const file = resolve(REPO, entry.zkey.path);
  let movedTo: string | null = null;
  if (existsSync(file)) {
    if ((await sha256File(file)) !== sha) throw new Error(`${file} is not the recorded zkey (sha256 differs); move it yourself first. Nothing was changed.`);
    const dir = join(paths.work, "superseded");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${basename(file, ".zkey")}-${sha.slice(0, 8)}.zkey`);
    if (existsSync(target)) throw new Error(`${target} exists. Nothing was changed.`);
    renameSync(file, target);
    movedTo = recordedPath(target);
  }
  entry.superseded = { reason, movedTo, at: new Date().toISOString() };
  writeRecord(paths, record);
  console.log(`✓ ${entry.zkey.path} (sha256 ${sha}) marked superseded; its entry and log (${entry.log}) stay in the record.`);
  console.log(movedTo ? `  file moved to ${movedTo}` : "  file was not on this machine; nothing moved.");
  console.log(`  the next contribution starts from sha256 ${latestZkeySha(record)}.`);
});
