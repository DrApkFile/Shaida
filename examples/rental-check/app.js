// Kora Rentals (demo): a landlord platform's income check, in the browser, with shaida-sdk only.
import { definePolicy, underwrite } from "shaida-sdk";

// The fork fixture's deployment (tools/privacy/fixtures/fork-deployment-fixes.json), served by `pnpm --filter shaida-sdk fixture-rpc`.
const FORK = {
  network: { name: "aevum-fork (fixture replay)", chainId: 440050, ledger: "0xe1d24b9c95ebfd34ed0e153bf2dc03a6853f908e", incomeVerifier: "0xd5f5b75fae3bef2896c0176b3e5388414a7c895c", fromBlock: 4057880n },
  rpcUrl: "http://127.0.0.1:8565",
};
const tusd8 = (base) => `${Number(BigInt(base)) / 1e6} tUSD8`;
const day = (unix) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

// Kora's rule: at least 1 tUSD8 from 2+ payments over ≤ 92 days, proof built ≤ 30 days ago, link valid ≥ 7 more days.
function koraPolicy(readerName) {
  return definePolicy({
    id: "kora-rent-check", version: 1, title: "Kora Rentals rent check (demo)", audience: "landlord", readerName,
    minThreshold: "1000000", minPayments: 2, minPeriodDays: 1, maxPeriodDays: 92, maxProofAgeDays: 30, minDaysLeft: 7,
  });
}

function show(kind, text) {
  const out = document.getElementById("result");
  out.dataset.kind = kind;
  out.textContent = text;
}

document.getElementById("check").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const policy = koraPolicy(String(form.get("reader")));
  if (!policy.ok) return show("ERROR", `${policy.code}: ${policy.message}`);
  const where = form.get("network") === "fork" ? FORK : { network: "aevum-testnet" };
  show("PENDING", "Checking against the chain…");
  try {
    const d = await underwrite(String(form.get("link")), policy.policy, where);
    if (d.kind === "INCONCLUSIVE") return show(d.kind, `No answer yet (${d.error.code}): ${d.error.message}`);
    const facts = d.facts ? `\nProven: at least ${tusd8(d.facts.threshold)} from ${d.facts.count} payments, ${day(d.facts.fromDate)} to ${day(d.facts.toDate)}; link expires ${day(d.facts.expiry)}.` : "";
    const why = d.kind === "DECLINE" ? `\n${d.reasons.map((r) => `• ${r.code}: ${r.message}`).join("\n")}` : "";
    show(d.kind, `${d.kind === "APPROVE" ? "Approved" : "Declined"} under ${d.policy.id}@${d.policy.version}.${facts}${why}\nDecision ${d.decisionId.slice(0, 16)}…`);
  } catch (err) {
    show("ERROR", `${err.name}: ${err.message}`);
  }
});
