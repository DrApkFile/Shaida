// A1 and A4: what public numbers say about private amounts. Sound bounds from linear constraints:
//   - each payment is at least 1 base unit;
//   - a payer's payments so far add up to at most the payer's deposits so far (ASSUMPTION: a payer's private
//     funds come only from their own public deposits; a payer who also receives private payments breaks it);
//   - an attested proof over ledger leaves [fromIndex, toIndex] shows that the payments vouched in that range add
//     up to at least its threshold (the counted ones are a subset of them, and every payment is positive).
// Constraints are closed under subtraction (Σ_A ≤ C and Σ_B ≥ T with B ⊆ A give Σ_{A∖B} ≤ C − T), then bounds are
// propagated to a fixpoint. Then a heuristic: a withdrawal (public amount) is a whole swept note, matched first in,
// first out to the swept payments (sweep order from A3), kept when its amount fits the payment's bounds.

const sum = (xs) => xs.reduce((s, x) => s + x, 0n);
const subset = (a, b) => a.every((x) => b.includes(x));
const key = (set) => [...set].sort().join(",");

/** Payments whose vouch leaf lies in an attested proof's range. */
export const coveredBy = (pays, attest) =>
  pays.filter((p) => p.leafIndex >= attest.signals.fromIndex && p.leafIndex <= attest.signals.toIndex);

export function amountModel(pays, deposits, attests) {
  let atMost = [], atLeast = [];
  // No cap for a payer with no deposit seen: their funds came some other way, and 0 would be a false bound.
  for (const payer of new Set(pays.map((p) => p.payer)).values().filter((x) => deposits.some((d) => d.payer === x))) {
    const own = pays.filter((p) => p.payer === payer);
    own.forEach((p, k) => atMost.push([own.slice(0, k + 1).map((x) => x.hash), sum(deposits.filter((d) => d.payer === payer && d.block <= p.block).map((d) => d.amount))]));
  }
  for (const a of attests) atLeast.push([coveredBy(pays, a).map((p) => p.hash), a.signals.threshold]);
  for (let round = 0; round < 3; round++) {
    const seen = new Set([...atMost.map(([s, c]) => `≤${key(s)}:${c}`), ...atLeast.map(([s, t]) => `≥${key(s)}:${t}`)]);
    const add = (list, tag, set, v) => { const k = `${tag}${key(set)}:${v}`; if (set.length && !seen.has(k)) { seen.add(k); list.push([set, v]); } };
    const moreMost = [], moreLeast = [];
    for (const [A, C] of atMost) for (const [B, T] of atLeast) {
      if (subset(B, A)) add(moreMost, "≤", A.filter((x) => !B.includes(x)), C - T);
      if (subset(A, B)) add(moreLeast, "≥", B.filter((x) => !A.includes(x)), T - C);
    }
    atMost = [...atMost, ...moreMost];
    atLeast = [...atLeast, ...moreLeast];
  }

  const lo = new Map(pays.map((p) => [p.hash, 1n]));
  const hi = new Map(pays.map((p) => [p.hash, null])); // null = unbounded
  for (let changed = true, rounds = 0; changed && rounds < 1000; rounds++) {
    changed = false;
    for (const [set, cap] of atMost) for (const h of set) {
      const v = cap - sum(set.filter((x) => x !== h).map((x) => lo.get(x)));
      if (hi.get(h) === null || v < hi.get(h)) { hi.set(h, v); changed = true; }
    }
    for (const [set, floor] of atLeast) for (const h of set) {
      const others = set.filter((x) => x !== h).map((x) => hi.get(x));
      if (others.includes(null)) continue;
      const v = floor - sum(others);
      if (v > lo.get(h)) { lo.set(h, v); changed = true; }
    }
  }
  const bounds = new Map(pays.map((p) => [p.hash, { lo: lo.get(p.hash), hi: hi.get(p.hash) }]));
  const payerOf = new Map(pays.map((p) => [p.hash, p.payer]));

  /** Sound bounds on the total of a set of payment hashes. */
  function total(set) {
    // Floors of disjoint ≥ constraints inside the set add up (greedy, largest first: sound, not always tight).
    const used = new Set();
    let l = 0n;
    for (const [B, T] of [...atLeast].filter(([B]) => subset(B, set)).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))) {
      if (B.some((x) => used.has(x))) continue;
      const own = sum(B.map((x) => lo.get(x)));
      l += T > own ? T : own;
      B.forEach((x) => used.add(x));
    }
    l += sum(set.filter((x) => !used.has(x)).map((x) => lo.get(x)));
    // Upper bound per payer (each payer's deposits cap only that payer's payments), then added up.
    let u = 0n;
    for (const payer of new Set(set.map((h) => payerOf.get(h)))) {
      const g = set.filter((h) => payerOf.get(h) === payer);
      let gu = g.some((h) => hi.get(h) === null) ? null : sum(g.map((h) => hi.get(h)));
      for (const [A, C] of atMost) if (subset(g, A)) { const v = C - sum(A.filter((x) => !g.includes(x)).map((x) => lo.get(x))); if (gu === null || v < gu) gu = v; }
      if (gu === null) return { lo: l, hi: null };
      u += gu;
    }
    return { lo: l, hi: u };
  }
  return { bounds, total, constraints: { atMost: atMost.length, atLeast: atLeast.length } };
}

/** FIFO match of withdrawals to swept payments, kept only when the amount fits the payment's bounds. */
export function matchWithdrawals(unshields, sweptOrder, bounds) {
  const queue = [...sweptOrder]; // [{ pay, sweepBlock }] oldest sweep first
  const out = [];
  for (const u of unshields) {
    const k = queue.findIndex((s) => s.sweepBlock < u.block);
    if (k < 0) { out.push({ unshield: u.hash, pay: null, amount: u.amount, why: "no swept payment before it" }); continue; }
    const [s] = queue.splice(k, 1);
    const b = bounds.get(s.pay);
    const fits = u.amount >= b.lo && (b.hi === null || u.amount <= b.hi);
    out.push({ unshield: u.hash, pay: fits ? s.pay : null, amount: u.amount, why: fits ? "FIFO, fits the bounds" : `FIFO candidate ${s.pay} but ${u.amount} is outside [${b.lo}, ${b.hi}]` });
  }
  return out;
}
