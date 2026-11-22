// How many Redis commands the relayer spends, for the Upstash free tier's 500K a month (D29). Counted on the fake,
// which counts one per command as Upstash bills them (an EVAL is one command).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryKv } from "@shaida/kv";
import { status, submit } from "../src/index";
import { makeEnv, req } from "./helpers/env";

describe("relayer on Redis: command budget", () => {
  it("R30 a relayed sweep costs at most 8 Redis commands, a status poll at most 2", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const before = kv.commands();
    const r = await submit("sweep", req(env.sweepBody()), env.deps);
    const perSubmit = kv.commands() - before;
    assert.ok(r.ok);
    const mid = kv.commands();
    await status(r.record.requestId, env.deps);
    const perStatus = kv.commands() - mid;
    console.info(`commands: submit ${perSubmit}, status ${perStatus}`);
    assert.ok(perSubmit <= 8, `submit used ${perSubmit}`);
    assert.ok(perStatus <= 2, `status used ${perStatus}`);
  });
});
