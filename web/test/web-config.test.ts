// Audit B2/B3: the network config is checked as a whole, and a wrong value is a named refusal, never a fallback.
// Run with Node's own type stripping: node --test web/test/*.test.ts (pnpm --filter web test).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkWebConfig, parseContracts, parseNetworkKeys } from "../src/lib/web-config.ts";

const contracts = JSON.stringify({
  pool: "0x0d93a398de615c92b04961dd042471fea4b7eac6",
  ledger: "0x677659b068278103f83eff413080cb53be3388ed",
  depositor: "0x6a6045a64ae911744fcd63b3186277f8958db2ec",
  registry: "0xce43b77adc82db336d07f03bd84c3834fd9c5215",
  memo: "0xe2f7c6310e5ccb87fde4ff887b100236960c4e17",
  incomeVerifier: "0xc9844a8f058be2d658c972d1d2276b13f308e1c8",
  startBlock: "3810968",
});

describe("NEXT_PUBLIC_NETWORKS (audit B2)", () => {
  it("W10 accepts known keys in order", () => {
    const r = parseNetworkKeys("aevum");
    assert.deepEqual(r, { ok: true, value: ["aevum"] });
    assert.deepEqual(parseNetworkKeys(" fork , aevum "), { ok: true, value: ["fork", "aevum"] });
  });
  it("W11 refuses a typo instead of falling back to production", () => {
    const r = parseNetworkKeys("aevun");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.problem, /unknown network\(s\) "aevun"/);
    assert.equal(parseNetworkKeys("aevum,forkk").ok, false, "one bad key refuses the whole list");
  });
  it("W12 refuses unset, blank, empty entries and repeats", () => {
    for (const raw of [undefined, "", "  ", "aevum,", ",", "aevum,aevum"]) assert.equal(parseNetworkKeys(raw).ok, false, JSON.stringify(raw));
  });
});

describe("contracts at startup (audit B3)", () => {
  it("W13 a valid config passes with every listed network's contracts", () => {
    const r = checkWebConfig({ NEXT_PUBLIC_NETWORKS: "aevum", NEXT_PUBLIC_SHAIDA_AEVUM: contracts });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.config.contracts.aevum?.startBlock, 3810968n);
  });
  it("W14 a listed network without contracts, with a bad address or an extra field is refused, with every problem", () => {
    const missing = checkWebConfig({ NEXT_PUBLIC_NETWORKS: "aevum,fork", NEXT_PUBLIC_SHAIDA_AEVUM: contracts });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(missing.problems.map((p) => p.split(" ")[0]), ["NEXT_PUBLIC_SHAIDA_FORK"]);
    const bad = JSON.parse(contracts) as Record<string, string>;
    const short = parseContracts("aevum", JSON.stringify({ ...bad, ledger: "0x1234" }));
    assert.equal(short.ok, false);
    if (!short.ok) assert.match(short.problem, /ledger: not a 20-byte hex address/);
    assert.equal(parseContracts("aevum", JSON.stringify({ ...bad, extra: "x" })).ok, false);
    assert.equal(parseContracts("aevum", "{not json").ok, false);
  });
  it("W15 an unlisted network's contracts are not required", () => {
    assert.equal(checkWebConfig({ NEXT_PUBLIC_NETWORKS: "aevum", NEXT_PUBLIC_SHAIDA_AEVUM: contracts, NEXT_PUBLIC_SHAIDA_FORK: "junk" }).ok, true);
  });
});
