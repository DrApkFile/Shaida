// Turns a dump's transactions into actions (deposit, vouchedPay, memo, sweep, unshield, register, attest, …) and
// lists every public field of each with its class:
//   plain     a value anyone reads as is (an amount, an address, a payer id, a count)
//   opaque    a hash, commitment, nullifier, proof or ciphertext: meaningless without a secret
//   metadata  what the transaction itself shows: sender, block and time, order, nonce, gas, calldata size
import { decodeFunctionData, recoverTypedDataAddress } from "viem";
import { FUNCTION_TABLE, SIGNALS } from "./abi.mjs";
import { decodeKnown } from "./collect.mjs";

const lower = (a) => a.toLowerCase();

/** Field classes per action kind: [field, class, why]. Every decoded field must be listed here (unlisted → error). */
export const FIELD_CLASSES = {
  deposit: [["payer", "plain", "the payer's address (calldata and Deposited)"], ["amount", "plain", "the deposit amount"], ["gasless", "plain", "which deposit path"], ["commitment", "opaque", "the new note"], ["shieldProof", "opaque", "Groth16 proof"], ["auth", "plain", "EIP-3009 window and signature: recovers to the payer"], ["leafIndex", "plain", "pool tree position"], ["tokenFlow", "plain", "tUSD8 Transfer payer → depositor → pool"]],
  vouchedPay: [["payer", "plain", "the payer's address (calldata)"], ["payerId", "plain", "Vouched.payerId (indexed)"], ["signature", "plain", "EIP-712 Vouch signature: recovers to the payer's address"], ["deadline", "plain", "signature deadline: about when the payer signed"], ["proof", "opaque", "Gloam transfer proof"], ["root", "opaque", "a past pool root"], ["nullifier", "opaque", "spends the payer's note"], ["paymentCommitment", "opaque", "the payment note (newCommitments[0])"], ["changeCommitment", "opaque", "the payer's change note (newCommitments[1])"], ["leafIndex", "plain", "ledger tree position of V"], ["leaf", "opaque", "V = Poseidon(1, payerId, Cp)"]],
  lateVouch: [["payer", "plain", "the payer's address"], ["payerId", "plain", "Vouched.payerId"], ["signature", "plain", "recovers to the payer"], ["deadline", "plain", "signature deadline"], ["paymentCommitment", "opaque", "the payment note"], ["leafIndex", "plain", "ledger tree position"], ["leaf", "opaque", "V leaf"]],
  sweep: [["proof", "opaque", "Gloam transfer proof"], ["root", "opaque", "a past pool root"], ["nullifier", "opaque", "spends the payment note; unlinkable to it without the note's secret"], ["sweepCommitment", "opaque", "the recipient's new note"], ["changeCommitment", "opaque", "second output note"], ["leafIndex", "plain", "ledger tree position of S"], ["leaf", "opaque", "S = Poseidon(2, N, Cs)"]],
  memo: [["paymentCommitment", "opaque", "equals the pay's newCommitments[0]: names which payment the memo belongs to"], ["memo", "opaque", "sealed ticket (ECDH P-256 + AES-GCM), padded to 512-byte steps"], ["memoLength", "plain", "the padded length"]],
  unshield: [["to", "plain", "the withdrawal recipient"], ["amount", "plain", "the withdrawn amount (a whole note)"], ["asset", "plain", "tUSD8"], ["nullifier", "opaque", "spends a swept note"], ["root", "opaque", "a past pool root"], ["proof", "opaque", "Gloam unshield proof"], ["tokenFlow", "plain", "tUSD8 Transfer pool → to"]],
  register: [["account", "plain", "the payer's address"], ["payerId", "plain", "the payer's id"], ["nameHash", "opaque", "keccak256 of the display name: confirmable by guessing the name"]],
  revoke: [["payerId", "plain", "the payer id that stops being active"]],
  attest: [["threshold", "plain", "at least this much"], ["count", "plain", "this many payments"], ["fromIndex", "plain", "first ledger leaf of the range"], ["toIndex", "plain", "last ledger leaf of the range"], ["asset", "plain", "tUSD8"], ["ledgerRoot", "opaque", "a past ledger root (names the ledger state the proof used)"], ["context", "opaque", "Poseidon(readerIdHash, expiry, salt)"], ["proof", "opaque", "Groth16 proof"]],
};
export const META_FIELDS = [["sender", "metadata", "tx.from"], ["block/time", "metadata", "when"], ["order", "metadata", "tx index and the sender's nonce"], ["gasUsed", "metadata", "receipt"], ["gasLimit", "metadata", "tx"], ["calldataBytes", "metadata", "size of the input"]];

/** Decoded actions of a dump, in chain order. Deploys and owner setup are `setup`. */
export async function actionsOf(dump) {
  const byAddr = Object.fromEntries(Object.entries(dump.contracts).map(([k, v]) => [v, k]));
  const out = [];
  for (const tx of dump.txs) {
    const events = tx.logs.map((l) => ({ address: l.address, ev: decodeKnown(l) })).filter((x) => x.ev);
    const base = { hash: tx.hash, block: tx.block, time: tx.time, index: tx.index, sender: tx.from, nonce: tx.nonce, gasUsed: tx.gasUsed, gasLimit: tx.gasLimit, status: tx.status, calldataBytes: (tx.input.length - 2) / 2, txType: tx.type };
    const entry = tx.to && FUNCTION_TABLE.find((f) => f.contract === byAddr[tx.to] && tx.input.startsWith(f.selector));
    if (!entry) { out.push({ ...base, kind: "setup", contract: byAddr[tx.to] ?? (tx.contractAddress ? `create ${byAddr[tx.contractAddress] ?? tx.contractAddress}` : tx.to) }); continue; }
    const { args, functionName } = decodeFunctionData({ abi: entry.abi, data: tx.input });
    const ev = (name) => events.find((e) => e.ev.eventName === name)?.ev.args;
    const fields = await fieldsOf(entry.kind, functionName, args, ev, dump, tx, events);
    out.push({ ...base, kind: entry.kind, fn: functionName, ...fields });
  }
  return out;
}

async function fieldsOf(kind, fn, a, ev, dump, tx, events) {
  const flows = events.filter((e) => e.ev.eventName === "Transfer" && e.address === dump.token).map((e) => ({ from: lower(e.ev.args.from), to: lower(e.ev.args.to), value: e.ev.args.value }));
  switch (kind) {
    case "deposit": {
      const d = ev("Deposited");
      return { payer: lower(d.payer), amount: d.amount, gasless: d.gasless, commitment: d.commitment, leafIndex: ev("Shielded")?.leafIndex, tokenFlow: flows };
    }
    case "vouchedPay": {
      const t = a[0], v = ev("Vouched");
      const relayed = fn === "vouchedPayFor";
      const recovered = relayed ? await recoverVouchSigner(dump, t, a[2], a[3]) : null;
      return {
        payer: relayed ? lower(a[1]) : tx.from, payerId: v.payerId, deadline: relayed ? a[2] : null, signer: recovered,
        root: t.root, nullifier: t.nullifier, paymentCommitment: t.newCommitments[0], changeCommitment: t.newCommitments[1], leafIndex: v.leafIndex, leaf: v.leaf,
      };
    }
    case "lateVouch": {
      const v = ev("Vouched");
      return { payer: fn === "lateVouchFor" ? lower(a[1]) : tx.from, payerId: v.payerId, paymentCommitment: a[0], leafIndex: v.leafIndex, leaf: v.leaf };
    }
    case "sweep": {
      const t = a[0], s = ev("Swept");
      return { root: t.root, nullifier: t.nullifier, sweepCommitment: t.newCommitments[0], changeCommitment: t.newCommitments[1], leafIndex: s.leafIndex, leaf: s.leaf };
    }
    case "memo": return { paymentCommitment: a[0], memo: a[1], memoLength: (a[1].length - 2) / 2 };
    case "unshield": return { root: a[1], nullifier: a[2], asset: lower(a[3]), to: lower(a[4]), amount: a[5], tokenFlow: flows };
    case "register": { const r = ev("PayerRegistered"); return { account: lower(r.account), payerId: r.payerId, nameHash: r.nameHash }; }
    case "revoke": return { payerId: a[0] };
    case "attest": return { signals: Object.fromEntries(SIGNALS.map((n, i) => [n, a[1][i]])) };
    default: return {};
  }
}

/** The address an EIP-712 Vouch signature recovers to (ShaidaLedger.vouchDigest), computed offline. */
function recoverVouchSigner(dump, t, deadline, signature) {
  return recoverTypedDataAddress({
    domain: { name: "ShaidaLedger", version: "1", chainId: dump.chainId, verifyingContract: dump.contracts.ledger },
    types: { Vouch: [{ name: "root", type: "bytes32" }, { name: "nullifier", type: "bytes32" }, { name: "paymentCommitment", type: "bytes32" }, { name: "changeCommitment", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Vouch",
    message: { root: t.root, nullifier: t.nullifier, paymentCommitment: t.newCommitments[0], changeCommitment: t.newCommitments[1], deadline },
    signature,
  }).then(lower);
}
