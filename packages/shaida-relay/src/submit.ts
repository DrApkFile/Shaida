// POST /api/relay/<fn>: rails in order, then simulate, sign, persist, send. Never resends.
import { keccak256, type Hex } from "viem";
import { shaidaError, type ErrorCode } from "@shaida/proofs";
import { isNetwork, type NetworkDeps, type RelayDeps } from "./deps";
import { SPECS, type BodyOf, type FnSpec } from "./functions";
import { gasCommitted, hit, utcDay } from "./limits";
import { pinnedReader } from "./reads";
import { refusalOf } from "./revert-codes";
import { withChainLock } from "./lock";
import { keyIsLive, recordKey, requestHashOf, takenRefusal, withState } from "./records";
import { SendError, type LegacyTx, type Refusal, type RelayFn, type RelayReply, type RequestRecord } from "./types";

const STATUS: Partial<Record<ErrorCode, number>> = { RateLimited: 429, RelayerBudgetExceeded: 503, RelayerUnavailable: 503, NotConfigured: 503, AlreadySpent: 409, AlreadyVouched: 409 };
const refuse = (r: Refusal): RelayReply => ({ ok: false, status: STATUS[r.code] ?? 400, error: shaidaError(r.code, r.message) });

export interface Incoming {
  readonly ip: string;
  /** Parses the body. Called only after the IP rail. */
  readonly readBody: () => Promise<unknown>;
}

export async function submit(fn: RelayFn, req: Incoming, deps: RelayDeps): Promise<RelayReply> {
  const now = deps.nowMs();
  if (await deps.store.update((s) => hit(s, `ip:${req.ip}`, deps.limits.perIpPerMinute, now))) {
    return refuse({ code: "RateLimited", message: "Too many requests from this address. Wait a minute; nothing was sent." });
  }
  let raw: unknown;
  try {
    raw = await req.readBody();
  } catch {
    return refuse({ code: "InputRejected", message: "The request body is not JSON. Nothing was sent." });
  }
  switch (fn) {
    case "deposit": return run(SPECS.deposit, raw, deps);
    case "vouchedPay": return run(SPECS.vouchedPay, raw, deps);
    case "lateVouch": return run(SPECS.lateVouch, raw, deps);
    case "sweep": return run(SPECS.sweep, raw, deps);
    case "memo": return run(SPECS.memo, raw, deps);
    case "unshield": return run(SPECS.unshield, raw, deps);
  }
}

async function run<F extends RelayFn>(spec: FnSpec<BodyOf[F]>, raw: unknown, deps: RelayDeps): Promise<RelayReply> {
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse({ code: "InputRejected", message: `Malformed ${spec.fn} request (${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}). Nothing was sent.` });
  }
  const body = parsed.data as BodyOf[F] & { chainId: number };
  const net = deps.network(body.chainId);
  if (!isNetwork(net)) return refuse({ code: net.code, message: net.message });
  return withChainLock(net.chainId, () => railsAndSend(spec, body, net, deps));
}

async function railsAndSend<B extends { chainId: number }>(spec: FnSpec<B>, body: B, net: NetworkDeps, deps: RelayDeps): Promise<RelayReply> {
  const key = recordKey(net.chainId, spec.key(body));
  const existing = await withState(deps.store, (s) => {
    const id = s.byKey[key];
    return id ? s.records[id] : undefined;
  });
  const requestHash = requestHashOf(spec.fn, body);
  if (existing && keyIsLive(existing)) {
    // The same request again (a retry after a lost reply): its record, never a second send.
    if (existing.requestHash === requestHash) return { ok: true, status: 200, record: existing, repeated: true };
    return refuse(takenRefusal(key, existing));
  }

  const payer = spec.payer(body);
  const nowMs = deps.nowMs();
  if (payer && (await deps.store.update((s) => hit(s, `payer:${net.chainId}:${payer}`, deps.limits.perPayerPerMinute, nowMs)))) {
    return refuse({ code: "RateLimited", message: "Too many relayed calls from this payer. Wait a minute; nothing was sent." });
  }
  const ctx = { chainId: net.chainId, contracts: net.contracts, nowSec: BigInt(Math.floor(nowMs / 1000)) };
  const off = await spec.offchain(body, ctx);
  if (off) return refuse(off);

  let tx: LegacyTx;
  let raw: Hex;
  try {
    const block = await net.chain.blockNumber();
    const on = await spec.onchain(body, pinnedReader(net.chain, block), ctx);
    if (on) return refuse(on);

    const day = utcDay(nowMs);
    const committed = await withState(deps.store, (s) => gasCommitted(s, day));
    if (committed + spec.gasCap > deps.limits.dailyGasBudget) {
      return refuse({ code: "RelayerBudgetExceeded", message: `The relayer's gas budget for today is used up (${committed} of ${deps.limits.dailyGasBudget}). Nothing was sent.` });
    }
    if ((await net.chain.balance(net.signer.address)) < deps.limits.minBalanceWei) {
      deps.log({ event: "relayer-low-balance", relayer: net.signer.address });
      return refuse({ code: "RelayerUnavailable", message: "The relayer is out of gas money. Nothing was sent." });
    }
    const call = spec.call(body, net.contracts);
    const sim = await net.chain.simulate(net.signer.address, call);
    if (!sim.ok) return refuse(refusalOf(sim));
    const estimate = await net.chain.estimateGas(net.signer.address, call);
    if (estimate > spec.gasCap) {
      return refuse({ code: "RelayerBudgetExceeded", message: `This call needs ${estimate} gas; the relayer allows at most ${spec.gasCap} for ${spec.fn}. Nothing was sent.` });
    }
    const withMargin = (estimate * 13n) / 10n;
    tx = { type: "legacy", chainId: net.chainId, nonce: await net.chain.nonce(net.signer.address, "pending"), to: call.to, data: call.data, gas: withMargin < spec.gasCap ? withMargin : spec.gasCap, gasPrice: await net.chain.gasPrice(), value: 0n };
    raw = await net.signer.signTransaction(tx);
  } catch (e) {
    deps.log({ event: "relay-chain-read-failed", fn: spec.fn, error: e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e) });
    return refuse({ code: "RelayerUnavailable", message: "The relayer could not read the chain. Nothing was sent; try again shortly." });
  }

  const at = new Date(deps.nowMs()).toISOString();
  const accepted: RequestRecord = {
    requestId: deps.newId(), chainId: net.chainId, fn: spec.fn, key, requestHash, payer, state: "accepted", nonce: tx.nonce, hash: keccak256(raw),
    gas: tx.gas.toString(), gasPrice: tx.gasPrice.toString(), gasUsed: null, block: null, reverted: null, error: null,
    budgetDay: utcDay(nowMs), history: [{ state: "accepted", at }],
  };
  await deps.store.update((s) => { s.records[accepted.requestId] = accepted; s.byKey[key] = accepted.requestId; });
  deps.log({ event: "relay", id: accepted.requestId, fn: spec.fn, state: "accepted", hash: accepted.hash, nonce: tx.nonce, gas: accepted.gas });

  const sent = await send(net, raw);
  const record = await moveTo(deps, accepted, sent.state, sent.error);
  return { ok: true, status: 202, record, repeated: false };
}

async function send(net: NetworkDeps, raw: Hex): Promise<{ state: "pending" | "dropped" | "unknown"; error: RequestRecord["error"] }> {
  try {
    await net.chain.sendRaw(raw);
    return { state: "pending", error: null };
  } catch (e) {
    if (e instanceof SendError && e.kind === "rejected") {
      if (/already known|known transaction/i.test(e.message)) return { state: "pending", error: null };
      const code: ErrorCode = /insufficient funds/i.test(e.message) ? "RelayerUnavailable" : "TxRejected";
      return { state: "dropped", error: shaidaError(code, `The node refused the transaction (${e.message}). Nothing was sent.`) };
    }
    const why = e instanceof Error ? e.message : String(e);
    return { state: "unknown", error: shaidaError("TxOutcomeUnknown", `The node did not answer (${why}). The transaction may have gone through: it is checked by its hash and never sent again.`) };
  }
}

export async function moveTo(deps: RelayDeps, r: RequestRecord, state: RequestRecord["state"], error: RequestRecord["error"], extra: Partial<Pick<RequestRecord, "gasUsed" | "block" | "reverted">> = {}): Promise<RequestRecord> {
  const next: RequestRecord = { ...r, ...extra, state, error, history: [...r.history, { state, at: new Date(deps.nowMs()).toISOString() }] };
  await deps.store.update((s) => { s.records[r.requestId] = next; });
  deps.log({ event: "relay", id: r.requestId, fn: r.fn, state, hash: r.hash, nonce: r.nonce, gas: r.gas, gasUsed: next.gasUsed, code: error?.code ?? null });
  return next;
}
