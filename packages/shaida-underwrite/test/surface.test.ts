// The bot's surfaces (D30): the policy config, the HTTP handler's rails, the agent card, and root dating.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LedgerTree } from "@shaida/proofs";
import {
  agentCard, DECLINE_CODES, handleUnderwrite, INCONCLUSIVE_CODES, llmsTxt, MAX_BODY_BYTES, parsePolicies, PolicyConfigError,
  prefixRoots, RECORDER_DEFAULTS, rootFormedAt, UNDERWRITE_LIMITS, underwriteBodySchema, type HandleDeps,
} from "../src/index";
import { depsOf, ledgerSpanning, linkOf, NOW, POLICIES, recorderFake, RENT, StandIn, TUSD8 } from "./helpers";

const valid = { schema: "shaida-underwrite-policies/1", policies: [{ id: "x-check", version: 1, title: "X", audience: "landlord", readerName: "Bot", minThreshold: "1", minPayments: 1, minPeriodDays: 1, maxPeriodDays: 2, maxProofAgeDays: 0, minDaysLeft: 0 }] };
const withPolicy = (patch: Record<string, unknown>) => ({ ...valid, policies: [{ ...valid.policies[0], ...patch }] });

describe("policies: strict, versioned, checked at startup (D30)", () => {
  it("U18 the shipped config parses: rent-check and revenue-credit, one reader name, version 1", () => {
    assert.deepEqual(POLICIES.map((p) => `${p.id}@${p.version}`), ["rent-check@1", "revenue-credit@1"]);
    assert.equal(new Set(POLICIES.map((p) => p.readerName)).size, 1);
    assert.match(RENT.hash, /^[0-9a-f]{64}$/);
  });
  it("U18b refuses an unknown field, min > max, a bad reader name, version 0, duplicate ids, a non-canonical amount", () => {
    for (const bad of [
      withPolicy({ maxLoan: 5 }), withPolicy({ minPeriodDays: 3, maxPeriodDays: 2 }), withPolicy({ readerName: "  " }), withPolicy({ version: 0 }),
      { ...valid, policies: [valid.policies[0], valid.policies[0]] }, withPolicy({ minThreshold: "01" }), { ...valid, schema: "v2" },
    ]) assert.throws(() => parsePolicies(bad), PolicyConfigError, JSON.stringify(bad).slice(0, 80));
  });
  it("U18c a changed limit changes the policy hash even at the same version", () => {
    const a = parsePolicies(valid)[0]!;
    const b = parsePolicies(withPolicy({ minPayments: 2 }))[0]!;
    assert.equal(a.version, b.version);
    assert.notEqual(a.hash, b.hash);
  });
});

function handler(o: { limited?: boolean; log?: string[] } = {}): HandleDeps & { reads: () => number } {
  const prover = new StandIn();
  const { ledger } = ledgerSpanning(2, 1);
  let reads = 0;
  const deps: HandleDeps = {
    policies: POLICIES,
    limits: UNDERWRITE_LIMITS,
    hit: async () => o.limited ?? false,
    nowMs: () => Number(NOW) * 1000,
    engine: () => depsOf(prover, ledger),
    recorder: recorderFake().deps,
    log: (line) => o.log?.push(JSON.stringify(line)),
  };
  return { ...deps, reads: () => reads, engine: () => { reads++; return depsOf(prover, ledger); } };
}
const req = (body: unknown, ip = "1.2.3.4") => ({ ip, readText: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

describe("POST /api/underwrite handler (D30)", () => {
  it("U19 rate limit is checked before the body is read (429 RateLimited)", async () => {
    let read = false;
    const r = await handleUnderwrite({ ip: "9.9.9.9", readText: async () => { read = true; return "{}"; } }, handler({ limited: true }));
    assert.equal(r.status, 429);
    assert.equal("error" in r.body ? r.body.error.code : "", "RateLimited");
    assert.equal(read, false);
  });
  it("U19b refuses a body over the cap (413), non-JSON, an unknown field and an unknown preset, deciding nothing", async () => {
    const h = handler();
    const big = await handleUnderwrite(req("x".repeat(MAX_BODY_BYTES + 1)), h);
    assert.equal(big.status, 413);
    for (const body of ["{not json", { link: "abc", preset: "rent-check", extra: 1 }, { link: "abc", preset: "no-such" }, { preset: "rent-check" }]) {
      const r = await handleUnderwrite(req(body), h);
      assert.equal(r.status, 400);
      assert.equal("error" in r.body ? r.body.error.code : "", "InputRejected");
    }
    assert.equal(h.reads(), 0);
  });
  it("U19c decides from a full link URL and never logs the link payload", async () => {
    const log: string[] = [];
    const h = handler({ log });
    const prover = new StandIn();
    const { ledger, toIndex } = ledgerSpanning(2, 1);
    const fragment = linkOf({ proofs: [{ threshold: 3n * TUSD8, count: 3n, fromIndex: 0n, toIndex }] }, prover);
    const r = await handleUnderwrite(req({ link: `https://shaida.onrender.com/v?for=merchant#${fragment}`, preset: "rent-check" }), { ...h, engine: () => depsOf(prover, ledger) });
    assert.equal(r.status, 200);
    assert.equal("decision" in r.body ? r.body.decision.kind : "", "APPROVE");
    assert.ok(log.length > 0);
    for (const line of log) {
      assert.ok(!line.includes(fragment.slice(0, 40)), "a log line holds the link");
      assert.ok(!line.includes(fragment.slice(-40)), "a log line holds the link");
    }
  });
});

describe("agent card and llms.txt (D30)", () => {
  const input = { origin: "https://shaida.onrender.com", chainId: 44005, policies: POLICIES, limits: UNDERWRITE_LIMITS, recorder: RECORDER_DEFAULTS, botAddress: null, repoUrl: "https://github.com/DrApkFile/Shaida" };
  it("U19d the card's request schema, presets, codes and limits are the code's own", () => {
    const card = agentCard(input);
    const post = card.endpoints.find((e) => e.method === "POST")!;
    assert.ok("request" in post);
    if (!("request" in post)) return;
    assert.deepEqual(Object.keys(post.request.properties).sort(), Object.keys(underwriteBodySchema.shape).sort());
    assert.deepEqual(post.request.properties.preset.enum, POLICIES.map((p) => p.id));
    assert.equal(post.maxBodyBytes, MAX_BODY_BYTES);
    assert.equal(post.rateLimit.perIpPerMinute, UNDERWRITE_LIMITS.perIpPerMinute);
    assert.deepEqual([...card.decisionCodes.decline.map((d) => d.code)].sort(), [...DECLINE_CODES].sort());
    assert.deepEqual(card.decisionCodes.inconclusive.map((d) => d.code), [...INCONCLUSIVE_CODES]);
    assert.equal(card.recording.enabled, false);
  });
  it("U19e llms.txt names the endpoint, the card, every rule and the presets", () => {
    const text = llmsTxt(input);
    for (const s of ["/api/underwrite", "/.well-known/agent.json", "rent-check@1", "revenue-credit@1", "BelowMinThreshold", "ExpiresTooSoon", "no LLM"]) assert.ok(text.includes(s), s);
  });
});

describe("root dating for ProofTooOld (D30)", () => {
  it("U23 prefixRoots equals the root of every prefix, and rootFormedAt returns the forming leaf's time", () => {
    const leaves = Array.from({ length: 37 }, (_, i) => BigInt(1000 + i * 7919));
    const roots = prefixRoots(leaves);
    for (const k of [1, 2, 3, 8, 17, 37]) assert.equal(roots[k - 1], new LedgerTree(leaves.slice(0, k)).root, `prefix ${k}`);
    const dated = leaves.map((leaf, i) => ({ leaf, time: 5_000n + BigInt(i) }));
    assert.equal(rootFormedAt(dated, new LedgerTree(leaves.slice(0, 20)).root), 5_019n);
    assert.equal(rootFormedAt(dated, 12345n), null);
  });
});
