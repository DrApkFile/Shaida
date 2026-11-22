import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, parseTransaction, type Hex } from "viem";
import { depositorAbi, ledgerAbi, memoBoardAbi, poolAbi, signerAllowedOn, submit, type RelayReply } from "../src/index";
import { CHAIN_ID, CONTRACTS, makeEnv, req } from "./helpers/env";

const codeOf = (r: RelayReply) => (r.ok ? `ok:${r.record.state}` : r.error.code);

describe("relayer rails (run before any simulation)", () => {
  it("R01 rate-limits per IP before the body is parsed", async () => {
    const env = makeEnv({ limits: { perIpPerMinute: 2 } });
    let parsed = 0;
    const counting = { ip: "198.51.100.1", readBody: async () => { parsed++; return {}; } };
    await submit("sweep", counting, env.deps);
    await submit("sweep", counting, env.deps);
    const third = await submit("sweep", counting, env.deps);
    assert.equal(codeOf(third), "RateLimited");
    assert.equal(third.ok ? 0 : third.status, 429);
    assert.equal(parsed, 2, "the third body was never read");
    assert.equal(env.chain.log.length, 0, "no chain call");
  });

  it("R02 refuses a malformed body or an unknown field with InputRejected and no chain call", async () => {
    const env = makeEnv();
    const good = env.sweepBody();
    assert.equal(codeOf(await submit("sweep", req({ ...good, extra: 1 }), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("sweep", req({ ...good, transfer: { ...good.transfer, proof: "0x1234" } }), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("sweep", { ip: "x", readBody: async () => { throw new SyntaxError("bad json"); } }, env.deps)), "InputRejected");
    assert.equal(env.chain.log.length, 0);
  });

  it("R02 refuses a chain the app has no relayer for (NotConfigured)", async () => {
    const env = makeEnv();
    const r = await submit("sweep", req({ ...env.sweepBody(), chainId: 44005 }), env.deps);
    assert.equal(codeOf(r), "NotConfigured");
  });

  it("R03 rate-limits per payer", async () => {
    const env = makeEnv({ limits: { perPayerPerMinute: 1 } });
    env.chain.automine = true;
    assert.equal(codeOf(await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps)), "ok:pending");
    assert.equal(codeOf(await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps)), "RateLimited");
  });

  it("R04 refuses TokenPaused and PayerBlacklisted up front, without simulating", async () => {
    const env = makeEnv();
    env.chain.paused = true;
    assert.equal(codeOf(await submit("deposit", req(await env.depositBody()), env.deps)), "TokenPaused");
    env.chain.paused = false;
    env.chain.blacklisted.add(env.payer.address.toLowerCase());
    assert.equal(codeOf(await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps)), "PayerBlacklisted");
    assert.equal(env.chain.didSimulate(), false);
    assert.ok(env.chain.log.filter((l) => l.startsWith("read:")).every((l) => l.endsWith("@100")), "every read pinned to one block");
  });

  it("R05 X02 refuses an unregistered or revoked payer on the relayed paths", async () => {
    const env = makeEnv();
    env.chain.payers.set(env.payer.address.toLowerCase(), "revoked");
    assert.equal(codeOf(await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps)), "PayerRevoked");
    env.chain.payers.clear();
    assert.equal(codeOf(await submit("deposit", req(await env.depositBody()), env.deps)), "PayerNotRegistered");
    assert.equal(env.chain.didSimulate(), false);
  });

  it("R06 refuses a signature by someone else, or with a window over an hour, before any chain read", async () => {
    const env = makeEnv();
    const other = makeEnv().payer;
    assert.equal(codeOf(await submit("deposit", req(await env.depositBody({ signer: other })), env.deps)), "SignatureInvalid");
    const longWindow = await env.depositBody({ validBefore: BigInt(Math.floor(1_800_000_000_000 / 1000)) + 7200n });
    assert.equal(codeOf(await submit("deposit", req(longWindow), env.deps)), "SignatureInvalid");
    const body = await env.vouchedPayBody();
    const altered = { ...body, transfer: { ...body.transfer, newCommitments: [body.transfer.newCommitments[1], body.transfer.newCommitments[0]] } };
    assert.equal(codeOf(await submit("vouchedPay", req(altered), env.deps)), "SignatureInvalid", "a redirected payment no longer matches the vouch");
    assert.equal(env.chain.log.length, 0);
  });

  it("R07 A2 refuses a clawback of a swept note with AlreadySpent, without simulating", async () => {
    const env = makeEnv();
    const body = await env.vouchedPayBody();
    env.chain.spent.add(body.transfer.nullifier);
    const r = await submit("vouchedPay", req(body), env.deps);
    assert.equal(codeOf(r), "AlreadySpent");
    assert.equal(r.ok ? 0 : r.status, 409);
    assert.equal(env.chain.didSimulate(), false);
  });

  it("R07 refuses an unknown pool root, a seen output note, a duplicate vouch and a memo for an unvouched payment", async () => {
    const env = makeEnv();
    const s = env.sweepBody();
    env.chain.knownRoots.clear();
    assert.equal(codeOf(await submit("sweep", req(s), env.deps)), "UnknownRoot");
    const s2 = env.sweepBody();
    env.chain.seen.add(s2.transfer.newCommitments[1]);
    assert.equal(codeOf(await submit("sweep", req(s2), env.deps)), "InputRejected");
    const v = await env.vouchedPayBody();
    env.chain.vouched.add(v.transfer.newCommitments[0]);
    assert.equal(codeOf(await submit("vouchedPay", req(v), env.deps)), "AlreadyVouched");
    const memo = { chainId: CHAIN_ID, commitment: v.transfer.newCommitments[1], memo: "0x676c6f616d3274" };
    assert.equal(codeOf(await submit("memo", req(memo), env.deps)), "InputRejected");
  });
});

describe("relayer: simulate, gas, one call per function", () => {
  it("R08 maps a simulation revert to its code and sends nothing", async () => {
    const env = makeEnv();
    env.chain.simulation = { ok: false, errorName: "InvalidProof", reason: "execution reverted" };
    assert.equal(codeOf(await submit("sweep", req(env.sweepBody()), env.deps)), "ProofInvalid");
    env.chain.simulation = { ok: false, errorName: null, reason: "FiatTokenV2: invalid signature" };
    assert.equal(codeOf(await submit("deposit", req(await env.depositBody()), env.deps)), "SignatureInvalid");
    env.chain.simulation = { ok: false, errorName: "SomethingNew", reason: "execution reverted" };
    assert.equal(codeOf(await submit("sweep", req(env.sweepBody()), env.deps)), "TxRejected");
    assert.equal(env.chain.sent.length, 0);
  });

  it("R09 refuses an estimate above the function's explicit gas cap", async () => {
    const env = makeEnv();
    env.chain.estimate = 3_100_001n; // sweep cap 3,100,000
    const r = await submit("sweep", req(env.sweepBody()), env.deps);
    assert.equal(codeOf(r), "RelayerBudgetExceeded");
    assert.match(r.ok ? "" : r.error.message, /at most 3100000 for sweep/);
    assert.equal(env.chain.sent.length, 0);
  });

  it("R11 sends a legacy tx with an explicit gas limit = min(estimate × 1.3, cap), to the one contract function", async () => {
    const env = makeEnv();
    env.chain.estimate = 2_000_000n;
    const r = await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps);
    assert.equal(codeOf(r), "ok:pending");
    const tx = parseTransaction(env.chain.sent[0] as Hex);
    assert.equal(tx.type, "legacy");
    assert.equal(tx.gas, 2_600_000n);
    assert.equal(tx.to?.toLowerCase(), CONTRACTS.ledger);
    assert.equal(decodeFunctionData({ abi: ledgerAbi, data: tx.data ?? "0x" }).functionName, "vouchedPayFor");
    env.chain.estimate = 3_000_000n;
    await submit("vouchedPay", req(await env.vouchedPayBody()), env.deps);
    assert.equal(parseTransaction(env.chain.sent[1] as Hex).gas, 3_200_000n, "capped");
  });

  it("R15 each function encodes exactly one call to its own contract", async () => {
    const env = makeEnv();
    env.chain.automine = true;
    await submit("deposit", req(await env.depositBody()), env.deps);
    const v = await env.vouchedPayBody();
    await submit("vouchedPay", req(v), env.deps);
    env.chain.vouched.add(v.transfer.newCommitments[0]);
    env.chain.estimate = 60_000n;
    await submit("memo", req({ chainId: CHAIN_ID, commitment: v.transfer.newCommitments[0], memo: "0x676c6f616d3274" }), env.deps);
    env.chain.estimate = 1_000_000n;
    await submit("sweep", req(env.sweepBody()), env.deps);
    const calls = env.chain.sent.map((raw) => parseTransaction(raw));
    assert.deepEqual(calls.map((t) => t.to?.toLowerCase()), [CONTRACTS.depositor, CONTRACTS.ledger, CONTRACTS.memo, CONTRACTS.ledger]);
    assert.equal(decodeFunctionData({ abi: depositorAbi, data: calls[0]?.data ?? "0x" }).functionName, "depositWithAuthorization");
    assert.equal(decodeFunctionData({ abi: memoBoardAbi, data: calls[2]?.data ?? "0x" }).functionName, "postMemo");
    assert.equal(decodeFunctionData({ abi: ledgerAbi, data: calls[3]?.data ?? "0x" }).functionName, "sweep");
  });

  it("R16 public anvil keys relay only on local chains", () => {
    const anvil0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    assert.equal(signerAllowedOn(anvil0, 440050), true);
    assert.equal(signerAllowedOn(anvil0, 44005), false);
    assert.equal(signerAllowedOn("0x000000000000000000000000000000000000dEaD", 44005), true);
  });
});

describe("relayer: unshield (withdrawals, public by nature)", () => {
  it("R20 refuses another asset, a zero amount, and an app contract or zero address as recipient, with no chain call", async () => {
    const env = makeEnv();
    assert.equal(codeOf(await submit("unshield", req(env.unshieldBody({ asset: "0x000000000000000000000000000000000000dEaD" })), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("unshield", req(env.unshieldBody({ amount: 0n })), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("unshield", req(env.unshieldBody({ to: CONTRACTS.pool })), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("unshield", req(env.unshieldBody({ to: "0x0000000000000000000000000000000000000000" })), env.deps)), "InputRejected");
    assert.equal(codeOf(await submit("unshield", req({ ...env.unshieldBody(), fee: "1" }), env.deps)), "InputRejected");
    assert.equal(env.chain.log.length, 0);
  });

  it("R21 refuses a spent note, an unknown root, a blacklisted recipient and a paused token without simulating", async () => {
    const env = makeEnv();
    const spent = env.unshieldBody();
    env.chain.spent.add(spent.nullifier);
    const r = await submit("unshield", req(spent), env.deps);
    assert.equal(codeOf(r), "AlreadySpent");
    assert.equal(r.ok ? 0 : r.status, 409);
    const unknownRoot = env.unshieldBody();
    env.chain.knownRoots.delete(unknownRoot.root);
    assert.equal(codeOf(await submit("unshield", req(unknownRoot), env.deps)), "UnknownRoot");
    const black = env.unshieldBody();
    env.chain.blacklisted.add(black.to.toLowerCase());
    assert.equal(codeOf(await submit("unshield", req(black), env.deps)), "PayerBlacklisted");
    env.chain.paused = true;
    assert.equal(codeOf(await submit("unshield", req(env.unshieldBody()), env.deps)), "TokenPaused");
    assert.equal(env.chain.didSimulate(), false);
  });

  it("R22 sends exactly pool.unshield with the proof's own recipient and amount, capped at 500,000 gas, once per nullifier", async () => {
    const env = makeEnv();
    env.chain.automine = true;
    env.chain.estimate = 330_000n;
    const body = env.unshieldBody({ amount: 1_500_000n });
    assert.equal(codeOf(await submit("unshield", req(body), env.deps)), "ok:pending");
    const tx = parseTransaction(env.chain.sent[0] as Hex);
    assert.equal(tx.to?.toLowerCase(), CONTRACTS.pool);
    assert.equal(tx.gas, 429_000n);
    const call = decodeFunctionData({ abi: poolAbi, data: tx.data ?? "0x" });
    assert.equal(call.functionName, "unshield");
    assert.deepEqual([String(call.args[4]).toLowerCase(), call.args[5]], [body.to.toLowerCase(), 1_500_000n]);
    const again = await submit("unshield", req(body), env.deps);
    assert.ok(again.ok, "answered from its record");
    assert.equal(env.chain.sent.length, 1, "the same request is answered from its record, not resent");
    env.chain.estimate = 500_001n;
    const big = await submit("unshield", req(env.unshieldBody()), env.deps);
    assert.match(big.ok ? "" : big.error.message, /at most 500000 for unshield/);
  });
});
