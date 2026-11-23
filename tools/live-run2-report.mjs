#!/usr/bin/env node
// Writes evidence/live-44005-run2.md for live run 2 (checklist C in evidence/budget.md): every row is read from the
// chain by its tx hash (receipt, sender, block time, balances at the block before and the block of the tx). The
// hashes are the ones the builder's clicks produced in the hosted UI; what only the browser showed (proving time,
// screens) comes from the builder's report and the screenshots, and is labelled so. Read-only: sends nothing.
// Usage: node tools/live-run2-report.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RPC = "https://rpc-test.qday.info";
const X = "https://explorer-test.qday.info";
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
const INCOME_VERIFIER = "0xc9844a8f058be2d658c972d1d2276b13f308e1c8";
const A = {
  deployer: "0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698",
  relayer: "0xF4945dD57C8de1C637966179df5b631689901422",
  reader: "0xbed994a7fD0e7A49DAD09866e86817ccA6Ea785E",
  acme: "0xA1ddEB46A1060C8970E68C3dA34427B1a7B91D4b",
};
const STEPS = [
  ["R0", "deployer sends 1 tUSD8 to Acme Studio (demo) (builder's terminal)", "0x948664bc7186149cb2070770d21bfc46a9e99faebeab078c9fa176eac2b86d79", "deployer"],
  ["R2", "Acme: gasless deposit of 1 tUSD8 (signed in MetaMask, relayed)", "0xb6bcbc4098fb07260d50125b17be654716fe647b4ad500173873c9578c4dde02", "relayer"],
  ["R3", "Acme: vouched pay of 0.5 tUSD8 to Ada (Invoice 1 (demo))", "0x98c64110aec9049f1745dd8564c7c5418c0aaf6dd6a0d184517cc4d16f68e27a", "relayer"],
  ["R3", "sealed memo 1", "0x7133172534dafc02bf387a7ceec644f0708a066e5113dce03a2d80f776374428", "relayer"],
  ["R4", "Acme: vouched pay of 0.3 tUSD8 to Ada (Invoice 2(demo))", "0x097cb2fb8ab58448c81e78fc3d3ffec0f6c4316e4b9e5ea29e9958b2907b21a2", "relayer"],
  ["R4", "sealed memo 2", "0x5550cefe9ab9ae6ed2344dda54f47f7370bdde67e4cbeaf5ad59431fffa290a5", "relayer"],
  ["R5", "Acme: vouched pay of 0.2 tUSD8 to Ada (Invoice 3(demo))", "0x23233274a33772f4cca01885bfadf1f05f7ddcf868593f6e348e77c7860f4a30", "relayer"],
  ["R5", "sealed memo 3", "0x0f88eb47428114426a5ab4bad0944c40e4c569f18edb5b38e748aaf416b29850", "relayer"],
  ["R7", "Ada: sweep (Sweep all 3, 1 of 3)", "0x754f902959ee96cc563d883edec0eeb2f89046402dddb1326396d755b8564dfa", "relayer"],
  ["R7", "Ada: sweep (2 of 3)", "0xf92f4e20662f2344b91b2cceabaf9c7ae5f25f511f99904713f7e45e3bdc8180", "relayer"],
  ["R7", "Ada: sweep (3 of 3)", "0xf4c1256f1abd7d799fe1b2decc47555e959ad48d087e10faac637d04f8a5da0c", "relayer"],
  ["R13", "Bola: Record check (IncomeVerifier.attest from the reader wallet in MetaMask)", "0x054356813d7e88de742ae78079174e94772a46baa6d4f9de5eb5ffc0241111ec", "reader"],
];

let id = 0;
async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
    }
  }
}
const hex = (n) => `0x${n.toString(16)}`;
const eth = (wei) => { const s = wei.toString().padStart(19, "0"); return `${s.slice(0, -18)}.${s.slice(-18, -9)}`; };
const usd = (u) => { const s = u.toString().padStart(7, "0"); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, ""); };
const balance = async (a, b) => BigInt(await rpc("eth_getBalance", [a, hex(b)]));
const tusd8 = async (a, b) => BigInt(await rpc("eth_call", [{ to: TUSD8, data: `0x70a08231${a.slice(2).toLowerCase().padStart(64, "0")}` }, hex(b)]));
const short = (h) => `[\`${h.slice(0, 10)}…\`](${X}/tx/${h})`;
const commas = (n) => n.toLocaleString("en-US");

async function main() {
  const rows = [];
  const facts = [];
  let relayerGas = 0n;
  for (const [step, what, hash, sender] of STEPS) {
    const [rc, tx] = await Promise.all([rpc("eth_getTransactionReceipt", [hash]), rpc("eth_getTransactionByHash", [hash])]);
    if (!rc || rc.status !== "0x1") throw new Error(`${step} ${hash}: not mined with status 1`);
    if (tx.from.toLowerCase() !== A[sender].toLowerCase()) throw new Error(`${step} ${hash}: sent by ${tx.from}, expected the ${sender}`);
    const block = BigInt(rc.blockNumber);
    const time = new Date(Number(BigInt((await rpc("eth_getBlockByNumber", [hex(block), false])).timestamp)) * 1000).toISOString();
    const gas = BigInt(rc.gasUsed);
    const fee = gas * BigInt(rc.effectiveGasPrice ?? tx.gasPrice);
    const [relBefore, relAfter, readerAfter, depAfter, depUsd, acmeUsd] = await Promise.all([
      balance(A.relayer, block - 1n), balance(A.relayer, block), balance(A.reader, block), balance(A.deployer, block), tusd8(A.deployer, block), tusd8(A.acme, block),
    ]);
    if (sender === "relayer") relayerGas += fee;
    rows.push(`| ${step} | ${what} | ${sender} | ${short(hash)} | ${block} | ${time.slice(11, 19)} | ${commas(Number(gas))} / ${commas(Number(BigInt(tx.gas)))} | ${eth(fee)} | ${eth(relBefore)} → ${eth(relAfter)} | ${eth(readerAfter)} | ${eth(depAfter)} / ${usd(depUsd)} | ${usd(acmeUsd)} |`);
    if (step === "R13") {
      const log = rc.logs.find((l) => l.address.toLowerCase() === INCOME_VERIFIER);
      if (!log) throw new Error("R13: no IncomeVerifier log");
      const threshold = BigInt(`0x${log.data.slice(2, 66)}`);
      const count = BigInt(`0x${log.data.slice(66, 130)}`);
      facts.push(`R13 emitted IncomeProofChecked(context ${log.topics[1].slice(0, 12)}…, threshold ${threshold} (${usd(threshold)} tUSD8), count ${count}) from IncomeVerifier \`${INCOME_VERIFIER}\` at ${time}.`);
    }
  }
  const head = BigInt(await rpc("eth_blockNumber", []));
  const [dep, depU, rel, rdr, acmeU, poolU] = await Promise.all([
    balance(A.deployer, head), tusd8(A.deployer, head), balance(A.relayer, head), balance(A.reader, head), tusd8(A.acme, head), tusd8("0x0d93a398de615c92b04961dd042471fea4b7eac6", head),
  ]);
  const out = `# Live run 2 on Aevum testnet (44005): clicked by a person in the hosted UI

Generated by \`node tools/live-run2-report.mjs\` from the chain (each row read by its tx hash). Do not edit by hand.
Personas are demo: Acme Studio (demo), Ada (demo), Landlord Bola (demo). Plan and per-step notes: evidence/budget.md
(checklist C). Screens: evidence/ui-44005/.

| Field | Value |
|---|---|
| Site | https://shaida.onrender.com (Render; /api/relay, /api/index), commits \`2c64d5b\` (R0–R9) and \`5120b24\` (R9 again – R13, see below) |
| Who clicked | the builder, by hand, in Firefox 157.0.1 (Responsive Design Mode 390 × 844); the agent only read the chain between steps |
| Profiles | Ada (demo): the builder's normal Firefox profile, no wallet, vault restored from \`ada-after-batch.vault.json\`. Acme (demo) and Bola (demo): profile \`shaida-acme-bola\` with a fresh MetaMask holding only those two accounts |
| Machine | Intel Core i3 M 370 @ 2.40 GHz, 7.5 GB RAM (the builder's machine, also used for run 1) |
| Read at block | ${head} |

| Step | What | Sender | Tx | Block | UTC | Gas used / limit | Fee (tQDAY) | Relayer tQDAY before → after | Reader tQDAY after | Deployer tQDAY / tUSD8 after | Acme tUSD8 after |
|---|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}

Relayer gas fees in this run: ${eth(relayerGas)} tQDAY.

## Read from the chain
${facts.map((f) => `- ${f}`).join("\n")}
- After the run (block ${head}): deployer ${eth(dep)} tQDAY / ${usd(depU)} tUSD8; relayer ${eth(rel)} tQDAY; reader ${eth(rdr)} tQDAY; Acme ${usd(acmeU)} tUSD8; pool holds ${usd(poolU)} tUSD8 (Ada's 3 swept notes of this run; run 1's were withdrawn in the batch, CL40).

## Shown in the browser (the builder's report and screenshots, not re-derivable from the chain)
- R1: Ada's restored vault shows the same receive address as run 1 (\`gloamr1.MFkwEwYH…JLM46HQ\`) → 390-03.
- R2: Acme's panel: his address, Registered payer yes #1 → 390-04, **taken after the deposit (it shows Public tUSD8 0; the file is from 20:19 local, the deposit mined 19:17:29 UTC = 20:17 local), so no screen shows the public 1 tUSD8 before it; the chain does (R0 row, Acme tUSD8 after = 1)**. The deposit ticked, private balance 1 tUSD8, 1 spendable note at block 3942194 → 390-06. **390-05 (deposit signed) was not taken.**
- R3–R5: all 6 steps done for each pay → 390-07, 390-08, 390-09; Acme's private balance then 0 (builder's report; not in the screenshot).
- R6–R7: Ada's inbox lists the 3 payments (memo blocks 3943219, 3943578, 3943859) as "seen", then "swept: yours alone" → 390-10, 390-11.
- R8: /app/prove lists 6 countable payments; run 2's at ledger leaves 6, 7, 8, paid 23 Nov 2026 → 390-12.
- R9: From = To = 23 Nov 2026, at least 1 tUSD8, step 1 tUSD8, reader "Landlord Bola": "3 countable payment(s), 1 tUSD8" → 390-13.
- R10: **one proof with the final income key in Firefox 157.0.1 at 390 px: Proving 16.2 s in this browser (1 proof)**; the card says "checked here: VALID", at least 1 tUSD8, 3 payments, 23 Nov 2026 – 23 Nov 2026, expires 23 Dec 2026 → 390-14.
- R11: Bola, "Landlord Bola" → VALID, at least 1 tUSD8 in 3 payments, 23 Nov 2026 → 1247-15. R12: "IncomeVerifier.check passed for 1 proof at block 3947375. Nothing was sent." → 1247-16. R13: "Recorded in block 3947708" → 1247-17. These three screens were taken at desktop width (1,247 px; the tab was outside Responsive Design Mode), so they carry that width in their names.

## Found during the run
- /app/prove reset the form about every 15 s (the inputs query was keyed on the tree's block, so each refresh unmounted the form; a built link would have gone too). Fixed in \`5120b24\` (keyed on leaf and memo counts, previous data kept), checked headless on the live site (fields kept 60 s), redeployed, then R9 was redone.
- The memo notes were typed as "Invoice 2(demo)" and "Invoice 3(demo)" (no space); recorded as typed.
- R1: the builder first created an empty vault in Ada's profile, then replaced it with the backup ("Replace the vault already in this browser"); the empty vault held nothing.
`;
  writeFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "evidence/live-44005-run2.md"), out);
  console.log(out);
}
main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
