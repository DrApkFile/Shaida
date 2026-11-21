// Seeded ledger scenarios: the leaves ShaidaLedger would hold after a mix of our recipient's payments, their
// sweeps and other people's leaves, plus the recipient's own records. Same seed, same scenario.
import {
  buildIncomeBundle,
  FIELD_ORDER,
  type IncomeBundleWitness,
  type IncomeProofWitness,
  LedgerTree,
  noteCommitment,
  nullifierOf,
  type PaymentRecord,
  type Result,
  SHARE_STEP,
  showableTotal,
  sweepLeaf,
  TUSD8_FIELD,
  vouchLeaf,
} from "../../src/index";

/** splitmix64: small, seedable, good enough to pick test cases (not for secrets). */
export class Rng {
  private state: bigint;
  constructor(readonly seed: number) {
    this.state = BigInt(seed) & 0xffffffffffffffffn;
  }
  next64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  }
  int(maxExclusive: number): number {
    return Number(this.next64() % BigInt(maxExclusive));
  }
  field(): bigint {
    const wide = (this.next64() << 192n) | (this.next64() << 128n) | (this.next64() << 64n) | this.next64();
    return (wide % (FIELD_ORDER - 1n)) + 1n; // non-zero
  }
  /** Mostly realistic tUSD8 amounts, sometimes the range edges (EVAL C2). */
  amount(): bigint {
    const edges = [0n, 1n, (1n << 64n) - 1n];
    return this.int(6) === 0 ? edges[this.int(edges.length)]! : BigInt(1 + this.int(50_000_000));
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}

export interface Scenario {
  readonly leaves: bigint[];
  readonly tree: LedgerTree;
  readonly payments: PaymentRecord[];
  /** Ledger index of each payment's V leaf (-1 if not vouched) and S leaf (-1 if not swept). */
  readonly vouchIndex: number[];
  readonly sweepIndex: number[];
  readonly asset: bigint;
}

export interface ScenarioOptions {
  readonly payments: number;
  /** Payments that are vouched but never swept (X08). */
  readonly unswept?: readonly number[];
  /** Payments whose note reached the pool without a V leaf (not vouched). */
  readonly unvouched?: readonly number[];
  /** Up to this many leaves of other people between our events. */
  readonly noise?: number;
  /** Fixed amounts (one per payment) instead of random ones. */
  readonly amounts?: readonly bigint[];
}

export function makeScenario(rng: Rng, opts: ScenarioOptions): Scenario {
  const asset = TUSD8_FIELD;
  const payments: PaymentRecord[] = Array.from({ length: opts.payments }, (_, i) => {
    const amount = opts.amounts?.[i] ?? rng.amount();
    return { secretP: rng.field(), amount, payerId: BigInt(1 + rng.int(5)), secretS: rng.field(), amountS: amount };
  });
  const leaves: bigint[] = [];
  const vouchIndex = payments.map(() => -1);
  const sweepIndex = payments.map(() => -1);
  const noise = () => {
    for (let k = rng.int((opts.noise ?? 3) + 1); k > 0; k--) leaves.push(rng.field());
  };
  const vLeaf = (p: PaymentRecord) => vouchLeaf(p.payerId, noteCommitment(p.secretP, p.amount, asset));
  const sLeaf = (p: PaymentRecord) =>
    sweepLeaf(nullifierOf(p.secretP, noteCommitment(p.secretP, p.amount, asset)), noteCommitment(p.secretS, p.amountS, asset));

  // Events in a random but causal order: a payment is swept only after it was paid.
  const toPay = payments.map((_, i) => i);
  const toSweep: number[] = [];
  while (toPay.length > 0 || toSweep.length > 0) {
    noise();
    const pay = toPay.length > 0 && (toSweep.length === 0 || rng.int(2) === 0);
    if (pay) {
      const i = toPay.shift()!;
      if (!opts.unvouched?.includes(i)) {
        vouchIndex[i] = leaves.length;
        leaves.push(vLeaf(payments[i]!));
      }
      toSweep.push(i);
    } else {
      const i = toSweep.splice(rng.int(toSweep.length), 1)[0]!;
      if (!opts.unswept?.includes(i)) {
        sweepIndex[i] = leaves.length;
        leaves.push(sLeaf(payments[i]!));
      }
    }
  }
  noise();
  return { leaves, tree: new LedgerTree(leaves), payments, vouchIndex, sweepIndex, asset };
}

/** An honest request over a scenario: the period covers every vouched payment, the threshold is met. */
export function honestRequest(s: Scenario, rng: Rng, overrides: Record<string, unknown> = {}) {
  const vouched = s.vouchIndex.filter((v) => v >= 0);
  const lo = Math.min(...vouched);
  const hi = Math.max(...vouched);
  return {
    ledgerLeaves: s.leaves,
    ledgerRoot: s.tree.root,
    asset: s.asset,
    threshold: 0n,
    fromIndex: BigInt(Math.max(0, lo - rng.int(3))),
    toIndex: BigInt(hi + rng.int(3)),
    context: rng.field(),
    payments: s.payments,
    ...overrides,
  };
}

/** A bundle of exactly one proof (≤ INCOME_SLOTS payments), flattened for tests that work on one circuit input. */
export type SingleProof = IncomeProofWitness & { readonly skipped: IncomeBundleWitness["skipped"] };

export function buildSingleProof(raw: unknown): Result<SingleProof> {
  const r = buildIncomeBundle(raw);
  if (!r.ok) return r;
  if (r.value.proofs.length !== 1) throw new Error(`expected one proof, the builder made ${r.value.proofs.length}`);
  return { ok: true, value: { ...r.value.proofs[0]!, skipped: r.value.skipped } };
}

/** x rounded down to a multiple of `step` (D13). */
export const roundDown = (x: bigint, step: bigint = SHARE_STEP): bigint => x - (x % step);

/**
 * The largest threshold this request can ask for: the builder's own chunking (built once at threshold 0), each
 * chunk's sum rounded down to the share step (D13).
 */
export function showableThreshold(request: Record<string, unknown>, step: bigint = SHARE_STEP): bigint {
  const r = buildIncomeBundle({ ...request, threshold: 0n });
  if (!r.ok) throw new Error(`builder refused at threshold 0: ${r.error.code}: ${r.error.message}`);
  return showableTotal(r.value.proofs.map((p) => p.counted.reduce((a, c) => a + c.amount, 0n)), step);
}
