// The observer's attacks on a dump (A1–A6). Every guess uses only the dump: public calldata, events, metadata and
// tUSD8 transfers. The ground truth, when given, is used only by score.mjs, after the guesses are made.
import { amountModel, coveredBy, matchWithdrawals } from "./amounts.mjs";
import { actionsOf, FIELD_CLASSES, META_FIELDS } from "./decode.mjs";
import { memoShape } from "./memo.mjs";
import { score } from "./score.mjs";

/** Sweeps closer than this to the previous sweep (and with no payment between) are one session. ~5 min on Aevum. */
export const SESSION_GAP_BLOCKS = 300;

export async function analyse(dump, truth = null) {
  const actions = await actionsOf(dump);
  const of = (k) => actions.filter((a) => a.kind === k && a.status === "success");
  const pays = [...of("vouchedPay"), ...of("lateVouch")].sort((a, b) => a.block - b.block || a.index - b.index);
  const sweeps = of("sweep"), deposits = of("deposit"), unshields = of("unshield"), attests = of("attest"), registers = of("register"), memos = of("memo");
  checkClassified(actions);

  // A5: the payer of each payment, three ways that must agree.
  const registry = new Map(registers.map((r) => [r.payerId, r.account]));
  const a5 = pays.map((p) => ({ pay: p.hash, payerId: p.payerId, calldataPayer: p.payer, signer: p.signer ?? null, registryAccount: registry.get(p.payerId) ?? null, agree: [p.signer ?? p.payer, registry.get(p.payerId)].every((x) => x === p.payer) }));

  // A3: each sweep to a payment, first in first out, with the anonymity set it was picked from.
  const open = [];
  let next = 0;
  const a3 = sweeps.map((s) => {
    while (next < pays.length && pays[next].block < s.block) open.push(pays[next++]);
    const candidates = open.length;
    const guess = open.shift() ?? null;
    return { sweep: s.hash, pay: guess?.hash ?? null, candidates, delayBlocks: guess ? s.block - guess.block : null };
  });

  // A2: sessions of sweeps (one recipient sweeping); payments inherit the session of the sweep A3 gave them.
  const sessions = [];
  sweeps.forEach((s, k) => {
    const prev = sweeps[k - 1];
    const payBetween = prev && pays.some((p) => p.block > prev.block && p.block < s.block);
    if (!prev || s.block - prev.block > SESSION_GAP_BLOCKS || payBetween) sessions.push([]);
    sessions.at(-1).push(s.hash);
  });
  const sessionOfSweep = new Map(sessions.flatMap((ss, i) => ss.map((h) => [h, i])));
  const cluster = new Map(a3.filter((x) => x.pay).map((x) => [x.pay, sessionOfSweep.get(x.sweep)]));

  // A1 and A4: bounds from deposits and attests, then withdrawals matched to swept payments.
  const model = amountModel(pays, deposits, attests);
  const sweptOrder = a3.filter((x) => x.pay).map((x) => ({ pay: x.pay, sweepBlock: sweeps.find((s) => s.hash === x.sweep).block }));
  const withdrawals = matchWithdrawals(unshields, sweptOrder, model.bounds);
  const a1 = pays.map((p) => {
    const b = model.bounds.get(p.hash);
    const w = withdrawals.find((x) => x.pay === p.hash);
    return { pay: p.hash, lo: b.lo, hi: b.hi, exact: b.lo === b.hi ? b.lo : null, fromWithdrawal: w ? w.amount : null, guess: b.lo === b.hi ? b.lo : (w ? w.amount : null) };
  });
  const holders = holderClusters(attests);
  const a4 = holders.map((group) => {
    const set = [...new Set(group.flatMap((a) => coveredBy(pays, a).map((p) => p.hash)))];
    const payerIds = [...new Set(pays.filter((p) => set.includes(p.hash)).map((p) => p.payerId))];
    // A range whose vouch leaves number exactly `count` holds only the holder's payments.
    const onlyHolders = group.every((a) => coveredBy(pays, a).length === Number(a.signals.count));
    const perAttest = group.map((a) => { const s = coveredBy(pays, a); return { attest: a.hash, threshold: a.signals.threshold, count: a.signals.count, fromIndex: a.signals.fromIndex, toIndex: a.signals.toIndex, vouchesInRange: s.length, ...model.total(s.map((p) => p.hash)) }; });
    return { attests: group.map((a) => a.hash), senders: [...new Set(group.map((a) => a.sender))], pays: set, onlyHolders, ...model.total(set), payerIds, payers: payerIds.map((id) => registry.get(id) ?? null), perAttest };
  });
  // A2b: sessions joined by attested holders (when a range holds only the holder's payments).
  const joined = new Map(cluster);
  a4.filter((g) => g.onlyHolders).forEach((g, i) => {
    const ids = new Set(g.pays.map((h) => joined.get(h)).filter((x) => x !== undefined));
    for (const [h, c] of joined) if (ids.has(c)) joined.set(h, `holder${i}`);
    for (const h of g.pays) joined.set(h, `holder${i}`);
  });

  // A6: public money in and out, and one hop around it.
  const a6 = {
    deposits: deposits.map((d) => ({ hash: d.hash, block: d.block, time: d.time, payer: d.payer, amount: d.amount, gasless: d.gasless })),
    withdrawals: unshields.map((u) => ({ hash: u.hash, block: u.block, time: u.time, to: u.to, amount: u.amount })),
    fundedPayers: dump.tokenHops.filter((h) => deposits.some((d) => d.payer === h.to)).map((h) => ({ hash: h.hash, block: h.block, from: h.from, to: h.to, value: h.value })),
    forwarded: dump.tokenHops.filter((h) => unshields.some((u) => u.to === h.from)).map((h) => ({ hash: h.hash, block: h.block, from: h.from, to: h.to, value: h.value })),
  };
  a6.sameEntity = [...new Set(a6.fundedPayers.map((h) => h.from))].filter((x) => a6.forwarded.some((h) => h.to === x));
  a6.totals = { in: deposits.reduce((s, d) => s + d.amount, 0n), out: unshields.reduce((s, u) => s + u.amount, 0n) };

  const metadata = metadataOf(actions, pays, memos);
  const result = {
    schema: "shaida-privacy-observer/1", chainId: dump.chainId, blocks: [dump.fromBlock, dump.toBlock], completeness: dump.completeness,
    counts: Object.fromEntries([...new Set(actions.map((a) => a.kind))].map((k) => [k, actions.filter((a) => a.kind === k).length])),
    fields: { classes: FIELD_CLASSES, meta: META_FIELDS }, volume: volumeOf(pays, sweeps, registers),
    a1, withdrawals, a2: { sessions, cluster: Object.fromEntries(cluster), joined: Object.fromEntries(joined) }, a3, a4, a5, a6, metadata, memo: memoShape(memos),
    model: model.constraints,
  };
  if (truth) result.score = score(result, truth, pays);
  return result;
}

/** Attests by the same sender, or over the same leaf range, are one holder's (heuristic). */
function holderClusters(attests) {
  const groups = [];
  for (const a of attests) {
    const same = groups.find((g) => g.some((b) => b.sender === a.sender || (b.signals.fromIndex === a.signals.fromIndex && b.signals.toIndex === a.signals.toIndex)));
    if (same) same.push(a); else groups.push([a]);
  }
  return groups;
}

function checkClassified(actions) {
  const base = new Set(["hash", "block", "time", "index", "sender", "nonce", "gasUsed", "gasLimit", "status", "calldataBytes", "txType", "kind", "fn", "contract", "signals", "signer"]);
  for (const a of actions) for (const k of Object.keys(a)) {
    if (base.has(k)) continue;
    if (!(FIELD_CLASSES[a.kind] ?? []).some(([n]) => n === k)) throw new Error(`field ${a.kind}.${k} has no class in FIELD_CLASSES`);
  }
}

function volumeOf(pays, sweeps, registers) {
  const days = new Set(pays.map((p) => new Date(p.time * 1000).toISOString().slice(0, 10)));
  return { registeredPayers: registers.length, payingPayers: new Set(pays.map((p) => p.payerId)).size, payments: pays.length, sweeps: sweeps.length, daysWithPayments: days.size };
}

function metadataOf(actions, pays, memos) {
  const byKind = {};
  for (const a of actions) {
    const k = (byKind[a.kind] ??= { senders: new Set(), gas: [], calldata: new Set() });
    k.senders.add(a.sender); k.gas.push(a.gasUsed); k.calldata.add(a.calldataBytes);
  }
  const memoDelay = memos.map((m) => { const p = pays.find((x) => x.paymentCommitment === m.paymentCommitment); return { memo: m.hash, pay: p?.hash ?? null, delayBlocks: p ? m.block - p.block : null }; });
  return {
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { senders: [...v.senders], gasMin: Math.min(...v.gas), gasMax: Math.max(...v.gas), calldataBytes: [...v.calldata] }])),
    pays: pays.map((p) => ({ pay: p.hash, leafIndex: p.leafIndex, gasUsed: p.gasUsed, calldataBytes: p.calldataBytes })),
    memoDelay, legacyOnly: actions.every((a) => a.txType === 0),
  };
}
