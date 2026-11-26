// The revoke route (D35): one contract function (Revocations.revoke), the same rails, budget and restart safety as
// every other route. A revoke is permanent, so one record per salt, ever, and never a second send.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, parseTransaction, type Hex } from "viem";
import { memoryKv, type KvClient, type KvScript } from "@shaida/kv";
import { FIELD_ORDER, revokeSaltOf } from "@shaida/proofs";
import { revocationsAbi, status, submit, type RelayDeps, type RelayReply } from "../src/index";
import { CONTRACTS, kvStoreOn, makeEnv, req } from "./helpers/env";

const recordOf = (r: RelayReply) => {
  if (!r.ok) assert.fail(`${r.error.code}: ${r.error.message}`);
  return r.record;
};
/** The fake chain's estimate, set to a revoke's (evidence/revocations-gas.md: 77,784–77,796 gas for the whole tx). */
const env0 = (opts: Parameters<typeof makeEnv>[0] = {}) => {
  const e = makeEnv(opts);
  e.chain.estimate = 77_796n;
  return e;
};
const refusalOf = (r: RelayReply) => {
  if (r.ok) assert.fail(`expected a refusal, got record ${r.record.state}`);
  return r;
};

describe("relayer: revoke (D35)", () => {
  it("R40 a revoke sends exactly one legacy tx: Revocations.revoke(secret), to the Revocations address", async () => {
    const env = env0();
    const body = env.revokeBody(12345n);
    const r = recordOf(await submit("revoke", req(body), env.deps));
    assert.equal(r.state, "pending");
    assert.equal(r.fn, "revoke");
    assert.equal(r.key, `440050:revoke:${revokeSaltOf(12345n)}`);
    assert.equal(env.chain.sent.length, 1);
    const tx = parseTransaction(env.chain.sent[0]!);
    assert.equal(tx.type, "legacy");
    assert.equal(tx.to, CONTRACTS.revocations);
    const call = decodeFunctionData({ abi: revocationsAbi, data: tx.data as Hex });
    assert.equal(call.functionName, "revoke");
    assert.deepEqual(call.args, [12345n]);
    assert.ok(BigInt(r.gas) <= 200_000n, "within the revoke gas cap");
  });

  it("R41 an already revoked link is AlreadyRevoked (409) before anything is simulated, signed or sent", async () => {
    const env = env0();
    const body = env.revokeBody(777n);
    env.chain.revoked.set(revokeSaltOf(777n).toString(), 4_000_000n);
    const r = refusalOf(await submit("revoke", req(body), env.deps));
    assert.equal(r.status, 409);
    assert.equal(r.error.code, "AlreadyRevoked");
    assert.match(r.error.message, /block 4000000.*Nothing was sent/);
    assert.equal(env.chain.didSimulate(), false);
    assert.equal(env.chain.sent.length, 0);
    // and a revert the simulation reports (a revoke mined since the read) is the same named refusal
    const env2 = env0();
    env2.chain.simulation = { ok: false, errorName: "AlreadyRevoked", reason: "reverted" };
    const r2 = refusalOf(await submit("revoke", req(env2.revokeBody(778n)), env2.deps));
    assert.equal(r2.error.code, "AlreadyRevoked");
    assert.equal(env2.chain.sent.length, 0);
  });

  it("R42 the relayer never double-sends a revoke: a lost answer stays unknown, a retry gets that record", async () => {
    const env = env0();
    env.chain.sendMode = "transport";
    const body = env.revokeBody(9n);
    const first = recordOf(await submit("revoke", req(body), env.deps));
    assert.equal(first.state, "unknown");
    assert.equal(first.error?.code, "TxOutcomeUnknown");
    env.chain.sendMode = "ok";
    const again = await submit("revoke", req(body), env.deps);
    assert.equal(recordOf(again).requestId, first.requestId);
    assert.equal(again.ok && again.repeated, true);
    env.chain.mine(first.hash, "success", 77_796n);
    assert.equal(recordOf(await status(first.requestId, env.deps)).state, "mined");
    const later = await submit("revoke", req(body), env.deps);
    assert.equal(recordOf(later).requestId, first.requestId, "a mined revoke answers every later identical request");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R43 a restart after the record was written, and two processes at once, still send one revoke", async () => {
    const kv = memoryKv();
    const env = env0({ kv });
    const body = env.revokeBody(31n);
    const dying: KvClient = { ...kv, run: async (s: KvScript, keys, args) => { const r = await kv.run(s, keys, args); if (s.name === "relay-claim") throw new Error("process died after the write"); return r; } };
    await assert.rejects(submit("revoke", req(body), { ...env.deps, store: kvStoreOn(dying) }), /process died after the write/);
    assert.equal(env.chain.sent.length, 0);
    const restarted: RelayDeps = { ...env.deps, store: kvStoreOn(kv) };
    const again = await submit("revoke", req(body), restarted);
    assert.equal(again.ok && again.repeated, true, "the retry is answered from the persisted record");
    assert.equal(env.chain.sent.length, 0, "nothing sent by the retry");

    const other = env.revokeBody(32n);
    const [a, b] = await Promise.all([submit("revoke", req(other), { ...env.deps, store: kvStoreOn(kv) }), submit("revoke", req(other), { ...env.deps, store: kvStoreOn(kv) })]);
    assert.equal(recordOf(a).requestId, recordOf(b).requestId);
    assert.equal(env.chain.sent.length, 1);
  });

  it("R44 malformed revoke bodies are refused by name: zero, out of field, not decimal, extra fields", async () => {
    const env = env0();
    for (const secret of ["0", FIELD_ORDER.toString(), "0x10", "-1", "01"]) {
      const r = refusalOf(await submit("revoke", req({ chainId: 440050, secret }), env.deps));
      assert.equal(r.error.code, "InputRejected", secret);
    }
    const extra = refusalOf(await submit("revoke", req({ ...env.revokeBody(), to: CONTRACTS.pool }), env.deps));
    assert.equal(extra.error.code, "InputRejected");
    assert.equal(env.chain.sent.length, 0);
  });

  it("R45 a revoke counts against the daily gas budget and is refused past it, with nothing sent", async () => {
    const env = env0({ limits: { dailyGasBudget: 300_000n } });
    recordOf(await submit("revoke", req(env.revokeBody()), env.deps)); // reserves its gas limit
    const r = refusalOf(await submit("revoke", req(env.revokeBody()), env.deps));
    assert.equal(r.error.code, "RelayerBudgetExceeded");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R46 the relayer's logs never carry the revoke secret", async () => {
    const env = env0();
    const secret = 0x1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221n;
    env.chain.sendMode = "transport";
    await submit("revoke", req(env.revokeBody(secret)), env.deps);
    const text = JSON.stringify(env.lines);
    assert.ok(env.lines.length > 0);
    assert.ok(!text.includes(secret.toString()) && !text.includes(secret.toString(16)), "secret in a log line");
  });
});
