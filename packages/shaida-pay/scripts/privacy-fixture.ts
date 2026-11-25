// The privacy audit's fork fixture (evidence/privacy-audit.md): a scenario with a known ground truth, run on
// `make fork` through the running web app's /api/index and /api/relay, as the exit checks are. Two registered payers
// (Acme, Bisi) pay two recipients (Ada, Chidi) eight times, interleaved; Chidi sweeps out of order, Ada sweeps in
// order after a pause; Ada proves her six payments as a 2-proof bundle for "Landlord Bola" (both proofs attested on
// chain by Bola's wallet); Chidi proves his two for "Lender Dayo" (not attested) and withdraws one swept note to a
// fresh address, which forwards it. Writes tools/privacy/fixtures/fork-truth.json. Demo personas; fork only.
// --fixes runs the same plan with D32's applied fixes, as the app now does them: no on-chain attest (F3), expiry at
// 23:59:59 UTC (F8), the suggested rounded-down threshold instead of the most (F9), split sweeps, and Chidi withdraws
// only the 1 tUSD8 part of P2's 2 (F4). Writes tools/privacy/fixtures/fork-truth-fixes.json instead.
// --revoke (D35, D36) is --fixes with links as the app now makes them: v2, salt = Poseidon(4, revokeSecret); Ada's
// link is code-protected (a random 80-bit reader code, as /v makes it), Chidi's is name only; after the withdrawal
// Chidi revokes his link through the relayer, and the same request again is answered from that record (nothing sent).
// Neither the reader code nor the revoke secret is written anywhere. Writes fork-truth-revoke.json.
// Usage: pnpm --filter @shaida/pay privacy:fixture [--fixes | --revoke] [--base http://localhost:3100] [--rpc http://127.0.0.1:8555]
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateReceiveKey, type ReceiveKey } from "@gloamtrade/sdk";
import {
  buildIncomeBundle, codeBoundReaderIdHash, contextOf, encodeIncomeLink, leafRangeForPeriod, parseReaderCode, readerCodeFromBytes, readerIdHashOf,
  REVOKE_SECRET_BYTES, revokeSaltOf, revokeSecretFromBytes, solidityArgsOf, type IncomeLink,
} from "@shaida/proofs";
import { revocationsReadAbi } from "@shaida/index";
import { createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { endOfDayUtc, fetchCheckedTrees, incomeCandidates, incomeRequestOf, openInbox, prepareDeposit, preparePay, prepareSweep, prepareWithdraw, relayClient, seen, splitPartOf, startSweep, suggestedThreshold, sweptNotes, timedLeaves, type FlowContext, type InboxEntry, type IncomingPayment, type Note, type RelayRecord } from "../src/index";
import { readDeployment } from "./evidence";
import { assertFork, mintTusd8, registerPayer } from "./fork-setup";
import { proveIncome } from "./income-node";
import { finalProvers, finalUnshieldProver, forkClient, nodeFetch, REPO, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const REVOKE = process.argv.includes("--revoke");
const FIXES = REVOKE || process.argv.includes("--fixes");
const OUT = join(REPO, `tools/privacy/fixtures/fork-truth${REVOKE ? "-revoke" : FIXES ? "-fixes" : ""}.json`);
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
const U = 1_000_000n;
const verifierAbi = parseAbi(["struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }", "function attest(Proof proof, uint256[7] signals) returns (bool)"]);
const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const must = <T>(r: Res<T>, what: string): T => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };

// Who pays whom, in chain order (amounts in base units).
const PLAN = [["acme", "ada", 1_500_000n], ["bisi", "chidi", 2_000_000n], ["acme", "chidi", 700_000n], ["bisi", "ada", 1_000_000n], ["acme", "ada", 2_250_000n], ["acme", "ada", 500_000n], ["bisi", "ada", 1_200_000n], ["acme", "ada", 1_000_000n]] as const;

// D36: every line this script prints is kept, so the end of a --revoke run can check that no reader code is in it.
const printed: string[] = [];
const consoleLog = console.log.bind(console);
console.log = (...a: unknown[]) => { printed.push(a.map(String).join(" ")); consoleLog(...a); };
const codeForms: string[] = [];

async function main() {
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  // "Now" is the chain's latest block time: pause() moves the fork's clock ahead of the wall clock, and signature
  // deadlines and EIP-3009 windows are checked against block time.
  let chainNow = (await client.getBlock()).timestamp;
  const tick = async () => { chainNow = (await client.getBlock()).timestamp; };
  const ctx: FlowContext = { chainId: 440050, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => chainNow };
  const raw = relayClient(BASE, nodeFetch);
  // The relayer's per-address rate limit refuses with RateLimited and sends nothing: wait out the window, ask again.
  const relay = {
    settle: raw.settle,
    post: async (...a: Parameters<typeof raw.post>): ReturnType<typeof raw.post> => {
      for (;;) {
        const r = await raw.post(...a);
        if (r.ok || r.error.code !== "RateLimited") return r;
        console.log(`· RateLimited (nothing sent): waiting 65 s`);
        await sleep(65_000);
      }
    },
  };
  // A retryable index refusal (e.g. the index still catching up to the deploy block) is asked again, at most 30 times.
  const trees = async () => {
    for (let k = 0; ; k++) {
      await tick();
      const r = await fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep });
      if (r.ok || k >= 30 || !("retryable" in r.error) || (r.error as { retryable: string }).retryable !== "yes") return must(r, "index");
      console.log(`· index ${r.error.code} (retryable): waiting 10 s`);
      await sleep(10_000);
    }
  };
  const settle = async (r: RelayRecord, what: string) => {
    const s = must(await relay.settle(r.requestId, { sleep, timeoutMs: 60_000 }), `${what} status`);
    if (s.state !== "mined" || s.reverted || !s.hash) throw new Error(`${what}: ${s.state}${s.reverted ? " (reverted)" : ""}`);
    console.log(`· ${what}: ${s.hash}`);
    return s.hash.toLowerCase();
  };
  // A gap between phases: 400 empty blocks. Interval 0, so the fork's clock does not run ahead of the wall clock
  // (the relayer checks signature windows against its own clock; a 1 s interval broke a first run: RateLimited/expiry).
  const pause = async () => { await client.request({ method: "anvil_mine" as never, params: ["0x190", "0x0"] as never }); await tick(); };

  const payers: Record<string, { account: PrivateKeyAccount; funds: Note; name: string }> = {};
  const deposits: { hash: string; payer: string; amount: string }[] = [];
  for (const [id, name, amount] of [["acme", "Acme Studio (demo)", 10n * U], ["bisi", "Bisi Foods (demo)", 6n * U]] as const) {
    const account = privateKeyToAccount(generatePrivateKey());
    await registerPayer(client, RPC, dep.registry, account.address, name);
    await mintTusd8(client, RPC, account.address, amount);
    await tick();
    const d = await prepareDeposit(ctx, account.address, amount);
    deposits.push({ hash: await settle(must(await relay.post("deposit", d.body(await account.signTypedData(d.typedData))), `${id} deposit`), `${name}: deposit ${amount / U} tUSD8`), payer: account.address.toLowerCase(), amount: amount.toString() });
    payers[id] = { account, funds: d.note, name };
    await pause();
  }
  const keys: Record<string, ReceiveKey> = { ada: await generateReceiveKey(), chidi: await generateReceiveKey() };
  const names: Record<string, string> = { ada: "Ada (demo)", chidi: "Chidi (demo)" };

  const pays: { hash: string; payer: string; recipient: string; amount: string; note: string; commitment: string; sweep: string | null }[] = [];
  const doPay = async (k: number) => {
    const [from, to, amount] = PLAN[k]!;
    const p = payers[from]!;
    const pay = must(await preparePay(ctx, await trees(), { payer: p.account.address, source: p.funds, amount, recipientTag: keys[to]!.tag, privateNote: `Invoice ${k + 1} (demo)` }), `pay ${k + 1}`);
    const hash = await settle(must(await relay.post("vouchedPay", pay.body(await p.account.signTypedData(pay.typedData))), `pay ${k + 1}`), `P${k + 1} ${p.name} → ${names[to]} ${Number(amount) / 1e6}`);
    await settle(must(await relay.post("memo", pay.memoBody()), `memo ${k + 1}`), `memo ${k + 1}`);
    p.funds = pay.change;
    pays.push({ hash, payer: p.account.address.toLowerCase(), recipient: names[to]!, amount: amount.toString(), note: `Invoice ${k + 1} (demo)`, commitment: pay.payment.commitment.toLowerCase(), sweep: null });
  };
  const inboxes: Record<string, { payments: IncomingPayment[]; inbox: InboxEntry[] }> = { ada: { payments: [], inbox: [] }, chidi: { payments: [], inbox: [] } };
  const sweepOf = async (who: string, order: (ps: IncomingPayment[]) => IncomingPayment[]) => {
    const found = await openInbox((await trees()).snapshot.memos, keys[who]!, ctx);
    const todo = order(found.filter((p) => !inboxes[who]!.payments.some((q) => q.note.commitment === p.note.commitment)));
    for (const p of todo) {
      const part = FIXES ? splitPartOf(BigInt(p.note.amountWei), U) : null;
      const s = must(await prepareSweep(ctx, await trees(), p, part === null ? {} : { split: part }), "prepareSweep");
      const hash = await settle(must(await relay.post("sweep", s.body()), "sweep"), `${names[who]} sweeps ${Number(p.note.amountWei) / 1e6}${s.rest ? ` split ${Number(s.fresh.amountWei) / 1e6} + ${Number(s.rest.amountWei) / 1e6}` : ""}`);
      pays.find((x) => x.commitment === p.note.commitment.toLowerCase())!.sweep = hash;
      inboxes[who]!.payments.push(p);
      inboxes[who]!.inbox.push({ ...startSweep(seen(p.note.commitment), s.fresh, s.rest), state: "swept" });
    }
  };

  for (const k of [0, 1, 2, 3]) await doPay(k);
  await pause();
  await sweepOf("chidi", (ps) => [...ps].reverse()); // newest first: first-in-first-out matching gets these wrong
  await pause();
  for (const k of [4, 5, 6, 7]) await doPay(k);
  await pause();
  await sweepOf("ada", (ps) => ps);
  await pause();

  // Proof links. Ada: all six, the most she can show (a 2-proof bundle); Chidi: both, ≥ 2 tUSD8.
  const links: Record<string, unknown>[] = [];
  const attests: Record<string, unknown>[] = [];
  const secrets: Record<string, bigint> = {};
  const prove = async (who: string, readerName: string, threshold: bigint | "most", mode: "name" | "code" = "name") => {
    const t = await trees();
    const leaves = await timedLeaves(t, async (b) => (await client.getBlock({ blockNumber: b })).timestamp);
    const c = incomeCandidates(t, inboxes[who]!.payments, inboxes[who]!.inbox);
    const first = leaves.find((l) => l.index === c.countable[0]!.vouchIndex)!;
    const range = must(leafRangeForPeriod(leaves, first.time, ctx.nowSec()), "period");
    const nameHash = must(readerIdHashOf(readerName), "reader");
    // D36: the code exists only in this process (the reader would type it on /v); it is never written out.
    const codeText = REVOKE && mode === "code" ? readerCodeFromBytes(randomBytes(10)) : null;
    const code = codeText === null ? null : must(parseReaderCode(codeText), "reader code");
    if (codeText !== null && code !== null) codeForms.push(codeText, codeText.replace(/-/g, ""), code.toString(), code.toString(16));
    const reader = code === null ? nameHash : codeBoundReaderIdHash(nameHash, code);
    const in30 = new Date(Number(ctx.nowSec() + 30n * 86_400n) * 1000).toISOString().slice(0, 10);
    const expiry = FIXES ? endOfDayUtc(in30)! : ctx.nowSec() + 30n * 86_400n;
    const secret = revokeSecretFromBytes(randomBytes(REVOKE_SECRET_BYTES));
    if (REVOKE) secrets[who] = secret;
    const salt = REVOKE ? revokeSaltOf(secret) : BigInt(`0x${randomBytes(31).toString("hex")}`);
    const sum = c.countable.reduce((s, x) => s + x.amount, 0n);
    const ask = threshold === "most" ? (FIXES ? suggestedThreshold(sum, U) : null) : threshold;
    if (FIXES && ask === null) throw new Error(`${who}: no suggested threshold below ${sum}`);
    let bundle = buildIncomeBundle(incomeRequestOf(t, c.countable, { threshold: ask ?? (sum / U) * U, ...range, context: contextOf(reader, expiry, salt), shareStep: U }));
    for (let x = (sum / U) * U; !bundle.ok && ask === null && x > 0n; x -= U) bundle = buildIncomeBundle(incomeRequestOf(t, c.countable, { threshold: x, ...range, context: contextOf(reader, expiry, salt), shareStep: U }));
    const b = must(bundle, `${who} bundle`);
    const proofs: IncomeLink["proofs"] = [];
    for (const p of b.proofs) { const r = await proveIncome(p.input); proofs.push({ proof: r.proof, publicSignals: r.publicSignals }); }
    const fields = { proofs, readerIdHash: reader.toString(), expiry: expiry.toString(), salt: salt.toString() };
    const url = `/v#${encodeIncomeLink(REVOKE ? { v: 2, ...fields, reader: mode } : { v: 1, ...fields })}`;
    const held = pays.filter((p) => p.recipient === names[who]).map((p) => p.hash);
    links.push({ name: who, from: { url }, reader: readerName, holder: names[who], pays: held, ...(REVOKE ? { readerMode: mode, revocable: true } : {}) });
    return { proofs, held };
  };
  const ada = await prove("ada", "Landlord Bola", "most", "code"); // with --fixes: the suggested threshold (F9); --revoke: code-protected
  const bola = privateKeyToAccount(generatePrivateKey());
  await client.request({ method: "anvil_setBalance" as never, params: [bola.address, "0xde0b6b3a7640000"] as never });
  for (const p of FIXES ? [] : ada.proofs) { // F3: with --fixes nobody records on chain
    const a = solidityArgsOf(p.proof, p.publicSignals);
    const data = encodeFunctionData({ abi: verifierAbi, functionName: "attest", args: [{ a: [...a.proof.a], b: [[...a.proof.b[0]], [...a.proof.b[1]]], c: [...a.proof.c] }, a.signals] as never });
    const hash: Hex = await createWalletClient({ account: bola, transport: http(RPC) }).sendTransaction({ chain: null, to: dep.incomeVerifier, data, gas: 420_000n, type: "legacy" });
    if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error(`attest reverted (${hash})`);
    attests.push({ hash: hash.toLowerCase(), by: "Landlord Bola (demo), reader wallet", holder: names.ada, link: "ada" });
  }
  await prove("chidi", "Lender Dayo", FIXES ? "most" : 2n * U);
  await pause();

  // Chidi withdraws the swept note of P2 (2 tUSD8) to a fresh address, which forwards it to another fresh address.
  // With --fixes P2 was split 1 + 1, and he withdraws only the first note now (the rest later, at another time).
  const p2 = inboxes.chidi!.inbox.find((e, i) => BigInt(inboxes.chidi!.payments[i]!.note.amountWei) === 2_000_000n)!;
  const note = sweptNotes([p2])[0]!;
  if (FIXES !== (sweptNotes([p2]).length === 2)) throw new Error(`P2 left ${sweptNotes([p2]).length} notes`);
  const fresh = privateKeyToAccount(generatePrivateKey());
  const w = must(await prepareWithdraw({ chainId: 440050, contracts: { pool: dep.pool }, proveUnshield: finalUnshieldProver() }, await trees(), note, fresh.address), "prepareWithdraw");
  const uHash = await settle(must(await relay.post("unshield", w.body()), "unshield"), `Chidi withdraws ${Number(w.amount) / 1e6} tUSD8`);
  await pause();
  await client.request({ method: "anvil_setBalance" as never, params: [fresh.address, "0xde0b6b3a7640000"] as never });
  const onward = privateKeyToAccount(generatePrivateKey()).address;
  const fHash = await createWalletClient({ account: fresh, transport: http(RPC) }).writeContract({ chain: null, address: TUSD8, abi: erc20, functionName: "transfer", args: [onward, w.amount], type: "legacy" });
  await client.waitForTransactionReceipt({ hash: fHash });

  // D35: Chidi revokes his link through the relayer; the same request again sends nothing.
  const revocations: Record<string, unknown>[] = [];
  if (REVOKE) {
    await pause();
    if (!dep.revocations) throw new Error("deployments/fork.json has no Revocations: run make deploy-revocations-fork");
    const body = { chainId: 440050, secret: secrets.chidi!.toString() };
    const rec = must(await relay.post("revoke", body), "revoke");
    const rHash = await settle(rec, "Chidi revokes his link");
    const receipt = await client.getTransactionReceipt({ hash: rHash as Hex });
    const salt = revokeSaltOf(secrets.chidi!);
    const at = await client.readContract({ address: dep.revocations, abi: revocationsReadAbi, functionName: "revokedAt", args: [salt] });
    if (at !== receipt.blockNumber) throw new Error(`revokedAt ${at}, receipt block ${receipt.blockNumber}`);
    // The same request again is answered from the first record (relayer test R42): the same request id and tx hash,
    // nothing sent. (AlreadyRevoked is for a salt the chain shows revoked with no record of this relayer: test R41.)
    const nonceBefore = await client.getTransactionCount({ address: receipt.from });
    const again = await relay.post("revoke", body);
    if (!again.ok) throw new Error(`second revoke: ${again.error.code}`);
    if (again.value.requestId !== rec.requestId || again.value.hash.toLowerCase() !== rHash) throw new Error(`second revoke: a new record ${again.value.requestId} (${again.value.state})`);
    if ((await client.getTransactionCount({ address: receipt.from })) !== nonceBefore) throw new Error("second revoke: the relayer sent another tx");
    console.log(`· a second revoke request: answered from the first record (${again.value.state}, same request id and hash); the relayer's nonce did not move`);
    revocations.push({ hash: rHash, link: "chidi", holder: names.chidi, salt: salt.toString(), block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), sender: receipt.from.toLowerCase(), secondRequest: `same record, ${again.value.state}; nothing sent` });
  }

  const truth = {
    schema: "shaida-privacy-truth/1", chainId: 440050, personas: "demo: Acme Studio and Bisi Foods pay; Ada and Chidi receive; Landlord Bola and Lender Dayo read",
    sources: { all: `written by packages/shaida-pay/scripts/privacy-fixture.ts${FIXES ? " --fixes" : ""} from the run that made the transactions` },
    fixes: FIXES ? ["F3 no attest", "F4 split sweeps, part withdrawn", "F8 expiry 23:59:59 UTC", "F9 suggested threshold", ...(REVOKE ? ["D35 revocable v2 links; Chidi revokes", "D36 Ada's link code-protected"] : [])] : [],
    payers: Object.fromEntries(Object.values(payers).map((p) => [p.account.address.toLowerCase(), p.name])),
    deposits, pays,
    unshields: [{ hash: uHash, amount: w.amount.toString(), pay: pays[1]!.hash, recipient: names.chidi, to: fresh.address.toLowerCase(), forwardedTo: onward.toLowerCase(), forwardTx: fHash.toLowerCase() }],
    attests, links, ...(REVOKE ? { revocations } : {}),
  };
  const written = `${JSON.stringify(truth, null, 2)}\n`;
  const leaked = codeForms.filter((f) => written.toLowerCase().includes(f.toLowerCase()) || printed.some((l) => l.toLowerCase().includes(f.toLowerCase())));
  if (leaked.length > 0) throw new Error(`a reader code form is in the output or the log (${leaked.length} form(s)); nothing written`);
  writeFileSync(OUT, written);
  console.log(`wrote ${OUT}${REVOKE ? `; checked: the reader code is in neither the truth file nor the log (${codeForms.length} forms)` : ""}`);
}

main().then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1); });
