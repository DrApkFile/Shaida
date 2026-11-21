// The public random beacon, in two runs:
//   announce: after the last contribution is verified, fixes block head + ~2 h (at 1.012 s per block) in
//             record.json. Commit and push that before the block is mined.
//   apply:    once the block is mined and buried, reads its hash from the Aevum RPC and applies it with
//             `zkey beacon` (2^10 iterations) to the last verified zkey, writing work/income_final.zkey.
//   pnpm --filter @shaida/ceremony beacon announce      |      pnpm --filter @shaida/ceremony beacon apply
// AEVUM_RPC overrides the RPC; its chain must be 44005 (a dry run may also use `make fork`, 440050).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { AEVUM_CHAIN_ID, AEVUM_RPC_DEFAULT, BEACON_ITERATIONS_EXP, BLOCK_SECONDS, ceremonyPaths, FORK_CHAIN_ID, REPO, requireFile } from "./src/config.js";
import { beaconReadiness, cannotAnnounce, pickBeaconBlock } from "./src/beacon-rules.js";
import { recordedPath, sha256File } from "./src/files.js";
import { announcementCommit } from "./src/git.js";
import { main } from "./src/main.js";
import { lastVerified, readRecord, writeRecord } from "./src/record.js";
import { Rpc } from "./src/rpc.js";
import { assertSnarkjsVersion, beacon, CapturingLogger } from "./src/snarkjs.js";

async function connect(dryRun: boolean): Promise<{ rpc: Rpc; chainId: number }> {
  const rpc = new Rpc(process.env.AEVUM_RPC ?? AEVUM_RPC_DEFAULT);
  const chainId = await rpc.chainId();
  const allowed = dryRun ? [AEVUM_CHAIN_ID, FORK_CHAIN_ID] : [AEVUM_CHAIN_ID];
  if (!allowed.includes(chainId)) throw new Error(`${rpc.url} is chain ${chainId}; the beacon must come from ${allowed.join(" or ")}.`);
  return { rpc, chainId };
}

main("beacon", async () => {
  const mode = process.argv[2];
  const paths = ceremonyPaths();
  const record = readRecord(paths);

  if (mode === "announce") {
    const why = cannotAnnounce(record);
    if (why) throw new Error(`${why} Nothing was changed.`);
    const { rpc, chainId } = await connect(paths.dryRun);
    const head = await rpc.head();
    const hours = Number(process.env.BEACON_DELAY_HOURS ?? 2);
    if (!paths.dryRun && hours !== 2) throw new Error("BEACON_DELAY_HOURS is for dry runs; the ceremony uses 2 hours.");
    const { blockNumber, expectedTimestamp } = pickBeaconBlock(head, hours);
    record.beaconAnnouncement = {
      chainId,
      blockNumber,
      forZkey: lastVerified(record)!.zkey,
      headAtAnnouncement: head.number,
      headTimestamp: head.timestamp,
      blockSeconds: BLOCK_SECONDS,
      expectedTimestamp,
      at: new Date().toISOString(),
    };
    writeRecord(paths, record);
    console.log(`✓ beacon block ${blockNumber} on chain ${chainId} (head ${head.number}; expected near ${new Date(expectedTimestamp * 1000).toISOString()}).`);
    if (!paths.dryRun) {
      console.log("Now, before that block is mined:\n  git add ceremony/record.json ceremony/TRANSCRIPT.md");
      console.log(`  git commit -m "Ceremony: announce beacon block ${blockNumber} (Aevum ${chainId})"\n  git push`);
    }
    return;
  }

  if (mode === "apply") {
    assertSnarkjsVersion();
    const a = record.beaconAnnouncement;
    if (a === null) throw new Error("no beacon announced: run `beacon announce` first.");
    if (record.beacon !== null) throw new Error(`the beacon was already applied (${record.beacon.out.path}).`);
    const input = requireFile(resolve(REPO, a.forZkey.path), "announced zkey");
    if ((await sha256File(input)) !== a.forZkey.sha256) throw new Error(`${input} is not the zkey the beacon was announced for.`);
    const { rpc, chainId } = await connect(paths.dryRun);
    if (chainId !== a.chainId) throw new Error(`the beacon was announced on chain ${a.chainId}, this RPC is ${chainId}.`);
    const commit = paths.dryRun ? null : announcementCommit(a.blockNumber);
    const head = await rpc.head();
    const block = await rpc.block(a.blockNumber);
    const ready = beaconReadiness(a, head, block, commit?.committedAt ?? null);
    if (ready.kind !== "ready") throw new Error(`${ready.kind === "wait" ? "not yet" : "refused"}: ${ready.why} Nothing was written.`);
    const again = await rpc.block(a.blockNumber);
    if (again?.hash !== block!.hash) throw new Error(`block ${a.blockNumber} hash changed between two reads (${block!.hash}, ${again?.hash}).`);

    const output = join(paths.work, "income_final.zkey");
    if (existsSync(output)) throw new Error(`${output} exists; move it away first.`);
    const value = block!.hash.slice(2);
    console.log(`applying block ${a.blockNumber} hash ${block!.hash}, 2^${BEACON_ITERATIONS_EXP} iterations…`);
    const hash = await beacon(input, output, `Aevum ${chainId} block ${a.blockNumber}`, value, BEACON_ITERATIONS_EXP, new CapturingLogger());
    record.beacon = {
      chainId,
      blockNumber: a.blockNumber,
      blockHash: block!.hash,
      blockTimestamp: block!.timestamp,
      iterationsExp: BEACON_ITERATIONS_EXP,
      announcementCommit: commit,
      in: a.forZkey,
      out: { path: recordedPath(output), sha256: await sha256File(output) },
      contributionHash: hash,
      at: new Date().toISOString(),
    };
    writeRecord(paths, record);
    console.log(`✓ ${record.beacon.out.path} sha256 ${record.beacon.out.sha256}\n  next: verify it, then finalize.`);
    return;
  }
  throw new Error('usage: beacon announce | beacon apply');
});
