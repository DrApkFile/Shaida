// Scores the observer's guesses against a ground truth (shaida-privacy-truth/1). The truth is read only here.
// Verdict per attack: succeeds (every target right), partly (some), fails (none), — (no target in this data).

const verdict = (right, total) => (total === 0 ? "—" : right === total ? "succeeds" : right === 0 ? "fails" : "partly");
const big = (x) => (x === null || x === undefined ? null : BigInt(x));

export function score(r, truth, pays) {
  const T = new Map(truth.pays.map((p) => [p.hash, p]));
  const missing = pays.filter((p) => !T.has(p.hash)).map((p) => p.hash);
  if (missing.length) throw new Error(`the truth has no entry for payments ${missing.join(", ")}`);
  const out = {};

  // A1: exact amount per payment (bounds or withdrawal match); bounds must contain the truth (soundness).
  const a1 = r.a1.map((g) => ({ ...g, truth: big(T.get(g.pay).amount) }));
  const unsound = a1.filter((g) => g.truth < g.lo || (g.hi !== null && g.truth > g.hi)).map((g) => g.pay);
  const exactRight = a1.filter((g) => g.guess !== null && g.guess === g.truth).length;
  const exactWrong = a1.filter((g) => g.guess !== null && g.guess !== g.truth).length;
  out.A1 = { verdict: verdict(exactRight, a1.length), right: exactRight, wrong: exactWrong, total: a1.length, boundsContainTruth: unsound.length === 0, unsound, byBoundsAlone: a1.filter((g) => g.exact !== null && g.exact === g.truth).length };

  // A2: same-recipient pairs among payments the observer clustered (pairwise): a) sweep sessions alone, b) sessions
  // joined by attested holders; and recipients named by a withdrawal address.
  const pairScore = (cl) => {
    const hs = Object.keys(cl);
    let pairs = 0, right = 0;
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      pairs++;
      if ((cl[hs[i]] === cl[hs[j]]) === (T.get(hs[i]).recipient === T.get(hs[j]).recipient)) right++;
    }
    return { pairs, right, payments: hs.length };
  };
  const a2a = pairScore(r.a2.cluster), a2b = pairScore(r.a2.joined);
  const truthUnshield = new Map((truth.unshields ?? []).map((u) => [u.hash, u.pay]));
  const named = r.withdrawals.filter((w) => w.pay).map((w) => ({ ...w, right: truthUnshield.get(w.unshield) === w.pay }));
  out.A2 = { verdict: verdict(a2b.right, a2b.pairs), right: a2b.right, total: a2b.pairs, sessionsOnly: a2a, withAttests: a2b, paymentsTiedToAWithdrawalAddress: named.filter((n) => n.right).length, wronglyTied: named.filter((n) => !n.right).length };

  // A3: sweep → payment.
  const a3 = r.a3.map((g) => {
    const truePay = truth.pays.find((p) => p.sweep === g.sweep)?.hash ?? null;
    return { ...g, truePay, right: g.pay !== null && g.pay === truePay };
  });
  const right3 = a3.filter((g) => g.right).length;
  out.A3 = { verdict: verdict(right3, a3.length), right: right3, total: a3.length, randomGuessExpected: a3.reduce((s, g) => s + (g.candidates ? 1 / g.candidates : 0), 0), detail: a3.map(({ sweep, pay, truePay, candidates, right }) => ({ sweep, pay, truePay, candidates, right })) };

  // A4: total of each attested holder's payments (bounds contain the truth; exact when lo = hi) and their payers.
  const a4 = r.a4.map((g) => {
    const truthTotal = g.pays.reduce((s, h) => s + BigInt(T.get(h).amount), 0n);
    const truePayers = [...new Set(g.pays.map((h) => T.get(h).payer.toLowerCase()))].sort();
    const recipients = [...new Set(g.pays.map((h) => T.get(h).recipient))];
    return { attests: g.attests, recipients, truthTotal, lo: g.lo, hi: g.hi, contains: truthTotal >= g.lo && (g.hi === null || truthTotal <= g.hi), exact: g.lo === g.hi && g.lo === truthTotal, payersRight: JSON.stringify([...g.payers].sort()) === JSON.stringify(truePayers) };
  });
  const right4 = a4.filter((g) => g.exact && g.payersRight).length;
  out.A4 = { verdict: verdict(right4, a4.length), right: right4, total: a4.length, sound: a4.every((g) => g.contains), detail: a4 };

  // A5: payer per payment.
  const right5 = r.a5.filter((g) => g.calldataPayer === T.get(g.pay).payer.toLowerCase()).length;
  out.A5 = { verdict: verdict(right5, r.a5.length), right: right5, total: r.a5.length, allThreeAgree: r.a5.every((g) => g.agree) };

  // A6: public by design; scored as: every deposit and withdrawal amount read exactly.
  const d = (truth.deposits ?? []).filter((x) => r.a6.deposits.some((y) => y.hash === x.hash && y.amount === BigInt(x.amount))).length;
  const w = (truth.unshields ?? []).filter((x) => r.a6.withdrawals.some((y) => y.hash === x.hash && y.amount === BigInt(x.amount))).length;
  const n6 = (truth.deposits ?? []).length + (truth.unshields ?? []).length;
  out.A6 = { verdict: verdict(d + w, n6), right: d + w, total: n6, sameEntity: r.a6.sameEntity };
  return out;
}
