// Revocation (D35) and reader codes (D36) in verifyIncomeLink (PRD §5 steps 4 and 5a). Groth16 is the
// witness-backed stand-in (helpers/link.ts): the proofs here are real circuit witnesses for each link's context.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIncomeBundle, codeBoundReaderIdHash, decodeFragment, encodeIncomeLink, incomeLinkSchema, type IncomeVerification,
  parseReaderCode, readerCodeFromBytes, readerIdHashOf, revokeSaltOf, revokeSecretFromBytes, verifyIncomeLink, type VerifyDeps,
} from "../src/index";
import { contextFor, depsFor, fragment, fragmentV2, type Opening, type Registry, WitnessBackedProver } from "./helpers/link";
import { honestRequest, makeScenario, Rng, showableThreshold } from "./helpers/scenario";

const name = readerIdHashOf("Landlord Bola");
if (!name.ok) throw new Error("reader name");
const NAME = name.value;
const CODE_TEXT = readerCodeFromBytes(Uint8Array.from([0x9b, 0x3e, 0x01, 0x77, 0xc4, 0x52, 0xa0, 0x0f, 0xde, 0x66]));
const CODE = (() => { const c = parseReaderCode(CODE_TEXT); if (!c.ok) throw new Error("code"); return c.value; })();
const WRONG_CODE = CODE ^ 1n;
const SECRET = revokeSecretFromBytes(new Uint8Array(31).fill(7));
const SALT = revokeSaltOf(SECRET);
const EXPIRY = 1_900_000_000n;

const v1Opening: Opening = { readerIdHash: NAME, expiry: EXPIRY, salt: 0x51a7n };
const v2NameOpening: Opening = { readerIdHash: NAME, expiry: EXPIRY, salt: SALT };
const v2CodeOpening: Opening = { readerIdHash: codeBoundReaderIdHash(NAME, CODE), expiry: EXPIRY, salt: SALT };

async function proofsFor(o: Opening, seed = 7) {
  const s = makeScenario(new Rng(seed), { payments: 3, noise: 1 });
  const prover = new WitnessBackedProver();
  const total = showableThreshold(honestRequest(s, new Rng(seed)));
  const r = buildIncomeBundle(honestRequest(s, new Rng(seed), { threshold: total, context: contextFor(o) }));
  if (!r.ok) assert.fail(r.error.code);
  const proofs = await Promise.all(r.value.proofs.map((p) => prover.prove(p)));
  const deps = (extra: { readerIdHash?: bigint; readerCode?: bigint | null; registry?: Registry } = {}): VerifyDeps =>
    depsFor(prover.verify, extra.readerIdHash ?? NAME, [s.tree.root], 1_800_000_000n, extra);
  return { proofs, deps };
}

const code = (v: IncomeVerification) => (v.status === "VALID" ? "VALID" : `${v.status}(${v.error.code})`);
const revokedAt = (block: bigint): Registry => new Map([[SALT, block]]);
/** Re-encodes a fragment with `edit` applied to its JSON (an attacker editing the link). */
const edited = (f: string, edit: (j: Record<string, unknown>) => Record<string, unknown>) => {
  const d = decodeFragment(f);
  if (!d.ok) throw new Error(d.why);
  const json = edit({ ...(d.json as Record<string, unknown>) });
  return Buffer.from(JSON.stringify(json)).toString("base64url");
};

describe("D35 revocation (PRD §5 step 5a)", () => {
  it("RV10 a revoked link is INVALID ProofRevoked, with the revocation's block and time", async () => {
    const t = await proofsFor(v2NameOpening);
    const f = fragmentV2(t.proofs, v2NameOpening, "name");
    assert.equal(code(await verifyIncomeLink(f, t.deps())), "VALID", "before the revoke");
    const v = await verifyIncomeLink(f, t.deps({ registry: revokedAt(4_100_000n) }));
    assert.equal(code(v), "INVALID(ProofRevoked)");
    assert.ok(v.status === "INVALID" && v.revokedAt);
    assert.deepEqual(v.revokedAt, { block: 4_100_000n, time: 1_750_000_000n + 4_100_000n });
  });

  it("RV11 a wrong secret can't revoke: another secret's salt leaves this link VALID", async () => {
    const t = await proofsFor(v2NameOpening);
    const other = revokeSaltOf(SECRET + 1n);
    assert.notEqual(other, SALT);
    const v = await verifyIncomeLink(fragmentV2(t.proofs, v2NameOpening, "name"), t.deps({ registry: new Map([[other, 9n]]) }));
    assert.equal(code(v), "VALID");
  });

  it("RV12 an old v1 link is not revocable but still VALID, labelled as made before revocation", async () => {
    const t = await proofsFor(v1Opening);
    const v = await verifyIncomeLink(fragment(t.proofs, v1Opening), t.deps());
    assert.equal(code(v), "VALID");
    assert.ok(v.status === "VALID");
    assert.deepEqual(v.link, { version: 1, readerMode: "name", revocable: false });
  });

  it("RV13 a revoked v2 link edited to say v1 is still ProofRevoked (the salt is checked for every version)", async () => {
    const t = await proofsFor(v2NameOpening);
    const down = edited(fragmentV2(t.proofs, v2NameOpening, "name"), (j) => { delete j.reader; return { ...j, v: 1 }; });
    assert.equal(code(await verifyIncomeLink(down, t.deps())), "VALID", "the downgrade alone passes the context check");
    assert.equal(code(await verifyIncomeLink(down, t.deps({ registry: revokedAt(5n) }))), "INVALID(ProofRevoked)");
  });

  it("RV14 an unreadable revocation registry is INCONCLUSIVE, never VALID, for v1 and v2 links", async () => {
    for (const [o, f] of [[v1Opening, (p: Awaited<ReturnType<typeof proofsFor>>["proofs"]) => fragment(p, v1Opening)], [v2NameOpening, (p: Awaited<ReturnType<typeof proofsFor>>["proofs"]) => fragmentV2(p, v2NameOpening, "name")]] as const) {
      const t = await proofsFor(o);
      assert.equal(code(await verifyIncomeLink(f(t.proofs), t.deps({ registry: "unreadable" }))), "INCONCLUSIVE(ChainUnreachable)");
    }
  });

  it("RV15 content refusals read no registry: WrongReader and ProofExpired come first and offline", async () => {
    const t = await proofsFor(v2NameOpening);
    const f = fragmentV2(t.proofs, v2NameOpening, "name");
    let reads = 0;
    const counting = (d: VerifyDeps): VerifyDeps => ({ ...d, revocation: async (s) => { reads++; return d.revocation(s); } });
    assert.equal(code(await verifyIncomeLink(f, counting(t.deps({ readerIdHash: NAME + 1n, registry: revokedAt(1n) })))), "INVALID(WrongReader)");
    assert.equal(code(await verifyIncomeLink(f, { ...counting(t.deps({ registry: revokedAt(1n) })), now: () => EXPIRY + 1n })), "INVALID(ProofExpired)");
    assert.equal(reads, 0);
  });

  it("RV16 v2 links report themselves revocable; the secret's salt is Poseidon(4, secret)", async () => {
    const t = await proofsFor(v2NameOpening);
    const v = await verifyIncomeLink(fragmentV2(t.proofs, v2NameOpening, "name"), t.deps());
    assert.ok(v.status === "VALID");
    assert.deepEqual(v.link, { version: 2, readerMode: "name", revocable: true });
    // poseidon-lite poseidon2([4, 1]) = the contract's saltOf(1) (contracts test RV05)
    assert.equal(revokeSaltOf(1n), 0x0c9d5facc929a65bc38007fe19281760a02ac15f4b85bff641d65d156d4c213dn);
    assert.throws(() => revokeSecretFromBytes(new Uint8Array(31)), /zero/);
  });
});

describe("D36 reader codes (PRD §5 step 4)", () => {
  it("RC01 the reader's name and code give VALID, reported as code-checked", async () => {
    const t = await proofsFor(v2CodeOpening);
    const v = await verifyIncomeLink(fragmentV2(t.proofs, v2CodeOpening, "code"), t.deps({ readerCode: CODE }));
    assert.equal(code(v), "VALID");
    assert.ok(v.status === "VALID");
    assert.deepEqual(v.link, { version: 2, readerMode: "code", revocable: true });
  });

  it("RC02 the name alone (no code) is WrongReader", async () => {
    const t = await proofsFor(v2CodeOpening);
    const v = await verifyIncomeLink(fragmentV2(t.proofs, v2CodeOpening, "code"), t.deps({ readerCode: null }));
    assert.equal(code(v), "INVALID(WrongReader)");
    assert.match(v.status === "INVALID" ? v.error.message : "", /code-protected/);
  });

  it("RC03 a wrong code is WrongReader, and so is the right code with another name", async () => {
    const t = await proofsFor(v2CodeOpening);
    const f = fragmentV2(t.proofs, v2CodeOpening, "code");
    assert.equal(code(await verifyIncomeLink(f, t.deps({ readerCode: WRONG_CODE }))), "INVALID(WrongReader)");
    const other = readerIdHashOf("Landlord Bolu");
    assert.ok(other.ok);
    assert.equal(code(await verifyIncomeLink(f, t.deps({ readerIdHash: other.value, readerCode: CODE }))), "INVALID(WrongReader)");
  });

  it("RC04 a code-protected link without a code is WrongReader, also when edited to say name-only or v1", async () => {
    const t = await proofsFor(v2CodeOpening);
    const f = fragmentV2(t.proofs, v2CodeOpening, "code");
    const asName = edited(f, (j) => ({ ...j, reader: "name" }));
    const asV1 = edited(f, (j) => { delete j.reader; return { ...j, v: 1 }; });
    for (const link of [f, asName, asV1]) {
      assert.equal(code(await verifyIncomeLink(link, t.deps({ readerCode: null }))), "INVALID(WrongReader)");
    }
    // and the code does not rescue an edited mode: a "name" link is checked by the name, which differs
    assert.equal(code(await verifyIncomeLink(asName, t.deps({ readerCode: CODE }))), "INVALID(WrongReader)");
  });

  it("RC05 old name-only links stay VALID with their label, with or without a code typed", async () => {
    const old = await proofsFor(v1Opening);
    for (const readerCode of [null, CODE]) {
      const v = await verifyIncomeLink(fragment(old.proofs, v1Opening), old.deps({ readerCode }));
      assert.ok(v.status === "VALID", code(v));
      assert.equal(v.link.readerMode, "name");
      assert.equal(v.link.revocable, false);
    }
    const nameV2 = await proofsFor(v2NameOpening);
    const v = await verifyIncomeLink(fragmentV2(nameV2.proofs, v2NameOpening, "name"), nameV2.deps());
    assert.ok(v.status === "VALID" && v.link.readerMode === "name");
  });

  it("RC06 codes are 16 Crockford base32 characters (80 bits), read forgivingly and refused by name otherwise", () => {
    assert.match(CODE_TEXT, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const loose = parseReaderCode(` ${CODE_TEXT.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `);
    assert.ok(loose.ok && loose.value === CODE, "case, spaces, O/0 and I/L/1 are forgiven");
    const max = parseReaderCode("ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    assert.ok(max.ok && max.value === (1n << 80n) - 1n);
    for (const bad of ["", "ABCD-EFGH-JKMN", "ABCD-EFGH-JKMN-PQRS-T", "ABCD-EFGH-JKMN-PQRU"]) {
      const r = parseReaderCode(bad);
      assert.ok(!r.ok && r.error.code === "InputRejected", bad);
    }
    assert.throws(() => readerCodeFromBytes(new Uint8Array(9)), /10 random bytes/);
    for (let i = 0; i < 200; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(10));
      const c = parseReaderCode(readerCodeFromBytes(bytes));
      assert.ok(c.ok && c.value === bytes.reduce((a, b) => (a << 8n) | BigInt(b), 0n));
    }
  });

  it("RC07 a reader code never appears in the link: not as text, not as its value", async () => {
    const t = await proofsFor(v2CodeOpening);
    const f = fragmentV2(t.proofs, v2CodeOpening, "code");
    const json = JSON.stringify(incomeLinkSchema.parse((decodeFragment(f) as { json: unknown }).json));
    for (const needle of [CODE_TEXT, CODE_TEXT.replace(/-/g, ""), CODE.toString(), CODE.toString(16)]) {
      assert.ok(!f.includes(needle) && !json.toLowerCase().includes(needle.toLowerCase()), `link contains ${needle}`);
    }
    assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ["expiry", "proofs", "reader", "readerIdHash", "salt", "v"]);
    // the encoder refuses a field it does not know, so a code cannot be added to a link by mistake
    assert.throws(() => encodeIncomeLink({ ...JSON.parse(json), readerCode: CODE_TEXT }));
  });
});
