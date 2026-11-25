// Withdrawals on `make fork`, through the running web app's /api/relay/unshield: Acme Studio (demo) pays Ada (demo)
// 3 + 4 + 2 tUSD8 and Mallory (demo, unregistered) 5; Ada sweeps all four and proves ≥ 9 tUSD8 for Landlord Bola (demo).
// Then Ada withdraws all her swept notes in one batch to a fresh address, which forwards the tUSD8 to a treasury
// address; the attacks on the route are refused by name; and the proof link made before still verifies after.
// Writes evidence/withdraw-fork.md (+ .json); a failed run writes evidence/withdraw-fork-FAILED-*.md.
// Usage: pnpm --filter @shaida/pay exit:withdraw [--base http://localhost:3100] [--rpc http://127.0.0.1:8555]
import { randomBytes } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildIncomeBundle, contextOf, datesForRange, encodeIncomeLink, leafRangeForPeriod, readerIdHashOf, solidityArgsOf, verifyIncomeLink, type IncomeLink, type VerifyDeps } from "@shaida/proofs";
import { fetchCheckedTrees, incomeCandidates, incomeRequestOf, prepareWithdraw, relayClient, sweptNotes, timedLeaves, type FlowContext, type RelayRecord, type WithdrawContext } from "../src/index";
import { setUp, type Env } from "./acts-4-6-setup";
import { readDeployment, revocationOn, writeEvidence, type ActRow } from "./evidence";
import { assertFork } from "./fork-setup";
import { proveIncome, verifyIncomeGroth16 } from "./income-node";
import { finalProvers, finalUnshieldProver, forkClient, isSpentReader, nodeFetch, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const KIND = { slug: "withdraw", title: "withdrawals (unshield through the relayer)", command: "pnpm --filter @shaida/pay exit:withdraw", personas: "Acme Studio (demo), Mallory (demo, unregistered), Ada (demo) and Landlord Bola (demo)" };
const TUSD = 1_000_000n;
const TUSD8 = "0x456569838f1d43009a91eba4263147afd7233483" as Address;
const rows: ActRow[] = [];
const checks: string[] = [];
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"]);
const verifierAbi = parseAbi(["struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }", "function check(Proof proof, uint256[7] signals) view returns (bool)"]);
const must: Env["must"] = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };

async function main() {
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  const ctx: FlowContext = { chainId: 440050, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const wctx: WithdrawContext = { chainId: 440050, contracts: { pool: dep.pool }, proveUnshield: finalUnshieldProver() };
  const relay = relayClient(BASE, nodeFetch);
  const trees = async () => must(await fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep }), "index");
  const settle = async (r: RelayRecord, act: string, what: string) => {
    const s = must(await relay.settle(r.requestId, { sleep, timeoutMs: 60_000 }), `${act} status`);
    if (s.state !== "mined" || s.reverted) throw new Error(`${act} ${what}: ${s.state}${s.reverted ? " (reverted)" : ""}`);
    rows.push({ act, what, fn: s.fn, hash: s.hash, block: s.block ?? "—", gasUsed: s.gasUsed ?? "—" });
    return s;
  };
  const setup = await setUp({ client, rpc: RPC, dep, ctx, relay, rows, trees, settle, must });

  // Before: Ada proves ≥ 9 tUSD8 from her three registered payments (final income key), as in act 4.
  const t0 = await trees();
  const leaves = await timedLeaves(t0, async (b) => (await client.getBlock({ blockNumber: b })).timestamp);
  const c = incomeCandidates(t0, setup.payments, setup.inbox);
  const first = leaves.find((l) => l.index === c.countable[0]!.vouchIndex)!;
  const range = must(leafRangeForPeriod(leaves, first.time, ctx.nowSec()), "period");
  const bola = must(readerIdHashOf("Landlord Bola"), "reader");
  const expiry = ctx.nowSec() + 30n * 86_400n;
  const salt = BigInt(`0x${randomBytes(31).toString("hex")}`);
  const bundle = must(buildIncomeBundle(incomeRequestOf(t0, c.countable, { threshold: 9n * TUSD, ...range, context: contextOf(bola, expiry, salt), shareStep: TUSD })), "bundle ≥ 9");
  const proofs: IncomeLink["proofs"] = [];
  for (const p of bundle.proofs) { const r = await proveIncome(p.input); proofs.push({ proof: r.proof, publicSignals: r.publicSignals }); }
  const fragment = encodeIncomeLink({ v: 1, proofs, readerIdHash: bola.toString(), expiry: expiry.toString(), salt: salt.toString() });
  const verifyNow = async () => {
    const t = await trees();
    const deps: VerifyDeps = { readerIdHash: bola, readerCode: null, revocation: revocationOn(client, dep, t.block), now: ctx.nowSec, verifyGroth16: verifyIncomeGroth16, resolveRange: async (a, b) => datesForRange(leaves, a, b), isKnownRoot: (root) => rootReader(client).isKnownRoot(dep.ledger, root, t.block) };
    const v = await verifyIncomeLink(fragment, deps);
    const args = solidityArgsOf(proofs[0]!.proof, proofs[0]!.publicSignals);
    const callArgs = [{ a: [...args.proof.a], b: [[...args.proof.b[0]], [...args.proof.b[1]]], c: [...args.proof.c] }, args.signals] as never;
    const onChain = await client.call({ to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "check", args: callArgs }), gas: 400_000n });
    return { verdict: v.status === "VALID" ? "VALID" : v.error.code, onChain: onChain.data === `0x${"0".repeat(63)}1` };
  };
  const before = await verifyNow();
  if (before.verdict !== "VALID" || !before.onChain) throw new Error(`before withdrawing: ${before.verdict}, on chain ${before.onChain}`);
  checks.push(`Before withdrawing: Ada's link (≥ 9 tUSD8, 3 payments, for Landlord Bola) → ${before.verdict}; IncomeVerifier.check → true`);

  // Batch withdrawal: every swept note, in full, to a fresh address Ada controls.
  const fresh = privateKeyToAccount(generatePrivateKey());
  const notes = sweptNotes(setup.inbox);
  const total = notes.reduce((a, n) => a + BigInt(n.amountWei), 0n);
  let firstBody: Record<string, unknown> | null = null;
  for (const n of notes) {
    const w = must(await prepareWithdraw(wctx, await trees(), n, fresh.address), "prepareWithdraw");
    firstBody ??= w.body();
    await settle(must(await relay.post("unshield", w.body()), "unshield"), "withdraw", `Ada withdraws ${Number(w.amount) / 1e6} tUSD8 to a fresh address`);
  }
  const isSpent = isSpentReader(client, dep.pool);
  const head = await client.getBlockNumber();
  const spent = await Promise.all(notes.map((n) => isSpent(n.nullifier, head)));
  const got = await client.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [fresh.address] });
  if (got !== total || spent.some((s) => !s)) throw new Error(`fresh address holds ${got}, expected ${total}; spent ${spent}`);
  checks.push(`Batch: ${notes.length} swept notes (${notes.map((n) => Number(n.amountWei) / 1e6).join(" + ")} tUSD8) withdrawn to a fresh address, which now holds ${Number(got) / 1e6} tUSD8; every note's nullifier is spent`);

  // Attacks on the route, each refused by name with nothing sent.
  const sentBefore = rows.length;
  const firstSent = firstBody as { nullifier: string; to: string };
  const retry = await relay.post("unshield", firstBody!);
  const firstHash = rows.find((r) => r.act === "withdraw")!.hash;
  if (!retry.ok || retry.value.hash !== firstHash) throw new Error(`identical retry: ${retry.ok ? retry.value.hash : retry.error.code}, expected the first record ${firstHash}`);
  checks.push(`Identical retry of the first withdrawal → answered from its record (${firstHash.slice(0, 12)}…), not resent`);
  const thief = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const again = await relay.post("unshield", { ...firstBody!, to: thief });
  const stolen = await relay.post("unshield", { ...firstBody!, nullifier: `0x${randomBytes(32).toString("hex")}`, to: thief });
  const toPool = await relay.post("unshield", { ...firstBody!, nullifier: `0x${randomBytes(32).toString("hex")}`, to: dep.pool });
  const attacks: [string, string, string][] = [
    ["the withdrawn note withdrawn again, to another address", "AlreadySpent", again.ok ? `sent (${again.value.state})` : again.error.code],
    ["a withdrawal proof with its recipient changed (and a fresh nullifier)", "ProofInvalid", stolen.ok ? `sent (${stolen.value.state})` : stolen.error.code],
    ["a withdrawal to the pool contract itself", "InputRejected", toPool.ok ? `sent (${toPool.value.state})` : toPool.error.code],
  ];
  for (const [what, want, gotCode] of attacks) {
    if (gotCode !== want) throw new Error(`attack "${what}": ${gotCode}, expected ${want}`);
    checks.push(`Attack: ${what} → ${gotCode}; nothing sent`);
  }
  if (rows.length !== sentBefore || firstSent.to !== fresh.address.toLowerCase()) throw new Error("an attack produced a transaction");

  // Forward: the fresh address moves the tUSD8 on to the treasury (its own gas, set by anvil here).
  const treasury = privateKeyToAccount(generatePrivateKey()).address;
  await client.request({ method: "anvil_setBalance" as never, params: [fresh.address, "0x2386f26fc10000"] as never });
  const hash: Hex = await createWalletClient({ account: fresh, transport: http(RPC) }).sendTransaction({ chain: null, to: TUSD8, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [treasury, total] }), type: "legacy" });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`forward reverted (${hash})`);
  rows.push({ act: "forward", what: `fresh address forwards ${Number(total) / 1e6} tUSD8 to the treasury`, fn: "tUSD8 transfer (own gas)", hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });
  const atTreasury = await client.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [treasury] });
  if (atTreasury !== total) throw new Error(`treasury holds ${atTreasury}, expected ${total}`);
  checks.push(`Forward: the treasury holds ${Number(atTreasury) / 1e6} tUSD8`);

  const after = await verifyNow();
  if (after.verdict !== "VALID" || !after.onChain) throw new Error(`after withdrawing: ${after.verdict}, on chain ${after.onChain}`);
  checks.push(`After withdrawing: the same link → ${after.verdict}; IncomeVerifier.check → true (withdrawals spend pool notes; the ledger's V and S leaves stay)`);

  writeEvidence({ kind: KIND, rows, dep, rpc: RPC, base: BASE, checks: [...checks, `Machine: ${cpus()[0]?.model ?? "—"}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GiB RAM`] });
}

main().then(
  () => process.exit(0), // snarkjs keeps worker threads alive after proving
  (e: unknown) => {
    writeEvidence({ kind: KIND, rows, failure: e instanceof Error ? e.message : String(e), rpc: RPC, base: BASE, checks });
    console.error(e);
    process.exit(1);
  },
);
