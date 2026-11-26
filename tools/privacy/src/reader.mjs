// The reader's privacy audit: what someone holding a proof link learns, first from the link alone, then together
// with the public chain (the dump). The ground truth, when given, is read only by scoreLink, after the analysis.
import { contextOf, decodeFragment, incomeLinkSchema, LedgerTree, readerIdHashOf, SHARE_STEP } from "@shaida/proofs";
import { amountModel } from "./amounts.mjs";
import { SIGNALS } from "./abi.mjs";
import { actionsOf } from "./decode.mjs";

const iso = (t) => new Date(Number(t) * 1000).toISOString();

/** A link from its fragment (or a full /v…#… URL), or a proof rebuilt from an attest's calldata (no context data). */
export function linkFromUrl(url) {
  const fragment = url.slice(url.indexOf("#") + 1);
  const d = decodeFragment(fragment);
  if (!d.ok) throw new Error(`not a proof link: ${d.why}`);
  const link = incomeLinkSchema.parse(d.json);
  return {
    proofs: link.proofs.map((p) => signalsOf(p.publicSignals)), readerIdHash: BigInt(link.readerIdHash), expiry: BigInt(link.expiry), salt: BigInt(link.salt), fragmentChars: fragment.length,
    version: link.v, readerMode: link.v === 1 ? "name" : link.reader,
  };
}
export function linkFromAttest(actions, hash) {
  const a = actions.find((x) => x.kind === "attest" && x.hash === hash);
  if (!a) throw new Error(`no attest ${hash} in the dump`);
  return { proofs: [Object.fromEntries(SIGNALS.map((n) => [n, BigInt(a.signals[n])]))], readerIdHash: null, expiry: null, salt: null, fromAttest: hash, version: null, readerMode: null };
}
const signalsOf = (arr) => Object.fromEntries(SIGNALS.map((n, i) => [n, BigInt(arr[i])]));

/** What the expiry's time of day says: an end of day in some UTC offset (a browser's), or an exact "now + N days". */
export function expiryHint(expiry) {
  const secs = Number(expiry % 86400n);
  // Since D32 F8 the app ends every link at 23:59:59 UTC: that says nothing about the maker (a maker in a UTC zone
  // before F8 looks the same).
  if (secs === 86399) return "23:59:59 UTC: the app's default since D32 F8, the same for every maker";
  for (let k = -12; k <= 14; k++) if (((86399 - k * 3600) % 86400 + 86400) % 86400 === secs) return `23:59:59 local time at UTC${k >= 0 ? "+" : "−"}${Math.abs(k)}: the maker's time zone`;
  return `not an end of day: an exact time, so made at expiry − the expiry period (${iso(expiry - 30n * 86400n)} if 30 days)`;
}

export async function analyseLinks(dump, inputs, { readerNames = [] } = {}) {
  const actions = await actionsOf(dump);
  const ok = (k) => actions.filter((a) => a.kind === k && a.status === "success");
  const pays = [...ok("vouchedPay"), ...ok("lateVouch")];
  const sweeps = ok("sweep"), deposits = ok("deposit"), attests = ok("attest");
  const revoked = new Map(ok("revokeLink").map((r) => [BigInt(r.salt), r]));
  const registry = new Map(ok("register").map((r) => [r.payerId, r.account]));
  const leaves = [...pays.map((p) => ({ index: Number(p.leafIndex), leaf: BigInt(p.leaf), time: p.time, kind: "V", payerId: p.payerId, pay: p.hash })), ...sweeps.map((s) => ({ index: Number(s.leafIndex), leaf: BigInt(s.leaf), time: s.time, kind: "S", sweep: s.hash }))].sort((a, b) => a.index - b.index);
  const rootAt = new Map();
  for (let n = 1; n <= leaves.length; n++) rootAt.set(new LedgerTree(leaves.slice(0, n).map((l) => l.leaf)).root, n);

  return inputs.map(({ name, link }) => {
    const ctxOk = link.readerIdHash === null ? null : link.proofs.every((p) => p.context === contextOf(link.readerIdHash, link.expiry, link.salt));
    // A name guess confirms a name-only link's reader. A code-protected link's reader id also hashes the reader's
    // 80-bit code (D36), so a name list alone confirms nothing (evidence/reader-code-work.md: the cost of guessing).
    const nameMatches = link.readerIdHash === null ? [] : readerNames.filter((n) => { const h = readerIdHashOf(n); return h.ok && h.value === link.readerIdHash; });
    const rv = link.salt === null ? null : revoked.get(link.salt) ?? null;
    const own = link.proofs.map((s) => ({ signals: s }));
    const chainAttests = attests.map((a) => ({ signals: Object.fromEntries(SIGNALS.map((n) => [n, BigInt(a.signals[n])])) }));
    const model = amountModel(pays, deposits, [...chainAttests, ...own]);
    // The same reader if nobody had recorded any proof on chain (attest): this link and deposits only.
    const linkOnly = amountModel(pays, deposits, own);
    const maxShare = link.proofs.reduce((m, p) => (p.threshold > m ? p.threshold : m), 0n);
    const proofs = link.proofs.map((s) => {
      const inRange = leaves.filter((l) => l.index >= Number(s.fromIndex) && l.index <= Number(s.toIndex));
      const v = inRange.filter((l) => l.kind === "V");
      const n = rootAt.get(s.ledgerRoot) ?? null;
      return {
        threshold: s.threshold, count: s.count, fromIndex: s.fromIndex, toIndex: s.toIndex, asset: s.asset,
        rootIsKnown: n !== null, rootLeafCount: n, builtAfter: n ? iso(leaves[n - 1].time) : null, builtBefore: n && leaves[n] ? iso(leaves[n].time) : null,
        fromTime: inRange[0] ? iso(inRange[0].time) : null, toTime: inRange.at(-1) ? iso(inRange.at(-1).time) : null,
        vouchLeaves: v.map((l) => ({ index: l.index, payerId: l.payerId, payer: registry.get(l.payerId) ?? null, time: iso(l.time), pay: l.pay })),
        sweepLeaves: inRange.filter((l) => l.kind === "S").map((l) => ({ index: l.index, time: iso(l.time) })),
        onlyHoldersInRange: v.length === Number(s.count),
        total: model.total(v.map((l) => l.pay)),
        totalWithoutChainAttests: linkOnly.total(v.map((l) => l.pay)),
        perPayment: v.map((l) => ({ pay: l.pay, ...model.bounds.get(l.pay) })),
        // D13: a share below the bundle's largest share is capped: its proof's sum lies in [share, share + step).
        shareWindow: link.proofs.length > 1 && s.threshold < maxShare ? { lo: s.threshold, hiExclusive: s.threshold + SHARE_STEP } : null,
      };
    });
    // The holder's total: at least the sum of the thresholds, at most what all payments in the ranges can add up to.
    const inRanges = [...new Set(proofs.flatMap((p) => p.vouchLeaves.map((v) => v.pay)))];
    const floor = link.proofs.reduce((t, p) => t + p.threshold, 0n);
    const holderTotal = { lo: floor, hi: model.total(inRanges).hi };
    return {
      name, fromAttest: link.fromAttest ?? null, holderTotal, holderTotalWithoutChainAttests: { lo: floor, hi: linkOnly.total(inRanges).hi }, fragmentChars: link.fragmentChars ?? null,
      readerIdHash: link.readerIdHash, readerNameMatches: nameMatches, contextMatches: ctxOk,
      expiry: link.expiry, expiryIso: link.expiry === null ? null : iso(link.expiry), expiryHint: link.expiry === null ? null : expiryHint(link.expiry),
      salt: link.salt === null ? null : link.version === 2 ? "Poseidon(4, a random 31-byte secret): random to anyone without the secret; hides reader and expiry like a v1 salt" : "random, 31 bytes (the context hides reader and expiry from anyone without the link)",
      version: link.version, readerMode: link.readerMode,
      // D35: whether the chain shows this link revoked, by whom (the tx sender: the relayer, not the holder) and when.
      revocation: rv === null ? null : { tx: rv.hash, block: rv.block, time: iso(rv.time), sender: rv.sender },
      proofs,
    };
  });
}

/** Scores one link's analysis against the truth: total, payers, per-payment amounts, and whether the range is the holder's. */
export function scoreLink(r, truthLink, truth) {
  const T = new Map(truth.pays.map((p) => [p.hash, p]));
  const held = new Set(truthLink.pays);
  const truthTotal = truthLink.pays.reduce((s, h) => s + BigInt(T.get(h).amount), 0n);
  const all = r.proofs.flatMap((p) => p.vouchLeaves);
  const { lo, hi } = r.holderTotal;
  const truePayers = [...new Set(truthLink.pays.map((h) => T.get(h).payer.toLowerCase()))].sort();
  const seenPayers = [...new Set(all.map((v) => v.payer))].sort();
  const per = r.proofs.flatMap((p) => p.perPayment);
  return {
    total: { truth: truthTotal, lo, hi, contains: truthTotal >= lo && (hi === null || truthTotal <= hi), exact: lo === hi && lo === truthTotal },
    rangeIsExactlyTheHoldersPayments: all.length === held.size && all.every((v) => held.has(v.pay)),
    payersRight: JSON.stringify(seenPayers) === JSON.stringify(truePayers),
    paymentsExact: per.filter((b) => b.lo === b.hi && b.lo === BigInt(T.get(b.pay).amount)).length,
    payments: per.length,
    boundsContainTruth: per.every((b) => BigInt(T.get(b.pay).amount) >= b.lo && (b.hi === null || BigInt(T.get(b.pay).amount) <= b.hi)),
  };
}
