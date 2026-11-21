// PRD §11 exit check, acts 2–3, on `make fork` through the running web app's /api/index and /api/relay:
//   Acme Studio (demo, a registered payer with NO gas) deposits gasless, pays Ada (demo) 3× privately (vouched,
//   with sealed memos); Ada finds the 3 payments on the memo board and sweeps all three through the relayer;
//   Acme's clawback of a swept payment is refused with AlreadySpent (relayer, and the pool itself).
// Writes evidence/acts-2-3-fork.md (+ .json) from this run; a failed run writes evidence/acts-2-3-fork-FAILED-*.md.
// Usage: pnpm --filter @shaida/pay exit:acts-2-3 [--base http://localhost:3100] [--rpc http://127.0.0.1:8555]
import { generateReceiveKey } from "@gloamtrade/sdk";
import { BaseError, decodeErrorResult, encodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ledgerAbi, relayErrorsAbi } from "@shaida/relay";
import { chainViewOf, fetchCheckedTrees, openInbox, prepareDeposit, preparePay, prepareSweep, relayClient, type FlowContext, type Note, type RelayRecord } from "../src/index";
import { readDeployment, writeEvidence, type ActRow } from "./evidence";
import { assertFork, mintTusd8, registerPayer, tusd8Balance } from "./fork-setup";
import { finalProvers, forkClient, isSpentReader, nodeFetch, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const TUSD = 1_000_000n;
const PAYMENTS = [3n * TUSD, 4n * TUSD, 2n * TUSD];

const rows: ActRow[] = [];
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`);
  return r.value;
};

async function main() {
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  const contracts = { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor };
  const ctx: FlowContext = { chainId: 440050, contracts, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const relay = relayClient(BASE, nodeFetch);
  const trees = () => fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep });
  const settle = async (r: RelayRecord, act: string, what: string): Promise<RelayRecord> => {
    const s = must(await relay.settle(r.requestId, { sleep, timeoutMs: 60_000 }), `${act} status`);
    if (s.state !== "mined" || s.reverted) throw new Error(`${act} ${what}: ${s.state}${s.reverted ? " (reverted)" : ""} ${s.error?.code ?? ""}`);
    rows.push({ act, what, fn: s.fn, hash: s.hash, block: s.block ?? "—", gasUsed: s.gasUsed ?? "—" });
    return s;
  };

  // Act 2 setup: Acme is registered and holds tUSD8, but no tQDAY at all (it never pays gas).
  const acme = privateKeyToAccount(generatePrivateKey());
  const reg = await registerPayer(client, RPC, dep.registry, acme.address, "Acme Studio (demo)");
  rows.push({ act: "setup", what: `attestor registers Acme Studio (demo) as payer #${reg.payerId}`, fn: "register", hash: reg.hash, block: "—", gasUsed: "—" });
  await mintTusd8(client, RPC, acme.address, 20n * TUSD);
  const ada = await generateReceiveKey();
  const acmeGasBefore = await client.getBalance({ address: acme.address });
  const before = must(await trees(), "index");

  // Act 2a: gasless deposit (signature only).
  const deposit = await prepareDeposit(ctx, acme.address, 10n * TUSD);
  let funds: Note = deposit.note;
  await settle(must(await relay.post("deposit", deposit.body(await acme.signTypedData(deposit.typedData))), "deposit"), "2", "gasless deposit 10 tUSD8 (Acme signs EIP-3009 only)");

  // Act 2b: three vouched private pays to Ada's receive address, each with a sealed memo.
  const sent: Note[] = [];
  for (const [i, amount] of PAYMENTS.entries()) {
    const t = must(await trees(), "index");
    const pay = must(await preparePay(ctx, t, { payer: acme.address, source: funds, amount, recipientTag: ada.tag, privateNote: `Invoice ${i + 1} (demo)` }), "preparePay");
    await settle(must(await relay.post("vouchedPay", pay.body(await acme.signTypedData(pay.typedData))), `pay ${i + 1}`), "2", `vouched pay ${i + 1} (amount and recipient not on chain)`);
    await settle(must(await relay.post("memo", pay.memoBody()), `memo ${i + 1}`), "2", `sealed memo ${i + 1} on the pay-memo board`);
    sent.push(pay.payment);
    funds = pay.change;
  }
  const acmeGasAfter = await client.getBalance({ address: acme.address });

  // Act 3a: Ada opens the board with her key (only here) and sweeps every payment.
  const t0 = must(await trees(), "index");
  const inbox = await openInbox(t0.snapshot.memos, ada, ctx);
  if (inbox.length !== 3) throw new Error(`Ada's inbox has ${inbox.length} payments, expected 3`);
  for (const [i, p] of inbox.entries()) {
    const t = must(await trees(), "index");
    const view = await chainViewOf(t, p, isSpentReader(client, dep.pool));
    if (view.kind !== "unspent") throw new Error(`payment ${i + 1} is ${view.kind} before the sweep`);
    const sweep = must(await prepareSweep(ctx, t, p), "prepareSweep");
    await settle(must(await relay.post("sweep", sweep.body()), `sweep ${i + 1}`), "3", `Ada sweeps payment ${i + 1} (${BigInt(p.note.amountWei) / TUSD} tUSD8) into a fresh note`);
    const after = await chainViewOf(must(await trees(), "index"), p, isSpentReader(client, dep.pool));
    if (after.kind !== "swept" || after.sweepCommitment !== sweep.fresh.commitment) throw new Error(`payment ${i + 1} not swept into Ada's note: ${after.kind}`);
  }

  // Act 3b: Acme still knows payment 1's secret and tries to spend it back.
  const acmeKey = await generateReceiveKey();
  const claw = must(await preparePay(ctx, must(await trees(), "index"), { payer: acme.address, source: sent[0]!, amount: BigInt(sent[0]!.amountWei), recipientTag: acmeKey.tag }), "clawback proof");
  const viaRelay = await relay.post("vouchedPay", claw.body(await acme.signTypedData(claw.typedData)));
  const relayCode = viaRelay.ok ? `sent (${viaRelay.value.state})` : viaRelay.error.code;
  const t = claw.transfer;
  const direct = await revertName(client, acme.address, dep.ledger, encodeFunctionData({ abi: ledgerAbi, functionName: "sweep", args: [{ ...t, newCommitments: [t.newCommitments[0], t.newCommitments[1]] }] }));
  if (relayCode !== "AlreadySpent" || direct !== "AlreadySpent") throw new Error(`clawback: relayer ${relayCode}, chain ${direct}; expected AlreadySpent twice`);

  const final = must(await trees(), "index");
  const addedV = count(final, "vouch") - count(before, "vouch");
  const addedS = count(final, "sweep") - count(before, "sweep");
  if (addedV !== 3 || addedS !== 3) throw new Error(`ledger gained ${addedV} V and ${addedS} S leaves, expected 3 and 3`);
  writeEvidence({
    rows, dep, rpc: RPC, base: BASE,
    checks: [
      `Acme's tQDAY balance: ${acmeGasBefore} before, ${acmeGasAfter} after the deposit and 3 pays (all gas paid by the relayer)`,
      `Acme's public tUSD8 balance after: ${await tusd8Balance(client, acme.address)} base units (10 tUSD8 moved into the pool)`,
      `Ada's inbox (memos opened with her receive key in this process): ${inbox.length} payments, ${inbox.map((p) => BigInt(p.note.amountWei) / TUSD).join(" + ")} tUSD8`,
      `Clawback of payment 1 by Acme: relayer refused with ${relayCode}; eth_call of ShaidaLedger.sweep from Acme reverts ${direct}`,
      `Ledger tree after: ${final.ledger.size} leaves (${count(final, "vouch")} V + ${count(final, "sweep")} S, this run added ${addedV} V + ${addedS} S), root known on chain at block ${final.block}; pool tree ${final.pool.size} leaves`,
    ],
  });
}

const count = (t: { snapshot: { ledgerLeaves: readonly { kind: string }[] } }, kind: string) => t.snapshot.ledgerLeaves.filter((l) => l.kind === kind).length;

async function revertName(client: ReturnType<typeof forkClient>, from: Address, to: Address, data: Hex): Promise<string> {
  try {
    await client.call({ account: from, to, data });
    return "no revert";
  } catch (e) {
    let raw: Hex | undefined;
    if (e instanceof BaseError) e.walk((x) => { const d = (x as { data?: unknown }).data; if (typeof d === "string" && d.startsWith("0x")) raw = d as Hex; return false; });
    return raw ? decodeErrorResult({ abi: relayErrorsAbi, data: raw }).errorName : `undecoded: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
}

main().then(
  () => process.exit(0), // snarkjs keeps worker threads alive after proving
  (e: unknown) => {
    writeEvidence({ rows, failure: e instanceof Error ? e.message : String(e), rpc: RPC, base: BASE });
    console.error(e);
    process.exit(1);
  },
);
