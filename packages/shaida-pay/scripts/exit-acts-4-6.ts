// PRD §11 exit check, acts 4–6, on `make fork` through the running web app's /api/index and /api/relay, with the
// ceremony's FINAL income key: Ada (demo) proves ≥ 9 tUSD8 from her 3 swept payments for "Landlord Bola" (demo),
// expiring in 30 days; Bola verifies VALID; the attacks are refused by name; one IncomeVerifier.check, one attest.
// Writes evidence/acts-4-6-fork.md (+ .json); a failed run writes evidence/acts-4-6-fork-FAILED-*.md.
// Usage: pnpm --filter @shaida/pay exit:acts-4-6 [--base http://localhost:3100] [--rpc http://127.0.0.1:8555]
import { randomBytes } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { createWalletClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildIncomeBundle, contextOf, datesForRange, decodeFragment, encodeIncomeLink, incomeLinkSchema, leafRangeForPeriod, PUBLIC_SIGNAL_ORDER,
  readerIdHashOf, solidityArgsOf, verifyIncomeLink, type IncomeLink, type IncomeVerification, type VerifyDeps,
} from "@shaida/proofs";
import { fetchCheckedTrees, incomeCandidates, incomeRequestOf, relayClient, timedLeaves, type FlowContext, type RelayRecord } from "../src/index";
import { setUp, type Env } from "./acts-4-6-setup";
import { readDeployment, revocationOn, writeEvidence, type ActRow } from "./evidence";
import { assertFork } from "./fork-setup";
import { proveIncome, verifyIncomeGroth16 } from "./income-node";
import { finalProvers, forkClient, nodeFetch, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const KIND = { slug: "acts-4-6", title: "acts 4–6", command: "pnpm --filter @shaida/pay exit:acts-4-6", personas: "Acme Studio (demo), Mallory (demo, unregistered), Ada (demo) and Landlord Bola (demo)" };
const TUSD = 1_000_000n;
const rows: ActRow[] = [];
const checks: string[] = [];
const verifierAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "function check(Proof proof, uint256[7] signals) view returns (bool)",
  "function attest(Proof proof, uint256[7] signals) returns (bool)",
  "event IncomeProofChecked(uint256 indexed context, uint256 threshold, uint256 count)",
]);
const code = (v: IncomeVerification) => (v.status === "VALID" ? "VALID" : v.error.code);
const must: Env["must"] = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };

async function main() {
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  const ctx: FlowContext = { chainId: 440050, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const relay = relayClient(BASE, nodeFetch);
  const trees = async () => must(await fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep }), "index");
  const settle = async (r: RelayRecord, act: string, what: string) => {
    const s = must(await relay.settle(r.requestId, { sleep, timeoutMs: 60_000 }), `${act} status`);
    if (s.state !== "mined" || s.reverted) throw new Error(`${act} ${what}: ${s.state}${s.reverted ? " (reverted)" : ""}`);
    rows.push({ act, what, fn: s.fn, hash: s.hash, block: s.block ?? "—", gasUsed: s.gasUsed ?? "—" });
    return s;
  };
  const setup = await setUp({ client, rpc: RPC, dep, ctx, relay, rows, trees, settle, must });
  checks.push(`Mallory (unregistered) through the relayer: deposit refused with ${setup.refusals.deposit}, vouched pay refused with ${setup.refusals.pay}; nothing sent`);

  // Act 4: Ada picks what counts and proves it with the final key, for Landlord Bola, expiring in 30 days.
  const t = await trees();
  const leaves = await timedLeaves(t, async (b) => (await client.getBlock({ blockNumber: b })).timestamp);
  const c = incomeCandidates(t, setup.payments, setup.inbox);
  checks.push(`Ada's payments: ${c.countable.length} countable (${c.countable.map((x) => x.amount / TUSD).join(" + ")} tUSD8); not countable: ${c.notCountable.map((x) => `${x.amount / TUSD} tUSD8 ${x.reason}`).join(", ") || "none"}`);
  if (c.countable.length !== 3 || c.notCountable.length !== 1 || c.notCountable[0]?.reason !== "not-vouched") throw new Error("expected 3 countable and Mallory's payment not-vouched");
  const first = leaves.find((l) => l.index === c.countable[0]!.vouchIndex)!;
  const range = must(leafRangeForPeriod(leaves, first.time, ctx.nowSec()), "period");
  const bola = must(readerIdHashOf("Landlord Bola"), "reader");
  const expiry = ctx.nowSec() + 30n * 86_400n;
  const salt = BigInt(`0x${randomBytes(31).toString("hex")}`);
  const ask = (threshold: bigint, payments = c.countable) => buildIncomeBundle(incomeRequestOf(t, payments, { threshold, ...range, context: contextOf(bola, expiry, salt), shareStep: TUSD }));
  const bundle = must(ask(9n * TUSD), "bundle ≥ 9");
  const proofs: IncomeLink["proofs"] = [];
  const proveMs: number[] = [];
  for (const p of bundle.proofs) { const r = await proveIncome(p.input); proofs.push({ proof: r.proof, publicSignals: r.publicSignals }); proveMs.push(r.proveMs); }
  const fragment = encodeIncomeLink({ v: 1, proofs, readerIdHash: bola.toString(), expiry: expiry.toString(), salt: salt.toString() });
  checks.push(`Act 4: ${proofs.length} proof(s) with the final key in node ${process.version}: ${proveMs.join(" + ")} ms; link fragment ${fragment.length} chars`);

  // Act 5: Bola verifies (roots at the snapshot's block, Groth16 with the committed final vkey, dates from leaves).
  const deps = (reader: bigint, now = ctx.nowSec()): VerifyDeps => ({
    readerIdHash: reader, readerCode: null, revocation: revocationOn(client, dep, t.block), now: () => now, verifyGroth16: verifyIncomeGroth16, resolveRange: async (a, b) => datesForRange(leaves, a, b),
    isKnownRoot: (root) => rootReader(client).isKnownRoot(dep.ledger, root, t.block),
  });
  const v = await verifyIncomeLink(fragment, deps(must(readerIdHashOf(" landlord  BOLA "), "reader")));
  if (v.status !== "VALID" || v.threshold !== 9n * TUSD || v.count !== 3n) throw new Error(`Bola sees ${code(v)}, expected VALID ≥ 9 tUSD8 from 3 payments`);
  checks.push(`Act 5: Bola (typed " landlord  BOLA ") sees VALID: ≥ ${v.threshold / TUSD} tUSD8, ${v.count} payments, ${new Date(Number(v.fromDate) * 1000).toISOString()} – ${new Date(Number(v.toDate) * 1000).toISOString()}, expires ${new Date(Number(v.expiry) * 1000).toISOString()}`);

  // Attacks: each must be refused by name.
  const json = incomeLinkSchema.parse((decodeFragment(fragment) as { ok: true; json: unknown }).json);
  const at = PUBLIC_SIGNAL_ORDER.indexOf("threshold");
  const edited = { ...json, proofs: json.proofs.map((p) => ({ ...p, publicSignals: p.publicSignals.map((s, i) => (i === at ? (BigInt(s) + TUSD).toString() : s)) })) };
  const attacks: [string, string, IncomeVerification][] = [
    ["edited threshold (+1 tUSD8 in the public signals)", "ProofInvalid", await verifyIncomeLink(encodeIncomeLink(edited), deps(bola))],
    ["a different reader (Tenant Chidi)", "WrongReader", await verifyIncomeLink(fragment, deps(must(readerIdHashOf("Tenant Chidi"), "reader")))],
    ["opened after its expiry (now = expiry + 1 s)", "ProofExpired", await verifyIncomeLink(fragment, deps(bola, expiry + 1n))],
  ];
  for (const [what, want, got] of attacks) {
    if (code(got) !== want) throw new Error(`attack "${what}": ${code(got)}, expected ${want}`);
    checks.push(`Attack: ${what} → ${code(got)}`);
  }
  const mallory = setup.payments.find((p) => p.note.commitment === c.notCountable[0]!.commitment)!;
  const forced = { ...c.countable[0]!, record: { secretP: BigInt(mallory.note.secret), amount: BigInt(mallory.note.amountWei), payerId: 1n, secretS: BigInt(setup.inbox.find((e) => e.commitment === mallory.note.commitment)!.fresh!.secret), amountS: BigInt(mallory.note.amountWei) } };
  const withMallory = ask(14n * TUSD, [...c.countable, forced]);
  if (withMallory.ok || withMallory.error.code !== "BelowThreshold") throw new Error(`≥ 14 with Mallory's payment forced in: ${withMallory.ok ? "built" : withMallory.error.code}, expected BelowThreshold`);
  checks.push(`Attack: Mallory's swept 5 tUSD8 forced into the witness request as if payer #1 → the builder skips it (no V leaf) and ≥ 14 is ${withMallory.error.code}: ${withMallory.error.message}`);

  // Act 6: IncomeVerifier.check (view, gas 400k) and attest (legacy tx, gas 420k) for the proof.
  const args = solidityArgsOf(proofs[0]!.proof, proofs[0]!.publicSignals);
  const callArgs = [{ a: [...args.proof.a], b: [[...args.proof.b[0]], [...args.proof.b[1]]], c: [...args.proof.c] }, args.signals] as never;
  const ok = await client.call({ to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "check", args: callArgs }), gas: 400_000n });
  if (ok.data !== `0x${"0".repeat(63)}1`) throw new Error(`IncomeVerifier.check returned ${ok.data}`);
  checks.push(`Act 6: IncomeVerifier.check (eth_call, gas 400,000) at ${dep.incomeVerifier} → true`);
  const reader = privateKeyToAccount(generatePrivateKey());
  await client.request({ method: "anvil_setBalance" as never, params: [reader.address, "0xde0b6b3a7640000"] as never });
  const hash: Hex = await createWalletClient({ account: reader, transport: http(RPC) }).sendTransaction({ chain: null, to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "attest", args: callArgs }), gas: 420_000n, type: "legacy" });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`attest reverted (${hash})`);
  const log = receipt.logs.find((l) => l.address.toLowerCase() === dep.incomeVerifier.toLowerCase());
  const ev = log ? decodeEventLog({ abi: verifierAbi, data: log.data, topics: log.topics }) : null;
  rows.push({ act: "6", what: `Bola records the check: IncomeProofChecked(threshold ${ev?.args.threshold ?? "—"}, count ${ev?.args.count ?? "—"})`, fn: "attest (own gas)", hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() });

  writeEvidence({
    kind: KIND, rows, dep, rpc: RPC, base: BASE, checks: [...checks, `Machine: ${cpus()[0]?.model ?? "—"}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GiB RAM`],
    extra: { link: `/v#${fragment}`, proveMs, reader: "Landlord Bola", expiry: expiry.toString() },
  });
}

main().then(
  () => process.exit(0), // snarkjs keeps worker threads alive after proving
  (e: unknown) => {
    writeEvidence({ kind: KIND, rows, failure: e instanceof Error ? e.message : String(e), rpc: RPC, base: BASE, checks });
    console.error(e);
    process.exit(1);
  },
);
