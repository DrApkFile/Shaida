// Plain-text summaries of the observer's and the reader's results (the JSON files hold everything).

const usd = (u) => (u === null || u === undefined ? "∞" : (() => { const s = BigInt(u).toString().padStart(7, "0"); return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, ""); })());
const short = (h) => (h === null || h === undefined ? "—" : `${String(h).slice(0, 10)}…`);

export function renderObserver(r) {
  const L = [];
  L.push(`chain ${r.chainId}, blocks ${r.blocks[0]}–${r.blocks[1]}; actions: ${Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  L.push(`completeness: explorer ${r.completeness.explorer}; only in explorer ${r.completeness.onlyInExplorer.length}; failed txs ${r.completeness.failedInExplorer.length}`);
  L.push(`volume: ${JSON.stringify(r.volume)}`);
  L.push("", "A5 payer per payment:");
  for (const g of r.a5) L.push(`  ${short(g.pay)} payerId ${g.payerId} calldata ${g.calldataPayer} signer ${g.signer ?? "—"} registry ${g.registryAccount} agree ${g.agree}`);
  L.push("", "A3 sweep → payment (FIFO):");
  for (const g of r.a3) L.push(`  sweep ${short(g.sweep)} → pay ${short(g.pay)} of ${g.candidates} candidates, ${g.delayBlocks} blocks later`);
  L.push("", `A2 sweep sessions: ${r.a2.sessions.map((s) => s.length).join(", ")}`);
  L.push("", "A1 amount per payment (tUSD8):");
  for (const g of r.a1) L.push(`  ${short(g.pay)} [${usd(g.lo)}, ${usd(g.hi)}]${g.exact !== null ? " exact" : ""}${g.fromWithdrawal !== null ? ` withdrawal ${usd(g.fromWithdrawal)}` : ""}`);
  L.push("", "A4 attested holders:");
  for (const g of r.a4) L.push(`  attests ${g.attests.map(short).join(" ")} (senders ${g.senders.map(short).join(" ")}): ${g.pays.length} payments, total [${usd(g.lo)}, ${usd(g.hi)}], payer ids ${g.payerIds.join(", ")}`);
  L.push("", `A6 in ${usd(r.a6.totals.in)} out ${usd(r.a6.totals.out)}; payer funders ${[...new Set(r.a6.fundedPayers.map((h) => h.from))].join(" ")}; withdrawals forwarded to ${[...new Set(r.a6.forwarded.map((h) => h.to))].join(" ")}; same entity ${r.a6.sameEntity.join(" ") || "none"}`);
  L.push("", `memos: ${r.memo.count}, lengths ${r.memo.lengths.join("/")}, common prefix ${r.memo.commonPrefixBytes} bytes (constant header ${r.memo.constantHeaderBytes}), ${r.memo.distinctEphemeralKeys} distinct ephemeral keys`);
  if (r.score) {
    L.push("", "score against the ground truth:");
    for (const [k, v] of Object.entries(r.score)) L.push(`  ${k}: ${v.verdict} (${v.right ?? v.pairsRight}/${v.total ?? v.pairs})`);
  }
  return L.join("\n");
}

export function renderReader(r) {
  const L = [];
  for (const l of r.links) {
    L.push(`${l.name}: ${l.proofs.length} proof(s); reader hash ${l.readerIdHash ? short(l.readerIdHash) : "— (not in the source)"}; expiry ${l.expiryIso ?? "—"}${l.expiryHint ? ` (${l.expiryHint})` : ""}`);
    for (const p of l.proofs) {
      L.push(`  ≥ ${usd(p.threshold)} tUSD8, count ${p.count}, leaves ${p.fromIndex}–${p.toIndex} (${p.fromTime ?? "—"} → ${p.toTime ?? "—"}), root known ${p.rootIsKnown}`);
      L.push(`  leaves in range: ${p.vouchLeaves.length} V (payer ids ${[...new Set(p.vouchLeaves.map((v) => v.payerId))].join(", ")}), ${p.sweepLeaves.length} S; V = count: ${p.vouchLeaves.length === Number(p.count)}`);
      L.push(`  total of the range's payments, with chain data: [${usd(p.total.lo)}, ${usd(p.total.hi)}]; had nobody attested on chain: [${usd(p.totalWithoutChainAttests.lo)}, ${usd(p.totalWithoutChainAttests.hi)}]`);
    }
    L.push(`  holder's total: [${usd(l.holderTotal.lo)}, ${usd(l.holderTotal.hi)}]; had nobody attested on chain: [${usd(l.holderTotalWithoutChainAttests.lo)}, ${usd(l.holderTotalWithoutChainAttests.hi)}]`);
    if (l.score) L.push(`  score: ${JSON.stringify(l.score, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);
  }
  return L.join("\n");
}
