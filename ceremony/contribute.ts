// One phase-2 contribution, for any contributor: input zkey in, output zkey out, contribution hash printed. The
// input's sha256 must be one the record knows (the setup or a verified zkey) or the one given with --in-sha256.
// Entropy is typed at a hidden prompt; nothing about it is stored. Recording happens later, in verify.
//   pnpm --filter @shaida/ceremony contribute --in work/income_0000.zkey --out work/income_0001.zkey --name "Your name"
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ceremonyPaths, requireFile } from "./src/config.js";
import { readEntropy } from "./src/entropy.js";
import { sha256File } from "./src/files.js";
import { main, parseArgs, required } from "./src/main.js";
import { cannotContributeTo } from "./src/supersede-rules.js";
import { readRecord } from "./src/record.js";
import { assertSnarkjsVersion, CapturingLogger, contribute } from "./src/snarkjs.js";

const pretty = (hex: string) => hex.match(/.{8}/g)!.reduce((s, w, i) => s + (i % 4 === 0 ? "\n\t\t" : " ") + w, "");

main("contribute", async () => {
  const args = parseArgs(process.argv.slice(2), ["in", "out", "name", "in-sha256"]);
  const paths = ceremonyPaths();
  assertSnarkjsVersion();
  const input = requireFile(resolve(paths.root, required(args, "in")), "input zkey");
  const output = resolve(paths.root, required(args, "out"));
  const name = required(args, "name");
  if (existsSync(output)) throw new Error(`${output} exists; pick a new file name. Nothing was written.`);

  const inSha = await sha256File(input);
  const expected = args.get("in-sha256");
  if (expected !== undefined) {
    if (expected.toLowerCase() !== inSha) throw new Error(`input sha256 is ${inSha}, not ${expected}. Do not contribute to this file.`);
  } else {
    const r = readRecord(paths);
    if (r.beaconAnnouncement !== null) throw new Error("the beacon is announced: the contributions are closed. Nothing was written.");
    const why = cannotContributeTo(r, inSha);
    if (why) throw new Error(`${why} Nothing was written.`);
  }
  console.log(`✓ input sha256 ${inSha}`);

  const entropy = await readEntropy(paths);
  const hash = await contribute(input, output, name, entropy, new CapturingLogger(false));
  const outSha = await sha256File(output);
  console.log(`\n✓ contribution written: ${output}`);
  console.log(`  output sha256: ${outSha}`);
  console.log(`  Contribution Hash:${pretty(hash)}`);
  console.log("\nSend the output file and both hashes. Delete any note of your entropy; it was not saved anywhere.");
});
