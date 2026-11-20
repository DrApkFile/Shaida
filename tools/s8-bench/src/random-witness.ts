// A random, valid income-circuit witness with every slot used, built in the page: random payments, each vouched and
// swept, among random leaves of other people, in a Gloam-format ledger tree. Test values only.
import {
  circuitInput,
  type CircuitInput,
  type CircuitSlot,
  FIELD_ORDER,
  LedgerTree,
  noteCommitment,
  nullifierOf,
  sweepLeaf,
  TUSD8_FIELD,
  vouchLeaf,
} from "@shaida/proofs";

function randomField(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const wide = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  return (wide % (FIELD_ORDER - 1n)) + 1n;
}
const randomInt = (maxExclusive: number) => Number(randomField() % BigInt(maxExclusive));

export function randomFullWitness(slots: number): CircuitInput {
  const asset = TUSD8_FIELD;
  const leaves: bigint[] = [];
  const noise = () => {
    for (let k = randomInt(6); k > 0; k--) leaves.push(randomField());
  };
  const payments = Array.from({ length: slots }, () => {
    const amount = BigInt(1 + randomInt(1_000_000_000));
    const secretP = randomField();
    const secretS = randomField();
    const payerId = BigInt(1 + randomInt(5));
    const cp = noteCommitment(secretP, amount, asset);
    const cs = noteCommitment(secretS, amount, asset);
    return { secretP, amount, payerId, secretS, amountS: amount, cp, cs, v: -1, s: -1 };
  });
  for (const p of payments) {
    noise();
    p.v = leaves.push(vouchLeaf(p.payerId, p.cp)) - 1;
  }
  for (const p of payments) {
    noise();
    p.s = leaves.push(sweepLeaf(nullifierOf(p.secretP, p.cp), p.cs)) - 1;
  }
  noise();
  const tree = new LedgerTree(leaves);
  const used: CircuitSlot[] = payments.map((p) => ({
    used: 1,
    secretP: p.secretP,
    amount: p.amount,
    payerId: p.payerId,
    vPath: tree.path(p.v),
    secretS: p.secretS,
    amountS: p.amountS,
    sPath: tree.path(p.s),
  }));
  const total = payments.reduce((a, p) => a + p.amount, 0n);
  const publicSignals = {
    ledgerRoot: tree.root,
    asset,
    threshold: total,
    count: BigInt(slots),
    fromIndex: BigInt(payments[0]!.v),
    toIndex: BigInt(payments[slots - 1]!.v),
    context: randomField(),
  };
  return circuitInput(publicSignals, used, slots);
}
