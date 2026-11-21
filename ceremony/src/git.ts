// Finds the commit that first announced the beacon block, and checks it was pushed to origin/master.
import { spawnSync } from "node:child_process";
import { REPO } from "./config.js";
import { recordSchema } from "./record.js";

function git(args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}`.trim() };
}

/** The oldest commit whose ceremony/record.json announces `blockNumber`, with its committer time. */
export function announcementCommit(blockNumber: number): { sha: string; committedAt: number } {
  const log = git(["log", "--reverse", "--format=%H %ct", "--", "ceremony/record.json"]);
  if (log.status !== 0) throw new Error(`git log failed: ${log.out}`);
  for (const line of log.out.split("\n").filter(Boolean)) {
    const [sha, time] = line.split(" ") as [string, string];
    const show = git(["show", `${sha}:ceremony/record.json`]);
    if (show.status !== 0) continue; // the file was deleted in this commit
    const parsed = recordSchema.safeParse(JSON.parse(show.out));
    if (parsed.success && parsed.data.beaconAnnouncement?.blockNumber === blockNumber) {
      const pushed = git(["merge-base", "--is-ancestor", sha, "origin/master"]);
      if (pushed.status !== 0) throw new Error(`announcement commit ${sha} is not in origin/master: push it (and git fetch) first.`);
      return { sha, committedAt: Number(time) };
    }
  }
  throw new Error(`no commit of ceremony/record.json announces block ${blockNumber}: commit and push the announcement first.`);
}
