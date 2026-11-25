// Live run 1 on Aevum testnet (44005), per evidence/budget.md, through the running web app's /api/index and /api/relay.
// Demo personas: Acme Studio (demo) pays Ada (demo) 1.5 + 1 + 0.5 tUSD8 from one gasless deposit; Ada sweeps all
// three and proves ≥ 3 tUSD8 for "Landlord Bola" (demo), 30-day expiry; Bola verifies, checks on chain and attests
// from the reader wallet. No withdrawal (LIMITS.md, D28).
//
// The deployer's two transactions (registration, 3 tUSD8 to the payer) are sent by the builder from their own keystore;
// pass their hashes and this script checks and records them. Keys: Foundry keystores shaida-payer-demo and
// shaida-reader, passwords in ~/.config/shaida (never printed). Before every transaction the budget limits are read
// from the chain; any breach stops the run. Progress (with Ada's demo secrets) is kept in ~/.config/shaida (mode 600)
// so a resumed run re-sends the same request body (answered from the relayer's record), never a new one.
// Usage: pnpm --filter @shaida/pay live:44005 --register-tx 0x… --transfer-tx 0x… [--base http://localhost:3100]
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { generateReceiveKey, type ReceiveKey } from "@gloamtrade/sdk";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildIncomeBundle, contextOf, datesForRange, decodeFragment, encodeIncomeLink, incomeLinkSchema, leafRangeForPeriod, readerIdHashOf, solidityArgsOf, verifyIncomeLink, type IncomeLink,
} from "@shaida/proofs";
import {
  emptyVault, fetchCheckedTrees, incomeCandidates, incomeRequestOf, inboxEntrySchema, noteSchema, openInbox, prepareDeposit, preparePay, prepareSweep, relayClient,
  sealVault, seen, startSweep, storedReceiveKey, timedLeaves, type FlowContext, type InboxEntry, type Note, type RelayRecord,
} from "../src/index";
import { proveIncome, verifyIncomeGroth16 } from "./income-node";
import { finalProvers, nodeFetch, REPO, rootReader, sleep } from "./node-env";
import { revocationOn } from "./evidence";

const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = "https://rpc-test.qday.info";
const EXPLORER = "https://explorer-test.qday.info";
const CHAIN_ID = 44005;
const TUSD = 1_000_000n;
const TUSD8 = "0x456569838f1d43009a91eba4263147afd7233483" as Address;
const DEPLOYER = "0x5f8066e6e18f6381a0ff593bb6b1a036c5a69698" as Address;
const RELAYER = "0xf4945dd57c8de1c637966179df5b631689901422" as Address;
const PAYMENTS = [1_500_000n, 1_000_000n, 500_000n] as const;
const GAS_PRICE = 1_000_000_000n;
const LIMIT = { deployerWei: 500_000_000_000_000_000n, deployerTusd8: 2n * TUSD, relayerFloorWei: 10_000_000_000_000_000n };
const PRIVATE = join(homedir(), ".config/shaida");
const STATE = join(PRIVATE, "live-run-1.state.json");
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const registryAbi = parseAbi(["function activeIdOf(address account) view returns (uint32)"]);
const verifierAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "function check(Proof proof, uint256[7] signals) view returns (bool)",
  "function attest(Proof proof, uint256[7] signals) returns (bool)",
  "event IncomeProofChecked(uint256 indexed context, uint256 threshold, uint256 count)",
]);

interface Row { step: string; what: string; sender: string; hash: string; block: string; gasUsed: string; feeWei: string; before: Balances; after: Balances }
interface Balances { deployerWei: string; deployerTusd8: string; relayerWei: string; readerWei: string }
interface State {
  receiveKey: unknown; funds: Note | null; inbox: InboxEntry[]; rows: Row[]; done: string[];
  pending: { step: string; fn: string; body: Record<string, unknown> } | null;
  link: { fragment: string; expiry: string; proveMs: number[] } | null; checks: string[];
  /** Saved with each pay before it is posted: the payer's change note and the pay's sealed memo body. */
  nextFunds: Note | null; memos: Record<string, Record<string, unknown>>;
}

function decryptKey(name: string): Hex {
  const out = execFileSync("cast", ["wallet", "decrypt-keystore", "-k", join(homedir(), ".foundry/keystores"), name, "--unsafe-password", readFileSync(join(PRIVATE, `${name}.password`), "utf8").trim()], { encoding: "utf8" });
  const key = out.match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (!key) throw new Error(`could not read keystore ${name}`);
  return key as Hex;
}

const save = (s: State) => { mkdirSync(PRIVATE, { recursive: true, mode: 0o700 }); writeFileSync(STATE, JSON.stringify(s, null, 2)); chmodSync(STATE, 0o600); };
function load(): State {
  if (!existsSync(STATE)) return { receiveKey: null, funds: null, inbox: [], rows: [], done: [], pending: null, link: null, checks: [], nextFunds: null, memos: {} };
  const s = JSON.parse(readFileSync(STATE, "utf8")) as State;
  return { ...s, funds: s.funds ? noteSchema.parse(s.funds) : null, nextFunds: s.nextFunds ? noteSchema.parse(s.nextFunds) : null, inbox: s.inbox.map((e) => inboxEntrySchema.parse(e)) };
}

async function main() {
  const client = createPublicClient({ transport: http(RPC) }) as PublicClient;
  if ((await client.getChainId()) !== CHAIN_ID) throw new Error("RPC is not Aevum testnet 44005");
  const d = JSON.parse(readFileSync(join(REPO, "deployments/aevum.json"), "utf8")) as { contracts: Record<string, { address: Address }>; revocations?: { address: Address } };
  const dep = { pool: d.contracts.ShieldPoolPoseidon!.address, ledger: d.contracts.ShaidaLedger!.address, depositor: d.contracts.ShaidaDepositor!.address, registry: d.contracts.PayerRegistry!.address, incomeVerifier: d.contracts.IncomeVerifier!.address, revocations: d.revocations?.address ?? null };
  const payer = privateKeyToAccount(decryptKey("shaida-payer-demo"));
  const reader = privateKeyToAccount(decryptKey("shaida-reader"));
  const ctx: FlowContext = { chainId: CHAIN_ID, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const relay = relayClient(BASE, nodeFetch);
  const must = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }, what: string): T => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };
  const trees = async () => must(await fetchCheckedTrees(BASE, CHAIN_ID, nodeFetch, rootReader(client), { sleep }), "index");
  const s = load();
  const once = async (step: string, f: () => Promise<void>) => { if (s.done.includes(step)) return; await f(); s.done.push(step); s.pending = null; save(s); };

  const balances = async (): Promise<Balances> => ({
    deployerWei: (await client.getBalance({ address: DEPLOYER })).toString(),
    deployerTusd8: (await client.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [DEPLOYER] })).toString(),
    relayerWei: (await client.getBalance({ address: RELAYER })).toString(),
    readerWei: (await client.getBalance({ address: reader.address })).toString(),
  });
  /** The budget rules, read from the chain before every transaction. A breach stops the run; nothing is sent. */
  const guard = async (what: string, sender: "relayer" | "reader", gasCap: bigint): Promise<Balances> => {
    const b = await balances();
    const stop = [
      BigInt(b.deployerWei) < LIMIT.deployerWei ? `deployer below 0.5 tQDAY (${formatEther(BigInt(b.deployerWei))})` : null,
      BigInt(b.deployerTusd8) < LIMIT.deployerTusd8 ? `deployer below 2 tUSD8 (${Number(b.deployerTusd8) / 1e6})` : null,
      sender === "relayer" && BigInt(b.relayerWei) < LIMIT.relayerFloorWei + gasCap * GAS_PRICE ? `relayer ${formatEther(BigInt(b.relayerWei))} tQDAY: below its 0.01 floor plus this call's gas limit` : null,
      sender === "reader" && BigInt(b.readerWei) < gasCap * GAS_PRICE ? `reader ${formatEther(BigInt(b.readerWei))} tQDAY: below the attest's gas limit × price` : null,
    ].filter((x): x is string => x !== null);
    if (stop.length) throw new Error(`BUDGET STOP before "${what}": ${stop.join("; ")}. Nothing was sent.`);
    return b;
  };
  const record = async (step: string, what: string, sender: string, hash: Hex, before: Balances) => {
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
    s.rows.push({ step, what, sender, hash, block: r.blockNumber.toString(), gasUsed: r.gasUsed.toString(), feeWei: (r.gasUsed * r.effectiveGasPrice).toString(), before, after: await balances() });
    save(s);
  };
  /** One relayed call: the body is saved before it is posted, and a resumed run re-posts that same body. */
  const relayed = async (step: string, fn: "deposit" | "vouchedPay" | "memo" | "sweep", what: string, gasCap: bigint, make: () => Promise<Record<string, unknown>>) => {
    await once(step, async () => {
      const before = await guard(what, "relayer", gasCap);
      if (!s.pending || s.pending.step !== step) { s.pending = { step, fn, body: await make() }; save(s); }
      const posted: RelayRecord = must(await relay.post(fn, s.pending.body), what);
      const settled = must(await relay.settle(posted.requestId, { sleep, timeoutMs: 180_000 }), `${what} status`);
      if (settled.state !== "mined" || settled.reverted) throw new Error(`${what}: ${settled.state}${settled.reverted ? " (reverted)" : ""} ${settled.hash}`);
      await record(step, what, "relayer", settled.hash as Hex, before);
    });
  };

  // The builder's two deployer transactions: checked on chain, then recorded (balances after only: sent outside).
  await once("deployer", async () => {
    for (const [step, h, what] of [["register", arg("register-tx"), "attestor registers Acme Studio (demo) as a payer"], ["transfer", arg("transfer-tx"), "deployer sends 3 tUSD8 to the payer"]] as const) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`pass --${step}-tx <hash> (sent by the builder from the deployer)`);
      const r = await client.getTransactionReceipt({ hash: h as Hex });
      if (r.status !== "success" || r.from.toLowerCase() !== DEPLOYER) throw new Error(`${step} tx ${h}: status ${r.status}, from ${r.from}`);
      const now = await balances();
      s.rows.push({ step, what, sender: "deployer (builder's terminal)", hash: h, block: r.blockNumber.toString(), gasUsed: r.gasUsed.toString(), feeWei: (r.gasUsed * r.effectiveGasPrice).toString(), before: now, after: now });
    }
    const id = await client.readContract({ address: dep.registry, abi: registryAbi, functionName: "activeIdOf", args: [payer.address] });
    const held = await client.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [payer.address] });
    if (held !== 3n * TUSD) throw new Error(`payer holds ${held}, expected 3000000`);
    s.checks.push(`Acme Studio (demo) ${payer.address} is active payer #${id} and holds 3 tUSD8`);
  });

  if (!s.receiveKey) { s.receiveKey = await generateReceiveKey(); save(s); }
  const ada = s.receiveKey as ReceiveKey;

  await relayed("deposit", "deposit", "Acme: gasless deposit of 3 tUSD8", 1_600_000n, async () => {
    const p = await prepareDeposit(ctx, payer.address, 3n * TUSD);
    s.funds = p.note;
    return p.body(await payer.signTypedData(p.typedData));
  });
  for (const [i, amount] of PAYMENTS.entries()) {
    await relayed(`pay${i + 1}`, "vouchedPay", `Acme: vouched pay ${i + 1} of ${Number(amount) / 1e6} tUSD8 to Ada`, 3_200_000n, async () => {
      if (!s.funds) throw new Error("no payer note");
      const p = must(await preparePay(ctx, await trees(), { payer: payer.address, source: s.funds, amount, recipientTag: ada.tag, privateNote: `Invoice ${i + 1} (demo)` }), "preparePay");
      s.nextFunds = p.change;
      s.memos[`memo${i + 1}`] = p.memoBody();
      return p.body(await payer.signTypedData(p.typedData));
    });
    if (s.nextFunds) { s.funds = s.nextFunds; s.nextFunds = null; save(s); }
    await relayed(`memo${i + 1}`, "memo", `sealed memo ${i + 1}`, 250_000n, async () => {
      const body = s.memos[`memo${i + 1}`];
      if (!body) throw new Error(`no saved body for memo ${i + 1}`);
      return body;
    });
  }

  // Ada opens her board and sweeps each payment (the fresh note is saved before the sweep is sent).
  const payments = await openInbox((await trees()).snapshot.memos, ada, ctx);
  if (payments.length !== 3) throw new Error(`Ada's inbox has ${payments.length} payments, expected 3`);
  for (const [i, p] of payments.entries()) {
    await relayed(`sweep${i + 1}`, "sweep", `Ada sweeps ${Number(p.note.amountWei) / 1e6} tUSD8 (${p.privateNote ?? "no note"})`, 3_100_000n, async () => {
      const w = must(await prepareSweep(ctx, await trees(), p), "prepareSweep");
      s.inbox = [...s.inbox.filter((e) => e.commitment !== p.note.commitment), startSweep(seen(p.note.commitment), w.fresh)];
      save(s);
      return w.body();
    });
    s.inbox = s.inbox.map((e) => (e.commitment === p.note.commitment ? { ...e, state: "swept" as const } : e));
    save(s);
  }

  // Ada's vault backup (encrypted), so her swept notes can be withdrawn later from /app/withdraw in a browser.
  const passFile = join(PRIVATE, "ada-live-run-1.vault-passphrase");
  if (!existsSync(passFile)) { writeFileSync(passFile, randomBytes(24).toString("base64url")); chmodSync(passFile, 0o600); }
  const vault = await sealVault({ ...emptyVault(CHAIN_ID), receiveKey: storedReceiveKey(s.receiveKey), inbox: s.inbox }, readFileSync(passFile, "utf8").trim());
  writeFileSync(join(PRIVATE, "ada-live-run-1.vault.json"), JSON.stringify(vault)); chmodSync(join(PRIVATE, "ada-live-run-1.vault.json"), 0o600);

  // Act 4: Ada proves ≥ 3 tUSD8 for Landlord Bola, expiring in 30 days (final income key).
  const t = await trees();
  const leaves = await timedLeaves(t, async (b) => (await client.getBlock({ blockNumber: b })).timestamp);
  const bola = must(readerIdHashOf("Landlord Bola"), "reader");
  if (!s.link) {
    const c = incomeCandidates(t, payments, s.inbox);
    if (c.countable.length !== 3) throw new Error(`countable ${c.countable.length}, expected 3`);
    const first = leaves.find((l) => l.index === c.countable[0]!.vouchIndex)!;
    const range = must(leafRangeForPeriod(leaves, first.time, ctx.nowSec()), "period");
    const expiry = ctx.nowSec() + 30n * 86_400n;
    const salt = BigInt(`0x${randomBytes(31).toString("hex")}`);
    const bundle = must(buildIncomeBundle(incomeRequestOf(t, c.countable, { threshold: 3n * TUSD, ...range, context: contextOf(bola, expiry, salt), shareStep: TUSD })), "bundle ≥ 3");
    const proofs: IncomeLink["proofs"] = [];
    const proveMs: number[] = [];
    for (const p of bundle.proofs) { const r = await proveIncome(p.input); proofs.push({ proof: r.proof, publicSignals: r.publicSignals }); proveMs.push(r.proveMs); }
    s.link = { fragment: encodeIncomeLink({ v: 1, proofs, readerIdHash: bola.toString(), expiry: expiry.toString(), salt: salt.toString() }), expiry: expiry.toString(), proveMs };
    s.checks.push(`Act 4: ${proofs.length} proof(s) with the final key in node ${process.version}: ${proveMs.join(" + ")} ms; countable ${c.countable.map((x) => Number(x.amount) / 1e6).join(" + ")} tUSD8`);
    save(s);
  }

  // Act 5: Bola verifies the link (roots checked on 44005 at the snapshot's block).
  const v = await verifyIncomeLink(s.link.fragment, {
    readerIdHash: must(readerIdHashOf("Landlord Bola"), "reader"), readerCode: null, revocation: revocationOn(client, dep, t.block), now: ctx.nowSec, verifyGroth16: verifyIncomeGroth16,
    resolveRange: async (a, b) => datesForRange(leaves, a, b), isKnownRoot: (root) => rootReader(client).isKnownRoot(dep.ledger, root, t.block),
  });
  if (v.status !== "VALID") throw new Error(`Bola sees ${v.error.code}: ${v.error.message}`);
  const verdict = `VALID: ≥ ${Number(v.threshold) / 1e6} tUSD8, ${v.count} payments, ${new Date(Number(v.fromDate) * 1000).toISOString()} – ${new Date(Number(v.toDate) * 1000).toISOString()}, expires ${new Date(Number(v.expiry) * 1000).toISOString()}`;

  // Act 6: IncomeVerifier.check (eth_call on 44005) and attest from the reader wallet.
  const decoded = decodeFragment(s.link.fragment);
  if (!decoded.ok) throw new Error("the saved link does not decode");
  const json = incomeLinkSchema.parse(decoded.json);
  const args = solidityArgsOf(json.proofs[0]!.proof, json.proofs[0]!.publicSignals);
  const callArgs = [{ a: [...args.proof.a], b: [[...args.proof.b[0]], [...args.proof.b[1]]], c: [...args.proof.c] }, args.signals] as never;
  const ok = await client.call({ to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "check", args: callArgs }), gas: 400_000n });
  if (ok.data !== `0x${"0".repeat(63)}1`) throw new Error(`IncomeVerifier.check returned ${ok.data}`);
  await once("attest", async () => {
    const before = await guard("Bola records the check (attest)", "reader", 420_000n);
    const hash = await createWalletClient({ account: reader, transport: http(RPC) }).sendTransaction({ chain: null, to: dep.incomeVerifier, data: encodeFunctionData({ abi: verifierAbi, functionName: "attest", args: callArgs }), gas: 420_000n, gasPrice: GAS_PRICE, type: "legacy" });
    await record("attest", "Bola records the check: attest from the reader wallet", `reader ${reader.address}`, hash, before);
    const r = await client.getTransactionReceipt({ hash });
    const log = r.logs.find((l) => l.address.toLowerCase() === dep.incomeVerifier.toLowerCase());
    const ev = log ? decodeEventLog({ abi: verifierAbi, data: log.data, topics: log.topics }) : null;
    s.checks.push(`Act 6: attest emitted IncomeProofChecked(threshold ${ev?.args.threshold ?? "—"}, count ${ev?.args.count ?? "—"})`);
  });

  writeReport(s, { verdict, onChain: `IncomeVerifier.check (eth_call on 44005, gas 400,000) at ${dep.incomeVerifier} → true`, readerAddress: reader.address, payerAddress: payer.address });
  const examples = join(REPO, "web/src/app/example-links.json");
  writeFileSync(examples, JSON.stringify({ note: "Written by packages/shaida-pay/scripts/live-44005.ts from a real run (evidence/live-44005-run1.md). Demo personas; the link expires.", "44005": { link: `/v#${s.link.fragment}`, expiry: Number(s.link.expiry) } }, null, 2) + "\n");
}

function writeReport(s: State, x: { verdict: string; onChain: string; readerAddress: string; payerAddress: string }, failure?: string) {
  const tq = (w: string) => (Number(BigInt(w)) / 1e18).toFixed(9);
  const total = s.rows.filter((r) => r.sender === "relayer").reduce((a, r) => a + BigInt(r.feeWei), 0n);
  const lines = [
    `# Live run 1 on Aevum testnet (44005)${failure ? ": FAILED" : ""}`, "",
    "Generated by `pnpm --filter @shaida/pay live:44005`. Do not edit by hand. Personas are demo: Acme Studio (demo), Ada (demo), Landlord Bola (demo). Plan: evidence/budget.md.", "",
    "| Field | Value |", "|---|---|",
    `| Chain | Aevum testnet 44005 via ${RPC}; app ${BASE} (/api/index, /api/relay) |`,
    `| Commit | \`${execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()}\` |`,
    `| Payer (demo) / reader / relayer | \`${x.payerAddress}\` / \`${x.readerAddress}\` / \`${RELAYER}\` |`,
    `| Date | ${new Date().toISOString()} |`,
    `| Result | ${failure ? `**FAILED**: ${failure}` : "passed"} |`, "",
    "| Step | What | Sender | Tx | Block | Gas used | Fee (tQDAY) | Relayer tQDAY before → after | Reader tQDAY after | Deployer tQDAY / tUSD8 after |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
    ...s.rows.map((r) => `| ${r.step} | ${r.what} | ${r.sender} | [\`${r.hash.slice(0, 10)}…\`](${EXPLORER}/tx/${r.hash}) | ${r.block} | ${Number(r.gasUsed).toLocaleString("en-US")} | ${tq(r.feeWei)} | ${tq(r.before.relayerWei)} → ${tq(r.after.relayerWei)} | ${tq(r.after.readerWei)} | ${tq(r.after.deployerWei)} / ${Number(r.after.deployerTusd8) / 1e6} |`),
    "",
    `Relayer gas fees in this run: ${tq(total.toString())} tQDAY.`, "",
    ...s.checks.map((c) => `- ${c}`),
    ...(failure ? [] : [`- Act 5: Bola types "Landlord Bola" → ${x.verdict}`, `- Act 6: ${x.onChain}`, "- No withdrawal after the run (LIMITS.md, D28): Ada's 3 tUSD8 stay in 3 swept notes; her encrypted vault backup is kept outside the repo."]),
    `- Machine: ${cpus()[0]?.model ?? "—"}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GiB RAM`, "",
  ];
  writeFileSync(join(REPO, `evidence/${failure ? `live-44005-run1-FAILED-${Date.now()}` : "live-44005-run1"}.md`), lines.join("\n"));
  if (!failure) writeFileSync(join(REPO, "evidence/live-44005-run1.json"), JSON.stringify({ rows: s.rows, checks: s.checks, link: s.link ? `/v#${s.link.fragment}` : null, proveMs: s.link?.proveMs ?? null }, null, 2) + "\n");
}

main().then(
  () => { console.log("✓ evidence/live-44005-run1.md"); process.exit(0); },
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      writeReport(load(), { verdict: "—", onChain: "—", readerAddress: "—", payerAddress: "—" }, msg);
    } catch (w) {
      console.error(`could not write the FAILED report: ${w instanceof Error ? w.message : String(w)}`);
    }
    console.error(`✗ ${msg}`);
    process.exit(1);
  },
);
