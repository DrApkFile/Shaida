import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { status, submit, type RelayReply } from "../src/index";
import { makeEnv, req } from "./helpers/env";

const recordOf = (r: RelayReply) => {
  if (!r.ok) assert.fail(`${r.error.code}: ${r.error.message}`);
  return r.record;
};

describe("relayer budget (gas, not a tx count)", () => {
  it("R10 reserves each in-flight call at its gas limit and refuses past the daily gas budget", async () => {
    const env = makeEnv({ limits: { dailyGasBudget: 5_000_000n } });
    env.chain.estimate = 2_000_000n; // limit 2.6M each
    recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    const second = await submit("sweep", req(env.sweepBody()), env.deps);
    assert.equal(second.ok ? "ok" : second.error.code, "RelayerBudgetExceeded", "2.6M reserved + 3.1M cap > 5M");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R10 a mined call settles to its gasUsed and frees the rest of its reservation", async () => {
    const env = makeEnv({ limits: { dailyGasBudget: 5_000_000n } });
    env.chain.estimate = 2_000_000n;
    const first = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    env.chain.mine(first.hash, "success", 1_500_000n);
    assert.equal(recordOf(await status(first.requestId, env.deps)).state, "mined");
    recordOf(await submit("sweep", req(env.sweepBody()), env.deps)); // 1.5M used + 3.1M cap ≤ 5M
  });

  it("R10 refuses when the relayer's balance is below the floor", async () => {
    const env = makeEnv();
    env.chain.balanceWei = 1n;
    const r = await submit("sweep", req(env.sweepBody()), env.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "RelayerUnavailable");
  });
});

describe("relayer: persisted records and unknown outcomes", () => {
  it("R12 a send with no answer is unknown; the same request again returns that record and never resends", async () => {
    const env = makeEnv();
    env.chain.sendMode = "transport";
    const body = env.sweepBody();
    const first = recordOf(await submit("sweep", req(body), env.deps));
    assert.equal(first.state, "unknown");
    assert.equal(first.error?.code, "TxOutcomeUnknown");
    assert.deepEqual(first.history.map((h) => h.state), ["accepted", "unknown"], "persisted with its hash before the send");

    env.chain.sendMode = "ok";
    const again = await submit("sweep", req(body), env.deps);
    assert.equal(recordOf(again).requestId, first.requestId);
    assert.equal(again.ok && again.repeated, true);
    assert.equal(env.chain.sent.length, 1, "no double submit");

    const still = recordOf(await status(first.requestId, env.deps));
    assert.equal(still.state, "unknown", "no receipt, nonce not used: stays unknown");
    env.chain.mine(first.hash, "success", 2_690_000n); // the node had taken it after all
    const settled = recordOf(await status(first.requestId, env.deps));
    assert.equal(settled.state, "mined");
    assert.equal(settled.gasUsed, "2690000");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R13 an unknown tx whose nonce was used by another is dropped; only then may the payment be submitted again", async () => {
    const env = makeEnv();
    env.chain.sendMode = "transport";
    const body = env.sweepBody();
    const first = recordOf(await submit("sweep", req(body), env.deps));
    env.chain.latest = first.nonce + 1; // another tx took the nonce; no receipt for ours
    const dropped = recordOf(await status(first.requestId, env.deps));
    assert.equal(dropped.state, "dropped");
    env.chain.sendMode = "ok";
    const retry = recordOf(await submit("sweep", req(body), env.deps));
    assert.notEqual(retry.requestId, first.requestId);
    assert.equal(retry.state, "pending");
  });

  it("R13 a node refusal drops the record (nothing sent) and releases its reservation", async () => {
    const env = makeEnv({ limits: { dailyGasBudget: 4_000_000n } });
    env.chain.sendMode = { reject: "nonce too low" };
    const r = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    assert.equal(r.state, "dropped");
    assert.equal(r.error?.code, "TxRejected");
    env.chain.sendMode = "ok";
    assert.equal(recordOf(await submit("sweep", req(env.sweepBody()), env.deps)).state, "pending", "budget was released");
  });

  it("R14 a mined but reverted tx is recorded as mined, reverted, TxRejected", async () => {
    const env = makeEnv();
    const r = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    env.chain.mine(r.hash, "reverted", 300_000n);
    const s = recordOf(await status(r.requestId, env.deps));
    assert.equal(s.state, "mined");
    assert.equal(s.reverted, true);
    assert.equal(s.error?.code, "TxRejected");
  });

  it("R14 logs hash, nonce and gas for each state change, never the body", async () => {
    const env = makeEnv();
    const body = await env.vouchedPayBody();
    recordOf(await submit("vouchedPay", req(body), env.deps));
    const text = JSON.stringify(env.lines);
    assert.match(text, /"state":"accepted"/);
    assert.match(text, /"nonce":0/);
    assert.equal(text.includes(body.signature.slice(2, 20)), false);
    assert.equal(text.includes(body.transfer.proof.slice(2, 20)), false);
  });
});
