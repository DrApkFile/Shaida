// shaida-sdk 0.2.0 (D35, D36) against its built bundle over the fork fixture: REVOKED with the revocation's block and
// time, an unreadable or missing registry never VALID, 0.1.0 calls and old links unchanged, reader codes refused by
// name. The fixture's links are v1 (made before revocation); the replayed registry marks Ada's salt revoked to drive
// the SDK's read and mapping end to end (on chain only Poseidon(4, secret) salts can be marked: contracts RV01–RV07).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CODES, decodeIncomeLink, definePolicy, ShaidaConfigError, underwrite, verifyIncomeLink, type Verification } from "../dist/index.js";
import { FIXTURE, startFixtureRpc, type FixtureServer } from "./fixture-rpc";

const ada = FIXTURE.links.find((l) => l.name === "ada")!;
const NOW = 1_795_600_000n;
const fragment = (url: string) => url.slice(url.indexOf("#") + 1);
type LinkJson = Record<string, unknown> & { salt: string };
const json = (url: string) => JSON.parse(Buffer.from(fragment(url), "base64url").toString()) as LinkJson;
const relink = (j: LinkJson) => `/v#${Buffer.from(JSON.stringify(j)).toString("base64url")}`;
const codeOf = (v: Verification) => (v.status === "VALID" ? "VALID" : `${v.status} ${v.code}`);
const REVOKED_BLOCK = FIXTURE.leaves.at(-1)!.block;

let rpc: FixtureServer;
before(async () => { rpc = await startFixtureRpc(); });
after(async () => { await rpc.close(); });
const opts = (server: FixtureServer, extra: Record<string, unknown> = {}) => ({ network: FIXTURE.network, rpcUrl: server.url, readerName: "Landlord Bola", now: () => NOW, ...extra });
const withRpc = async <T>(o: Parameters<typeof startFixtureRpc>[0], f: (s: FixtureServer) => Promise<T>): Promise<T> => {
  const s = await startFixtureRpc(o);
  try { return await f(s); } finally { await s.close(); }
};

describe("shaida-sdk 0.2.0: revocation (D35)", () => {
  it("S20 a revoked link is INVALID ProofRevoked with the revocation's block and time; underwrite DECLINEs it", async () => {
    const salt = BigInt(json(ada.url).salt);
    await withRpc({ revoked: new Map([[salt, REVOKED_BLOCK]]) }, async (s) => {
      const v = await verifyIncomeLink(ada.url, opts(s));
      assert.equal(codeOf(v), "INVALID ProofRevoked");
      if (v.status !== "INVALID" || v.code !== "ProofRevoked") return;
      assert.equal(v.revokedAt.block, BigInt(REVOKED_BLOCK));
      assert.equal(v.revokedAt.time.getTime(), FIXTURE.timeOf(REVOKED_BLOCK)! * 1000);
      assert.match(v.message, new RegExp(`block ${REVOKED_BLOCK}`));
      const bola = definePolicy({ id: "bola", version: 1, title: "Bola", audience: "landlord", readerName: "Landlord Bola", minThreshold: "1000000", minPayments: 1, minPeriodDays: 1, maxPeriodDays: 92, maxProofAgeDays: 30, minDaysLeft: 1 });
      assert.ok(bola.ok);
      const d = bola.ok ? await underwrite(ada.url, bola.policy, opts(s)) : null;
      assert.deepEqual(d?.kind === "DECLINE" ? d.reasons.map((r) => r.code) : d?.kind, ["ProofRevoked"]);
    });
    assert.equal(CODES.ProofRevoked?.outcome, "INVALID");
  });

  it("S21 no answer about revocation is never VALID or APPROVE: registry down or without code is ChainUnreachable; a network without one is NotConfigured (underwrite throws)", async () => {
    await withRpc({ revocationsDown: true }, async (s) => assert.equal(codeOf(await verifyIncomeLink(ada.url, opts(s))), "INCONCLUSIVE ChainUnreachable"));
    await withRpc({ revocationsFrom: FIXTURE.head + 1 }, async (s) => assert.equal(codeOf(await verifyIncomeLink(ada.url, opts(s))), "INCONCLUSIVE ChainUnreachable"));
    const { revocations: _none, ...without } = FIXTURE.network;
    const v = await verifyIncomeLink(ada.url, opts(rpc, { network: without }));
    assert.equal(codeOf(v), "INCONCLUSIVE NotConfigured");
    if (v.status === "INCONCLUSIVE") assert.match(v.message, /no Revocations registry/);
    const bola = definePolicy({ id: "bola", version: 1, title: "Bola", audience: "landlord", readerName: "Landlord Bola", minThreshold: "1000000", minPayments: 1, minPeriodDays: 1, maxPeriodDays: 92, maxProofAgeDays: 30, minDaysLeft: 1 });
    assert.ok(bola.ok);
    if (bola.ok) await assert.rejects(underwrite(ada.url, bola.policy, opts(rpc, { network: without })), (e: Error) => e instanceof ShaidaConfigError && /no Revocations registry/.test(e.message));
    await withRpc({ revocationsDown: true }, async (s) => {
      const d = bola.ok ? await underwrite(ada.url, bola.policy, opts(s)) : null;
      assert.equal(d?.kind === "INCONCLUSIVE" ? d.error.code : d?.kind, "ChainUnreachable");
    });
  });

  it("S22 0.1.0 calls work unchanged: an old link is VALID and says it is v1, name only, not revocable; decode says the same", async () => {
    const v = await verifyIncomeLink(`https://shaida.onrender.com${ada.url}`, { network: FIXTURE.network, rpcUrl: rpc.url, readerName: "Landlord Bola", now: () => NOW });
    assert.equal(v.status, "VALID");
    if (v.status === "VALID") assert.deepEqual(v.link, { version: 1, readerMode: "name", revocable: false });
    const d = decodeIncomeLink(ada.url);
    assert.ok(d.ok);
    if (d.ok) assert.deepEqual([d.link.version, d.link.readerMode], [1, "name"]);
    // a code given for a name-only link changes nothing
    assert.equal(codeOf(await verifyIncomeLink(ada.url, opts(rpc, { readerCode: "7K3M-Q9TB-4XWZ-H2RD" }))), "VALID");
  });
});

describe("shaida-sdk 0.2.0: reader codes (D36)", () => {
  it("S23 a link relabelled code-protected is WrongReader with the name alone and with any code, before any chain read", async () => {
    const asCode = relink({ ...json(ada.url), v: 2, reader: "code" });
    const calls = rpc.calls.length;
    assert.equal(codeOf(await verifyIncomeLink(asCode, opts(rpc))), "INVALID WrongReader");
    assert.equal(codeOf(await verifyIncomeLink(asCode, opts(rpc, { readerCode: "7K3M-Q9TB-4XWZ-H2RD" }))), "INVALID WrongReader");
    assert.equal(rpc.calls.length, calls, "refused on the link's content alone: no RPC call");
    const d = decodeIncomeLink(asCode);
    if (d.ok) assert.deepEqual([d.link.version, d.link.readerMode], [2, "code"]);
  });

  it("S24 a malformed reader code is INCONCLUSIVE InputRejected, and nothing is read", async () => {
    const calls = rpc.calls.length;
    for (const readerCode of ["", "ABC", "7K3M-Q9TB-4XWZ-H2R!", "7K3M-Q9TB-4XWZ-H2RDX"]) {
      assert.equal(codeOf(await verifyIncomeLink(ada.url, opts(rpc, { readerCode }))), "INCONCLUSIVE InputRejected", JSON.stringify(readerCode));
    }
    assert.equal(rpc.calls.length, calls);
  });
});
