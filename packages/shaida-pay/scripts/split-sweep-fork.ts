// D32 F4 on the fork first: does an income proof still work when a payment is swept into two notes? On `make fork`
// through the running web app's /api/index and /api/relay, with Gloam's final keys and the income FINAL key.
// Acme (demo) pays Ada (demo) 2, 1.5 and 1 tUSD8; Ada sweeps the first two split (1 + 1, 1 + 0.5) and the third
// whole (1 tUSD8 cannot be split in whole tUSD8). Then:
//   proof A: "≥ 2 tUSD8 from 1 payment" over the first payment alone. Its sweep note holds only 1, so this passes only
//            if the circuit counts the payment's amount, not the sweep note's;
//   proof B: "≥ 4 from 3 payments" over all three (4.5 in all);
// each checked with snarkjs and IncomeVerifier.check (eth_call), proof B attested once for its gas; then the two notes
// of the 1.5 payment are withdrawn separately to a fresh address (1 and 0.5). Demo personas; fork only.
// Writes evidence/split-sweep-fork.md and .json. Usage: pnpm --filter @shaida/pay split-sweep:fork [--base …] [--rpc …]
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateReceiveKey } from "@gloamtrade/sdk";
import { buildIncomeBundle, contextOf, readerIdHashOf, solidityArgsOf, type IncomeLink } from "@shaida/proofs";
import { createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  fetchCheckedTrees, incomeCandidates, incomeRequestOf, openInbox, prepareDeposit, preparePay, prepareSweep, prepareWithdraw, relayClient,
  seen, splitPartOf, startSweep, sweptNotes, type FlowContext, type InboxEntry, type IncomingPayment, type RelayRecord,
} from "../src/index";
import { readDeployment } from "./evidence";
import { assertFork, mintTusd8, registerPayer } from "./fork-setup";
import { proveIncome, verifyIncomeGroth16 } from "./income-node";
import { finalProvers, finalUnshieldProver, forkClient, nodeFetch, REPO, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const U = 1_000_000n;
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
const verifierAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "function check(Proof proof, uint256[7] signals) view returns (bool)",
  "function attest(Proof proof, uint256[7] signals) returns (bool)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const must = <T>(r: Res<T>, what: string): T => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };
const usd = (x: bigint) => (Number(x) / 1e6).toString();

const rows: { what: string; hash: string; block: string; gasUsed: string }[] = [];
const checks: string[] = [];

async function main() {
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  const ctx: FlowContext = { chainId: 440050, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const relay = relayClient(BASE, nodeFetch);
  const trees = async () => must(await fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep }), "index");
  const send = async (route: Parameters<typeof relay.post>[0], body: Parameters<typeof relay.post>[1], what: string) => {
    for (;;) {
      const r = await relay.post(route, body);
      if (!r.ok && r.error.code === "RateLimited") { console.log("· RateLimited (nothing sent): waiting 65 s"); await sleep(65_000); continue; }
      const s = must(await relay.settle(must(r, what).requestId, { sleep, timeoutMs: 60_000 }), `${what} status`) as RelayRecord;
      if (s.state !== "mined" || s.reverted || !s.hash) throw new Error(`${what}: ${s.state}${s.reverted ? " (reverted)" : ""}`);
      rows.push({ what, hash: s.hash, block: s.block ?? "—", gasUsed: s.gasUsed ?? "—" });
      console.log(`· ${what}: ${s.hash} (${s.gasUsed ?? "—"} gas)`);
      return s;
    }
  };

  const acme = privateKeyToAccount(generatePrivateKey());
  await registerPayer(client, RPC, dep.registry, acme.address, "Acme Studio (demo)");
  await mintTusd8(client, RPC, acme.address, 5n * U);
  const d = await prepareDeposit(ctx, acme.address, 5n * U);
  await send("deposit", d.body(await acme.signTypedData(d.typedData)), "Acme deposits 5 tUSD8");
  let funds = d.note;
  const ada = await generateReceiveKey();
  for (const [k, amount] of [[1, 2n * U], [2, 1_500_000n], [3, U]] as const) {
    const pay = must(await preparePay(ctx, await trees(), { payer: acme.address, source: funds, amount, recipientTag: ada.tag }), `pay ${k}`);
    await send("vouchedPay", pay.body(await acme.signTypedData(pay.typedData)), `P${k}: Acme → Ada ${usd(amount)} tUSD8 (vouched)`);
    await send("memo", pay.memoBody(), `memo ${k}`);
    funds = pay.change;
  }

  const payments: IncomingPayment[] = await openInbox((await trees()).snapshot.memos, ada, ctx);
  if (payments.length !== 3) throw new Error(`Ada's inbox opened ${payments.length} payments, expected 3`);
  const inbox: InboxEntry[] = [];
  for (const [k, p] of payments.entries()) {
    const part = splitPartOf(BigInt(p.note.amountWei), U);
    const s = must(await prepareSweep(ctx, await trees(), p, part === null ? {} : { split: part }), `prepareSweep ${k + 1}`);
    const shape = s.rest ? `split ${usd(BigInt(s.fresh.amountWei))} + ${usd(BigInt(s.rest.amountWei))}` : "whole";
    await send("sweep", s.body(), `Ada sweeps P${k + 1} (${usd(BigInt(p.note.amountWei))} tUSD8), ${shape}`);
    inbox.push({ ...startSweep(seen(p.note.commitment), s.fresh, s.rest), state: "swept" });
  }

  const t = await trees();
  const c = incomeCandidates(t, payments, inbox);
  checks.push(`incomeCandidates: ${c.countable.length} countable (${c.countable.map((x) => `${usd(x.amount)} tUSD8, sweep note ${usd(x.record.amountS)}`).join("; ")}), ${c.notCountable.length} not countable`);
  if (c.countable.length !== 3) throw new Error(`expected 3 countable payments, got ${c.countable.length}: ${JSON.stringify(c.notCountable.map((x) => x.reason))}`);

  const reader = must(readerIdHashOf("Landlord Bola"), "reader");
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + 30n * 86_400n;
  const salt = BigInt(`0x${randomBytes(31).toString("hex")}`);
  const ask = (pays: typeof c.countable, threshold: bigint) => must(buildIncomeBundle(incomeRequestOf(t, pays, {
    threshold, fromIndex: BigInt(pays[0]!.vouchIndex), toIndex: BigInt(pays[pays.length - 1]!.vouchIndex), context: contextOf(reader, expiry, salt), shareStep: U,
  })), `bundle ≥ ${usd(threshold)}`);
  const attestFrom = privateKeyToAccount(generatePrivateKey());
  await client.request({ method: "anvil_setBalance" as never, params: [attestFrom.address, "0xde0b6b3a7640000"] as never });
  const proofs: Record<string, unknown>[] = [];
  for (const [name, pays, threshold, record] of [["A", [c.countable[0]!], 2n * U, false], ["B", c.countable, 4n * U, true]] as const) {
    const b = ask(pays, threshold);
    if (b.proofs.length !== 1) throw new Error(`proof ${name}: ${b.proofs.length} proofs, expected 1`);
    const r = await proveIncome(b.proofs[0]!.input);
    const local = await verifyIncomeGroth16(r.publicSignals, r.proof);
    const a = solidityArgsOf(r.proof, r.publicSignals);
    const args = [{ a: [...a.proof.a], b: [[...a.proof.b[0]], [...a.proof.b[1]]], c: [...a.proof.c] }, a.signals] as never;
    const onChain = (await client.call({ to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "check", args }), gas: 400_000n })).data === `0x${"0".repeat(63)}1`;
    checks.push(`Proof ${name}: ≥ ${usd(threshold)} tUSD8 from ${pays.length} payment(s) (amounts ${pays.map((x) => usd(x.amount)).join(" + ")}; sweep notes ${pays.map((x) => usd(x.record.amountS)).join(" + ")}): proved in ${r.proveMs} ms; snarkjs verify ${local}; IncomeVerifier.check ${onChain}`);
    if (!local || !onChain) throw new Error(`proof ${name} did not verify (snarkjs ${local}, on chain ${onChain})`);
    proofs.push({ name, threshold: threshold.toString(), count: pays.length, proveMs: r.proveMs, publicSignals: r.publicSignals });
    if (record) {
      const hash: Hex = await createWalletClient({ account: attestFrom, transport: http(RPC) }).sendTransaction({ chain: null, to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "attest", args }), gas: 420_000n, type: "legacy" });
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`attest reverted (${hash})`);
      rows.push({ what: `attest proof ${name} (own gas)`, hash, block: rc.blockNumber.toString(), gasUsed: rc.gasUsed.toString() });
    }
  }

  // Withdraw the 1.5 payment's two notes separately.
  const to = privateKeyToAccount(generatePrivateKey()).address;
  const wctx = { chainId: 440050, contracts: { pool: dep.pool }, proveUnshield: finalUnshieldProver() } as const;
  const two = sweptNotes([inbox[1]!]);
  if (two.length !== 2) throw new Error(`the split sweep left ${two.length} withdrawable notes, expected 2`);
  for (const n of two) {
    const w = must(await prepareWithdraw(wctx, await trees(), n, to), "prepareWithdraw");
    await send("unshield", w.body(), `withdraw a ${usd(w.amount)} tUSD8 note of P2 to a fresh address`);
  }
  const got = await client.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [to] });
  checks.push(`The fresh address received ${usd(got)} tUSD8 in ${two.length} withdrawals (${two.map((n) => usd(BigInt(n.amountWei))).join(" + ")}); no withdrawal equals P2's 1.5`);
  if (got !== 1_500_000n) throw new Error(`withdrawn ${got}, expected 1500000`);

  const out = { ok: true, at: new Date().toISOString(), rpc: RPC, base: BASE, deployment: dep, rows, checks, proofs };
  writeFileSync(join(REPO, "evidence/split-sweep-fork.json"), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(join(REPO, "evidence/split-sweep-fork.md"), [
    "# Split sweep on the fork (D32 F4)", "",
    `Run ${out.at} on \`make fork\` (chain 440050, real tUSD8), through the web app at ${BASE}; Gloam's final keys and the income FINAL key. Demo personas.`,
    "Command: `pnpm --filter @shaida/pay split-sweep:fork`. Raw: [split-sweep-fork.json](split-sweep-fork.json).", "",
    "## Result", ...checks.map((x) => `- ${x}`), "",
    "## Transactions", "| What | Tx | Block | Gas used |", "|---|---|---:|---:|",
    ...rows.map((r) => `| ${r.what} | \`${r.hash}\` | ${r.block} | ${r.gasUsed === "—" ? "—" : Number(r.gasUsed).toLocaleString("en-US")} |`), "",
  ].join("\n"));
  console.log("wrote evidence/split-sweep-fork.md");
}

main().then(() => process.exit(0), (e: unknown) => {
  writeFileSync(join(REPO, `evidence/split-sweep-fork-FAILED-${Date.now()}.md`), `# Split sweep on the fork: FAILED\n\n${e instanceof Error ? e.message : String(e)}\n\n## Done before the failure\n${checks.map((x) => `- ${x}`).join("\n")}\n${rows.map((r) => `- ${r.what}: ${r.hash} (${r.gasUsed} gas)`).join("\n")}\n`);
  console.error(e);
  process.exit(1);
});
