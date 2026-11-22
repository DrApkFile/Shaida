// Acts 4–6 setup on make fork: Acme Studio (demo, registered) pays Ada (demo) 3, 4 and 2 tUSD8 and Ada sweeps them
// (as in acts 2–3); Mallory (demo, NOT registered) is refused by the relayer, then pays Ada 5 tUSD8 straight through
// Gloam's open pool with her own gas, and Ada sweeps that too. Returns Ada's inbox as her vault would hold it.
import { generateReceiveKey, type ReceiveKey } from "@gloamtrade/sdk";
import { createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CheckedTrees } from "@shaida/index";
import { openInbox, prepareDeposit, preparePay, prepareSweep, seen, startSweep, type FlowContext, type InboxEntry, type IncomingPayment, type Note, type RelayRecord, type relayClient } from "../src/index";
import type { ActRow, Deployment } from "./evidence";
import { mintTusd8, registerPayer } from "./fork-setup";

const TUSD = 1_000_000n;
export const ACME_PAYMENTS = [3n * TUSD, 4n * TUSD, 2n * TUSD];
export const MALLORY_PAYMENT = 5n * TUSD;
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483" as const;
const directAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(uint256 amount, bytes32 commitment, bytes shieldProof)",
  "function transfer(bytes proof, bytes32 root, bytes32 nullifier, bytes32[2] newCommitments)",
  "function postMemo(bytes32 paymentCommitment, bytes memo)",
]);

export interface Env {
  readonly client: PublicClient; readonly rpc: string; readonly dep: Deployment; readonly ctx: FlowContext;
  readonly relay: ReturnType<typeof relayClient>; readonly rows: ActRow[];
  trees(): Promise<CheckedTrees>;
  settle(r: RelayRecord, act: string, what: string): Promise<RelayRecord>;
  must<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }, what: string): T;
}

export interface Setup { readonly ada: ReceiveKey; readonly payments: IncomingPayment[]; readonly inbox: InboxEntry[]; readonly refusals: { readonly deposit: string; readonly pay: string } }

export async function setUp(e: Env): Promise<Setup> {
  const ada = await generateReceiveKey();
  const refusals = await payTo(e, ada.tag);
  return { ada, ...(await sweepAll(e, ada)), refusals };
}

/** Acme's three vouched pays and Mallory's unvouched one, all to `tag`. Returns the relayer's refusals of Mallory. */
export async function payTo(e: Env, tag: string): Promise<Setup["refusals"]> {
  const acme = privateKeyToAccount(generatePrivateKey());
  const reg = await registerPayer(e.client, e.rpc, e.dep.registry, acme.address, "Acme Studio (demo)");
  e.rows.push({ act: "setup", what: `attestor registers Acme Studio (demo) as payer #${reg.payerId}`, fn: "register", hash: reg.hash, block: "—", gasUsed: "—" });
  await mintTusd8(e.client, e.rpc, acme.address, 20n * TUSD);

  const deposit = await prepareDeposit(e.ctx, acme.address, 10n * TUSD);
  let funds: Note = deposit.note;
  await e.settle(e.must(await e.relay.post("deposit", deposit.body(await acme.signTypedData(deposit.typedData))), "deposit"), "setup", "Acme: gasless deposit 10 tUSD8");
  for (const [i, amount] of ACME_PAYMENTS.entries()) {
    const pay = e.must(await preparePay(e.ctx, await e.trees(), { payer: acme.address, source: funds, amount, recipientTag: tag, privateNote: `Invoice ${i + 1} (demo)` }), "preparePay");
    await e.settle(e.must(await e.relay.post("vouchedPay", pay.body(await acme.signTypedData(pay.typedData))), `pay ${i + 1}`), "setup", `Acme: vouched pay ${i + 1} to Ada`);
    await e.settle(e.must(await e.relay.post("memo", pay.memoBody()), `memo ${i + 1}`), "setup", `sealed memo ${i + 1}`);
    funds = pay.change;
  }

  // Mallory: not registered. The relayer refuses both her deposit and her vouched pay (nothing sent) ...
  const mallory = privateKeyToAccount(generatePrivateKey());
  await e.client.request({ method: "anvil_setBalance" as never, params: [mallory.address, "0x56BC75E2D63100000"] as never });
  await mintTusd8(e.client, e.rpc, mallory.address, 10n * TUSD);
  const mDeposit = await prepareDeposit(e.ctx, mallory.address, MALLORY_PAYMENT);
  const viaRelay = await e.relay.post("deposit", mDeposit.body(await mallory.signTypedData(mDeposit.typedData)));
  const depositRefusal = viaRelay.ok ? `sent (${viaRelay.value.state})` : viaRelay.error.code;
  // ... so she pays her own gas: approve + ShaidaDepositor.deposit, then a plain pool transfer and a memo.
  const wallet = createWalletClient({ account: mallory, transport: http(e.rpc) });
  const send = async (to: Address, data: Hex, what: string) => {
    const hash = await wallet.sendTransaction({ chain: null, to, data, type: "legacy" });
    const r = await e.client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
    e.rows.push({ act: "setup", what, fn: "direct (own gas)", hash, block: r.blockNumber.toString(), gasUsed: r.gasUsed.toString() });
  };
  const body = mDeposit.body("0x") as { commitment: Hex; shieldProof: Hex };
  await send(TUSD8, encodeFunctionData({ abi: directAbi, functionName: "approve", args: [e.dep.depositor, MALLORY_PAYMENT] }), "Mallory (unregistered): approve tUSD8");
  await send(e.dep.depositor, encodeFunctionData({ abi: directAbi, functionName: "deposit", args: [MALLORY_PAYMENT, body.commitment, body.shieldProof] }), "Mallory (unregistered): deposit 5 tUSD8, own gas");
  const mPay = e.must(await preparePay(e.ctx, await e.trees(), { payer: mallory.address, source: mDeposit.note, amount: MALLORY_PAYMENT, recipientTag: tag, privateNote: "Mallory (demo)" }), "preparePay (Mallory)");
  const mPayRelay = await e.relay.post("vouchedPay", mPay.body(await mallory.signTypedData(mPay.typedData)));
  const payRefusal = mPayRelay.ok ? `sent (${mPayRelay.value.state})` : mPayRelay.error.code;
  const t = mPay.transfer;
  await send(e.dep.pool, encodeFunctionData({ abi: directAbi, functionName: "transfer", args: [t.proof, t.root, t.nullifier, [t.newCommitments[0], t.newCommitments[1]]] }), "Mallory (unregistered): plain pool transfer of 5 tUSD8 to Ada (no vouch)");
  await send(e.dep.memo, encodeFunctionData({ abi: directAbi, functionName: "postMemo", args: [mPay.payment.commitment, mPay.memo] }), "Mallory (unregistered): sealed memo to Ada");
  return { deposit: depositRefusal, pay: payRefusal };
}

async function sweepAll(e: Env, ada: ReceiveKey): Promise<Pick<Setup, "payments" | "inbox">> {
  // Ada opens her board and sweeps all four (sweep needs no vouch: the S leaf is written, the V leaf is missing).
  const payments = await openInbox((await e.trees()).snapshot.memos, ada, e.ctx);
  if (payments.length !== 4) throw new Error(`Ada's inbox has ${payments.length} payments, expected 4`);
  const inbox: InboxEntry[] = [];
  for (const [i, p] of payments.entries()) {
    const sweep = e.must(await prepareSweep(e.ctx, await e.trees(), p), "prepareSweep");
    await e.settle(e.must(await e.relay.post("sweep", sweep.body()), `sweep ${i + 1}`), "setup", `Ada sweeps ${BigInt(p.note.amountWei) / TUSD} tUSD8 (${p.privateNote ?? "no note"})`);
    inbox.push({ ...startSweep(seen(p.note.commitment), sweep.fresh), state: "swept" });
  }
  return { payments, inbox };
}
