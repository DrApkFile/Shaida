// Links and deps for the bot's tests. Groth16 is a stand-in that accepts a proof only for the exact public signals it
// was "made" for (as packages/shaida-proofs/test/helpers/link.ts), so editing any signal is refused like a real
// verifier would; U20 repeats the core cases with a real final-key proof and snarkjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { memoryKv } from "@shaida/kv";
import { contextOf, encodeIncomeLink, PUBLIC_SIGNAL_ORDER, readerIdHashOf, TUSD8_FIELD, type Groth16Proof } from "@shaida/proofs";
import { DAY, kvRecordStore, parsePolicies, SendRefused, type Policy, type RecorderChain, type RecorderDeps, type UnderwriteDeps } from "../src/index";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));
export const POLICIES = parsePolicies(JSON.parse(readFileSync(join(REPO, "config/underwrite-policies.json"), "utf8")));
export const RENT = POLICIES.find((p) => p.id === "rent-check")!;
export const CREDIT = POLICIES.find((p) => p.id === "revenue-credit")!;
export const BOT_READER = RENT.readerIdHash;

/** 2027-01-15T08:00:00Z: the bot's clock in every test. */
export const NOW = 1_800_000_000n;
export const TUSD8 = 1_000_000n;
export const ROOT = 0x1234567n;

export interface ProofSpec {
  readonly threshold: bigint;
  readonly count: bigint;
  readonly fromIndex: bigint;
  readonly toIndex: bigint;
}

export interface LinkSpec {
  readonly reader?: bigint;
  readonly expiry?: bigint;
  readonly salt?: bigint;
  readonly root?: bigint;
  readonly asset?: bigint;
  readonly proofs: readonly ProofSpec[];
}

/** Stand-in prover: the ids of proofs it "made", with the exact signals each was made for. */
export class StandIn {
  private readonly made = new Map<string, string>();
  private next = 1;
  prove(signals: readonly string[]): Groth16Proof {
    const id = String(this.next++);
    this.made.set(id, JSON.stringify(signals));
    return { pi_a: [id, "1", "1"], pi_b: [["1", "0"], ["0", "1"], ["1", "0"]], pi_c: ["1", "2", "1"], protocol: "groth16", curve: "bn128" };
  }
  readonly verify: UnderwriteDeps["verifyGroth16"] = async (signals, proof) => this.made.get(proof.pi_a[0]) === JSON.stringify(signals);
}

export function linkOf(spec: LinkSpec, prover: StandIn): string {
  const reader = spec.reader ?? BOT_READER;
  const expiry = spec.expiry ?? NOW + 30n * DAY;
  const salt = spec.salt ?? 99n;
  const context = contextOf(reader, expiry, salt);
  const proofs = spec.proofs.map((p) => {
    const named: Record<(typeof PUBLIC_SIGNAL_ORDER)[number], bigint> = {
      ledgerRoot: spec.root ?? ROOT, asset: spec.asset ?? TUSD8_FIELD, threshold: p.threshold, count: p.count, fromIndex: p.fromIndex, toIndex: p.toIndex, context,
    };
    const publicSignals = PUBLIC_SIGNAL_ORDER.map((k) => named[k].toString());
    return { proof: prover.prove(publicSignals), publicSignals };
  });
  return encodeIncomeLink({ v: 1, proofs, readerIdHash: reader.toString(), expiry: expiry.toString(), salt: salt.toString() });
}

export interface Ledger {
  /** Unix seconds of leaf 0; leaf i is `start + i·spacing`; even leaves are vouch leaves. */
  readonly start: bigint;
  readonly spacing: bigint;
  /** Block time of the leaf that formed the proof's root. */
  readonly rootTime: bigint;
  readonly knownRoots?: readonly bigint[];
}

export const leafTime = (l: Ledger, i: bigint): bigint => l.start + i * l.spacing;

/** Deps over a stand-in ledger: dates of the first and last even (vouch) leaf in a range; one known root. */
export function depsOf(prover: StandIn, ledger: Ledger, now = NOW): UnderwriteDeps {
  return {
    now: () => now,
    isKnownRoot: async (root) => (ledger.knownRoots ?? [ROOT]).includes(root),
    verifyGroth16: prover.verify,
    resolveRange: async (from, to) => {
      const first = from % 2n === 0n ? from : from + 1n;
      const last = to % 2n === 0n ? to : to - 1n;
      return first > last ? null : { fromDate: leafTime(ledger, first), toDate: leafTime(ledger, last) };
    },
    rootTime: async (root) => ((ledger.knownRoots ?? [ROOT]).includes(root) ? ledger.rootTime : null),
  };
}

/** A ledger whose vouch leaves 0 and `2·(days−1)` are `days` UTC calendar days apart, ending `ageDays` before NOW. */
export function ledgerSpanning(days: number, ageDays: number): { ledger: Ledger; toIndex: bigint } {
  const end = (NOW / DAY - BigInt(ageDays)) * DAY + 3_600n; // 01:00 UTC on the last day
  const toIndex = 2n * BigInt(days - 1);
  const start = end - BigInt(days - 1) * DAY;
  return { ledger: { start, spacing: DAY / 2n, rootTime: end }, toIndex };
}

export const otherReader = (name: string): bigint => {
  const r = readerIdHashOf(name);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** A recording fake: every signed tx and every send, a chain that mines on the next receipt read. */
export function recorderFake(o: { enabled?: boolean; dailyCount?: number; dailyGas?: bigint; balance?: bigint; send?: "ok" | "refused" | "no-answer"; check?: RecorderChain["check"] } = {}) {
  const kv = memoryKv();
  const store = kvRecordStore(kv);
  const signed: { to: string; data: string; gas: bigint; nonce: number }[] = [];
  const sent: string[] = [];
  /** For each send: was a record holding this tx's hash already in the store? */
  const storedBeforeSend: boolean[] = [];
  let nonce = 0;
  let now = Number(NOW) * 1000;
  const chain: RecorderChain = {
    chainId: 44005,
    incomeVerifier: "0xc9844a8f058be2d658c972d1d2276b13f308e1c8",
    check: o.check ?? (async () => null),
    balance: async () => o.balance ?? 10n ** 18n,
    gasPrice: async () => 1_000_000_000n,
    pendingNonce: async () => nonce,
    sendRaw: async (raw) => {
      storedBeforeSend.push([...kv.tables.strings.values()].some((v) => v.includes(keccak256(raw))));
      if (o.send === "refused") throw new SendRefused("nonce too low");
      if (o.send === "no-answer") throw new Error("socket hang up");
      sent.push(keccak256(raw));
      nonce++;
    },
    receipt: async (hash) => (sent.includes(hash) ? { status: "success", gasUsed: 267_065n, blockNumber: 3_950_000n + BigInt(sent.indexOf(hash)) } : null),
  };
  let ids = 0;
  const deps: RecorderDeps = {
    config: { enabled: o.enabled ?? true, dailyCount: o.dailyCount ?? 3, dailyGas: o.dailyGas ?? 1_260_000n },
    chain,
    signer: {
      address: "0x000000000000000000000000000000000000b075",
      signTransaction: async (tx) => {
        signed.push({ to: tx.to, data: tx.data, gas: tx.gas, nonce: tx.nonce });
        return `0x${(signed.length).toString(16).padStart(8, "0")}${tx.data.slice(2, 10)}` as `0x${string}`;
      },
    },
    store,
    withLock: (task) => task(),
    nowMs: () => now,
    newId: () => `claim-${++ids}-xxxxxxxx`,
    sleep: async () => undefined,
    receiptWaitMs: 0,
    log: () => undefined,
  };
  return { deps, store, kv, signed, sent, storedBeforeSend, advanceDays: (d: number) => { now += d * 86_400_000; } };
}

export const policyWith = (base: Policy, patch: Partial<Policy>): Policy => ({ ...base, ...patch });
