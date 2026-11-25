// @shaida/sdk against its own built bundle (dist/), over the fork fixture replayed as JSON-RPC (test/fixture-rpc.ts).
// No live network: the 44005 run is checked by scripts/live-44005.mjs into evidence/sdk/.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CODES, checkOnChain, decodeIncomeLink, definePolicy, RENT_CHECK, ShaidaConfigError, underwrite, verifyIncomeLink, type Verification } from "../dist/index.js";
import { FIXTURE, startFixtureRpc, type FixtureServer } from "./fixture-rpc";

const ada = FIXTURE.links.find((l) => l.name === "ada")!;
const chidi = FIXTURE.links.find((l) => l.name === "chidi")!;
const NOW = 1_795_600_000n; // 2026-11-25, inside both links' validity (expiry 2026-12-25 23:59:59 UTC)
const fragment = (url: string) => url.slice(url.indexOf("#") + 1);
type LinkJson = { v: 1; proofs: { proof: unknown; publicSignals: string[] }[]; readerIdHash: string; expiry: string; salt: string };
const edit = (url: string, f: (j: LinkJson) => void) => {
  const j = JSON.parse(Buffer.from(fragment(url), "base64url").toString()) as LinkJson;
  f(j);
  return `/v#${Buffer.from(JSON.stringify(j)).toString("base64url")}`;
};

let rpc: FixtureServer;
before(async () => { rpc = await startFixtureRpc(); });
after(async () => { await rpc.close(); });
const opts = (extra: Record<string, unknown> = {}) => ({ network: FIXTURE.network, rpcUrl: rpc.url, readerName: "Landlord Bola", now: () => NOW, ...extra });
const codeOf = (v: Verification) => (v.status === "VALID" ? "VALID" : `${v.status} ${v.code}`);

describe("verifyIncomeLink over the fork fixture", () => {
  it("S01 VALID: Ada's two-proof link for Landlord Bola gives the sum, the count and the ledger's own dates", async () => {
    const v = await verifyIncomeLink(`https://shaida.onrender.com${ada.url}`, opts());
    assert.equal(v.status, "VALID");
    if (v.status !== "VALID") return;
    assert.equal(v.threshold, 5_000_000n);
    assert.equal(v.count, 6);
    assert.equal(v.proofs, 2);
    assert.deepEqual(v.leafRange, { from: 0, to: 15 });
    const vouches = FIXTURE.leaves.filter((l) => l.vouch);
    assert.equal(v.from.getTime(), FIXTURE.timeOf(vouches[0]!.block)! * 1000);
    assert.equal(v.to.getTime(), FIXTURE.timeOf(vouches.at(-1)!.block)! * 1000);
    assert.equal(v.expiry.toISOString(), "2026-12-25T23:59:59.000Z");
    assert.equal(v.block, BigInt(FIXTURE.head));
    assert.equal(v.network, FIXTURE.network.name);
  });
  it("S02 decodeIncomeLink reads a full URL, #fragment or bare fragment, and refuses garbage, without the network", () => {
    const calls = rpc.calls.length;
    for (const l of [`https://x.example/v#${fragment(ada.url)}`, `#${fragment(ada.url)}`, fragment(ada.url)]) {
      const d = decodeIncomeLink(l);
      assert.ok(d.ok);
      if (d.ok) assert.deepEqual(d.link.proofs.map((p) => [p.threshold, p.count, p.fromIndex, p.toIndex]), [[3_000_000n, 4, 0, 7], [2_000_000n, 2, 8, 15]]);
    }
    const bad = decodeIncomeLink("/v#bm90LWEtbGluaw");
    assert.equal(bad.ok, false);
    assert.equal(rpc.calls.length, calls);
  });
  const invalid: [string, string, Record<string, unknown>, string][] = [
    ["a malformed link", "/v#bm90LWEtbGluaw", {}, "ProofInvalid"],
    ["another asset", edit(ada.url, (j) => { j.proofs[0]!.publicSignals[1] = "1"; }), {}, "AssetMismatch"],
    ["proofs for two contexts", edit(ada.url, (j) => { j.proofs[1]!.publicSignals[6] = "7"; }), {}, "MixedContexts"],
    ["proofs over two roots", edit(ada.url, (j) => { j.proofs[1]!.publicSignals[0] = "7"; }), {}, "MixedRoots"],
    ["overlapping ranges", edit(ada.url, (j) => { j.proofs[1]!.publicSignals[4] = "7"; }), {}, "RangesOverlap"],
    ["an edited expiry", edit(ada.url, (j) => { j.expiry = String(BigInt(j.expiry) + 86_400n); }), {}, "ContextMismatch"],
    ["another reader", ada.url, { readerName: "Lender Dayo" }, "WrongReader"],
    ["after its expiry", ada.url, { now: () => 1_798_329_600n }, "ProofExpired"],
  ];
  it("S03 INVALID with the named code for each refusal before the chain, reading nothing from the RPC", async () => {
    const calls = rpc.calls.length;
    for (const [what, link, extra, code] of invalid) assert.equal(codeOf(await verifyIncomeLink(link, opts(extra))), `INVALID ${code}`, what);
    assert.equal(rpc.calls.length, calls, "a link refused on its own content reads nothing");
  });
  it("S04 a tampered threshold is INVALID ProofInvalid: the root is known, Groth16 refuses", async () => {
    const v = await verifyIncomeLink(edit(ada.url, (j) => { j.proofs[0]!.publicSignals[2] = "4000000"; }), opts());
    assert.equal(codeOf(v), "INVALID ProofInvalid");
    if (v.status === "INVALID") assert.match(v.message, /Proof 1 of 2 does not verify/);
  });
});

describe("verifyIncomeLink: no answer is never a pass", () => {
  it("S05 INCONCLUSIVE ChainUnreachable when the RPC is down", async () => {
    const v = await verifyIncomeLink(ada.url, opts({ rpcUrl: "http://127.0.0.1:9", timeoutMs: 2_000 }));
    assert.equal(codeOf(v), "INCONCLUSIVE ChainUnreachable");
    if (v.status === "INCONCLUSIVE") assert.match(v.message, /Nothing was verified/);
  });
  it("S06 INCONCLUSIVE UnknownRoot when the RPC's chain does not reach the proof's ledger state", async () => {
    const early = await startFixtureRpc({ head: FIXTURE.leaves[10]!.block });
    try {
      assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ rpcUrl: early.url }))), "INCONCLUSIVE UnknownRoot");
    } finally { await early.close(); }
  });
  it("S07 INCONCLUSIVE NotConfigured for an RPC on another chain, chain 44005 passed as custom, or an unknown network", async () => {
    const other = await startFixtureRpc({ chainId: 1 });
    try {
      assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ rpcUrl: other.url }))), "INCONCLUSIVE NotConfigured");
    } finally { await other.close(); }
    assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ network: { ...FIXTURE.network, chainId: 44005 } }))), "INCONCLUSIVE NotConfigured");
    assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ network: "aevum-mainnet" }))), "INCONCLUSIVE NotConfigured");
    assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ network: { ...FIXTURE.network, extra: 1 } }))), "INCONCLUSIVE NotConfigured");
  });
  it("S08 INCONCLUSIVE InputRejected for an empty or over-long reader name", async () => {
    for (const readerName of ["   ", "x".repeat(97)]) assert.equal(codeOf(await verifyIncomeLink(ada.url, opts({ readerName }))), "INCONCLUSIVE InputRejected");
  });
  it("S09 talks to no host but the RPC it was given", async () => {
    const real = globalThis.fetch;
    const hosts = new Set<string>();
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => { hosts.add(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).host); return real(input, init); }) as typeof fetch;
    try {
      assert.equal((await verifyIncomeLink(chidi.url, opts({ readerName: "Lender Dayo" }))).status, "VALID");
    } finally { globalThis.fetch = real; }
    assert.deepEqual([...hosts], [new URL(rpc.url).host]);
  });
});

describe("underwrite and checkOnChain", () => {
  const policyInput = {
    id: "rent-check-bola", version: 1, title: "Rent check for Landlord Bola (demo)", audience: "landlord" as const, readerName: "Landlord Bola",
    minThreshold: "3000000", minPayments: 2, minPeriodDays: 1, maxPeriodDays: 92, maxProofAgeDays: 30, minDaysLeft: 7,
  };
  const bola = definePolicy(policyInput);
  it("S10 underwrite: a policy for your own reader name decides; the same link and policy give the same decisionId", async () => {
    assert.ok(bola.ok);
    if (!bola.ok) return;
    const a = await underwrite(ada.url, bola.policy, opts());
    const b = await underwrite(ada.url, bola.policy, opts());
    assert.equal(a.decisionId, b.decisionId);
    assert.equal(a.policy.hash, bola.policy.hash);
    assert.equal(a.kind, "APPROVE", JSON.stringify(a));
    if (a.kind === "APPROVE") assert.deepEqual([a.facts.threshold, a.facts.count, a.facts.proofs], ["5000000", "6", 2]);
    const strict = definePolicy({ ...policyInput, id: "strict", minThreshold: "6000000", minPayments: 7 });
    assert.ok(strict.ok);
    const no = strict.ok ? await underwrite(ada.url, strict.policy, opts()) : null;
    assert.deepEqual(no?.kind === "DECLINE" ? no.reasons.map((r) => r.code) : no?.kind, ["BelowMinThreshold", "TooFewPayments"]);
    if (no?.kind === "DECLINE") for (const r of no.reasons) assert.equal(CODES[r.code]?.outcome, "DECLINE", r.code);
    const wrong = await underwrite(ada.url, RENT_CHECK, opts());
    assert.equal(wrong.kind, "DECLINE");
    if (wrong.kind === "DECLINE") assert.deepEqual(wrong.reasons.map((r) => r.code), ["WrongReader"]);
    const down = await underwrite(ada.url, bola.policy, opts({ rpcUrl: "http://127.0.0.1:9", timeoutMs: 2_000 }));
    assert.equal(down.kind === "INCONCLUSIVE" ? down.error.code : down.kind, "ChainUnreachable");
    await assert.rejects(underwrite(ada.url, bola.policy, opts({ network: "nope" })), ShaidaConfigError);
    const bad = definePolicy({ ...policyInput, minThreshold: "01" });
    assert.equal(bad.ok ? "ok" : bad.code, "InputRejected");
  });
  it("S11 checkOnChain: REJECTED for a malformed link without reading; INCONCLUSIVE, never ACCEPTED, where the contract cannot run", async () => {
    const calls = rpc.calls.length;
    const bad = await checkOnChain("/v#bm90LWEtbGluaw", opts());
    assert.deepEqual([bad.status, bad.status === "REJECTED" ? bad.code : ""], ["REJECTED", "ProofInvalid"]);
    assert.equal(rpc.calls.length, calls);
    const r = await checkOnChain(ada.url, opts());
    assert.equal(r.status === "INCONCLUSIVE" ? r.code : r.status, "ChainUnreachable");
  });
});

describe("examples", () => {
  it("S18 examples/verify-node.mjs prints VALID for Ada's link over the fork fixture and exits 0, and WrongReader with exit 1", async () => {
    const { execFile } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const script = fileURLToPath(new URL("../../../examples/verify-node.mjs", import.meta.url));
    const env = { ...process.env, RPC_URL: rpc.url, SHAIDA_NETWORK: JSON.stringify(FIXTURE.network, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) };
    const run = (reader: string) => new Promise<{ code: number; out: string }>((ok) => {
      execFile(process.execPath, [script, `https://shaida.onrender.com${ada.url}`, reader], { env }, (err, stdout) => ok({ code: err ? Number(err.code) : 0, out: stdout }));
    });
    const valid = await run("Landlord Bola");
    // The example reads the system clock: after the fixture link's expiry the right answer is ProofExpired.
    if (Date.now() > Date.parse("2026-12-25T23:59:59Z")) {
      assert.match(valid.out, /^INVALID ProofExpired/);
    } else {
      assert.equal(valid.code, 0, valid.out);
      assert.match(valid.out, /^VALID: at least 5 tUSD8 from 6 payments, .* expires 2026-12-25T23:59:59\.000Z \(aevum-fork \(fixture replay\), block \d+\)/);
    }
    const wrong = await run("Tenant Chidi");
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /^INVALID WrongReader/);
  });
});
