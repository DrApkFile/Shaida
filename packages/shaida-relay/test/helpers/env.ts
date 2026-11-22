// A relayer wired to a fake chain that records every call. Real keys sign the typed data and the transactions.
import { keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { shaidaError } from "@shaida/proofs";
import {
  DEFAULT_LIMITS, ReadReverted, SendError, depositTypedData, memoryStore, vouchTypedData,
  type Call, type RelayChain, type RelayContracts, type RelayDeps, type RelayLimits, type Simulation,
} from "../../src/index";

export const CHAIN_ID = 440050;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
export const CONTRACTS: RelayContracts = { token: addr(0x7a), pool: addr(0xa1), ledger: addr(0xb2), depositor: addr(0xd4), registry: addr(0xe5), memo: addr(0xc3) };
const rand = (bytes: number): Hex => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

export class FakeChain implements RelayChain {
  readonly log: string[] = [];
  paused = false;
  readonly blacklisted = new Set<string>();
  readonly payers = new Map<string, "active" | "revoked">();
  readonly spent = new Set<string>();
  readonly knownRoots = new Set<string>();
  readonly seen = new Set<string>();
  readonly vouched = new Set<string>();
  simulation: Simulation = { ok: true };
  estimate = 1_000_000n;
  balanceWei = 10n ** 18n;
  sendMode: "ok" | "transport" | { reject: string } = "ok";
  automine = false;
  pending = 0;
  latest = 0;
  readonly sent: Hex[] = [];
  readonly receipts = new Map<string, { status: "success" | "reverted"; gasUsed: bigint; blockNumber: bigint }>();

  async chainId() { return CHAIN_ID; }
  async blockNumber() { this.log.push("blockNumber"); return 100n; }
  async read(to: Address, fn: string, args: readonly unknown[], block: bigint): Promise<unknown> {
    this.log.push(`read:${fn}@${block}`);
    const a = String(args[0] ?? "").toLowerCase();
    switch (fn) {
      case "paused": return this.paused;
      case "isBlacklisted": return this.blacklisted.has(a);
      case "isSpent": return this.spent.has(a);
      case "isKnownRoot": return this.knownRoots.has(a);
      case "commitmentSeen": return this.seen.has(a);
      case "vouched": return this.vouched.has(a);
      case "activeIdOf": {
        const s = this.payers.get(a);
        if (s === "active") return 1;
        throw new ReadReverted(s === "revoked" ? "PayerRevoked" : "PayerNotRegistered", "reverted");
      }
    }
    throw new Error(`unexpected read ${fn} on ${to}`);
  }
  async simulate(_from: Address, call: Call) { this.log.push(`simulate:${call.to}`); return this.simulation; }
  async estimateGas() { this.log.push("estimateGas"); return this.estimate; }
  async gasPrice() { return 1_000_000_000n; }
  async balance() { return this.balanceWei; }
  async nonce(_a: Address, tag: "pending" | "latest") { return tag === "pending" ? this.pending : this.latest; }
  async sendRaw(raw: Hex): Promise<Hex> {
    this.log.push("sendRaw");
    this.sent.push(raw);
    if (this.sendMode === "transport") throw new Error("fetch failed: socket hang up");
    if (typeof this.sendMode === "object") throw new SendError("rejected", this.sendMode.reject);
    this.pending++;
    if (this.automine) this.mine(keccak256(raw), "success", 900_000n);
    return keccak256(raw);
  }
  async receipt(hash: Hex) { return this.receipts.get(hash) ?? null; }
  mine(hash: Hex, status: "success" | "reverted", gasUsed: bigint) {
    this.latest++;
    this.receipts.set(hash, { status, gasUsed, blockNumber: 101n });
  }
  didSimulate() { return this.log.some((l) => l.startsWith("simulate")); }
}

export function makeEnv(opts: { limits?: Partial<RelayLimits>; signerKey?: Hex; chainId?: number } = {}) {
  const chain = new FakeChain();
  const relayer = privateKeyToAccount(opts.signerKey ?? generatePrivateKey());
  const payer = privateKeyToAccount(generatePrivateKey());
  chain.payers.set(payer.address.toLowerCase(), "active");
  let clock = 1_800_000_000_000;
  let ids = 0;
  const lines: Record<string, unknown>[] = [];
  const store = memoryStore();
  const deps: RelayDeps = {
    store,
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    nowMs: () => clock,
    newId: () => `00000000-0000-4000-8000-${(++ids).toString().padStart(12, "0")}`,
    log: (l) => void lines.push(l),
    network: (id) =>
      id === (opts.chainId ?? CHAIN_ID)
        ? { chainId: id, chain, contracts: CONTRACTS, signer: { address: relayer.address, signTransaction: (tx) => relayer.signTransaction(tx) } }
        : shaidaError("NotConfigured", "not this chain"),
  };
  const nowSec = () => BigInt(Math.floor(clock / 1000));

  async function depositBody(over: { validBefore?: bigint; signer?: typeof payer } = {}) {
    const commitment = rand(32);
    const validBefore = over.validBefore ?? nowSec() + 600n;
    const amount = 5_000_000n;
    const typed = depositTypedData(CHAIN_ID, CONTRACTS.token, { payer: payer.address, depositor: CONTRACTS.depositor, amount, validAfter: 0n, validBefore, commitment });
    const signature = await (over.signer ?? payer).signTypedData(typed);
    return { chainId: CHAIN_ID, payer: payer.address, amount: amount.toString(), commitment, shieldProof: rand(256), validAfter: "0", validBefore: validBefore.toString(), signature };
  }

  async function vouchedPayBody(over: { deadline?: bigint; nullifier?: Hex } = {}) {
    const transfer = { proof: rand(256), root: rand(32), nullifier: over.nullifier ?? rand(32), newCommitments: [rand(32), rand(32)] as [Hex, Hex] };
    chain.knownRoots.add(transfer.root);
    const deadline = over.deadline ?? nowSec() + 600n;
    const signature = await payer.signTypedData(vouchTypedData(CHAIN_ID, CONTRACTS.ledger, transfer, deadline));
    return { chainId: CHAIN_ID, payer: payer.address, transfer, deadline: deadline.toString(), signature };
  }

  function sweepBody() {
    const transfer = { proof: rand(256), root: rand(32), nullifier: rand(32), newCommitments: [rand(32), rand(32)] as [Hex, Hex] };
    chain.knownRoots.add(transfer.root);
    return { chainId: CHAIN_ID, transfer };
  }

  function unshieldBody(over: { to?: Hex; asset?: Hex; amount?: bigint } = {}) {
    const root = rand(32);
    chain.knownRoots.add(root);
    return { chainId: CHAIN_ID, proof: rand(256), root, nullifier: rand(32), asset: over.asset ?? CONTRACTS.token, to: over.to ?? rand(20), amount: (over.amount ?? 1_500_000n).toString() };
  }

  return { chain, deps, store, payer, relayer, lines, depositBody, vouchedPayBody, sweepBody, unshieldBody, tick: (ms: number) => void (clock += ms) };
}

export const req = (body: unknown, ip = "203.0.113.7") => ({ ip, readBody: async () => JSON.parse(JSON.stringify(body)) as unknown });
