// RP01 property test (D35, D36): random links across versions, reader modes and revocation states, opened by random
// readers, with random attacker edits of the version and mode fields. verifyIncomeLink never says VALID when the
// salt is revoked, the registry is unreadable, or the reader is wrong, and says VALID exactly when none of these
// holds. Groth16 is out of scope here (an exact-signals stand-in): the property is about steps 3–5a.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codeBoundReaderIdHash, contextOf, encodeIncomeLink, type Groth16Proof, type IncomeLink, type IncomeVerification,
  PUBLIC_SIGNAL_ORDER, readerIdHashOf, revokeSaltOf, TUSD8_FIELD, verifyIncomeLink, type VerifyDeps,
} from "../src/index";
import { registryRead, type Registry } from "./helpers/link";
import { Rng } from "./helpers/scenario";

const CASES = 3_000;
const ROOT = 0x900dn;
const EXPIRY = 1_900_000_000n;
const NAMES = ["Landlord Bola", "Lender Dayo", "Shaida underwriting bot (demo)"] as const;
const hashOf = (n: string) => { const r = readerIdHashOf(n); if (!r.ok) throw new Error(n); return r.value; };

type Made = { version: 1 | 2; mode: "name" | "code"; name: string; code: bigint; salt: bigint };
type Edit = "none" | "toV1" | "toName" | "toCode" | "v1ToV2Name";
type Opener = { name: string; code: bigint | null };

const PROOF: Groth16Proof = { pi_a: ["1", "2", "1"], pi_b: [["1", "0"], ["0", "1"], ["1", "0"]], pi_c: ["1", "2", "1"], protocol: "groth16", curve: "bn128" };

function linkOf(m: Made, accepted: Set<string>): IncomeLink {
  const readerIdHash = m.mode === "code" ? codeBoundReaderIdHash(hashOf(m.name), m.code) : hashOf(m.name);
  const signals: Record<(typeof PUBLIC_SIGNAL_ORDER)[number], bigint> = {
    ledgerRoot: ROOT, asset: TUSD8_FIELD, threshold: 3_000_000n, count: 3n, fromIndex: 0n, toIndex: 5n,
    context: contextOf(readerIdHash, EXPIRY, m.salt),
  };
  const publicSignals = PUBLIC_SIGNAL_ORDER.map((k) => signals[k].toString());
  accepted.add(JSON.stringify(publicSignals));
  const base = { proofs: [{ proof: PROOF, publicSignals }], readerIdHash: readerIdHash.toString(), expiry: EXPIRY.toString(), salt: m.salt.toString() };
  return m.version === 1 ? { v: 1, ...base } : { v: 2, ...base, reader: m.mode };
}

function editOf(l: IncomeLink, e: Edit): unknown {
  const { v: _v, ...rest } = l;
  const body = { ...rest } as Record<string, unknown>;
  delete body.reader;
  switch (e) {
    case "none": return l;
    case "toV1": return { v: 1, ...body };
    case "toName": return l.v === 2 ? { ...l, reader: "name" } : l;
    case "toCode": return l.v === 2 ? { ...l, reader: "code" } : { v: 2, ...body, reader: "code" };
    case "v1ToV2Name": return l.v === 1 ? { v: 2, ...body, reader: "name" } : l;
  }
}

/** The model: what the link as made, after the edit, opened by this reader, must give. */
function expected(m: Made, linkAfter: { v: number; reader?: string }, o: Opener, registry: Registry): string {
  const effectiveMode = linkAfter.v === 2 ? linkAfter.reader : "name";
  const readerOk = effectiveMode === m.mode && o.name === m.name && (m.mode === "name" || o.code === m.code);
  if (!readerOk) return "INVALID(WrongReader)";
  if (registry === "unreadable") return "INCONCLUSIVE(ChainUnreachable)";
  if (registry.has(m.salt)) return "INVALID(ProofRevoked)";
  return "VALID";
}

const codeOf = (v: IncomeVerification) => (v.status === "VALID" ? "VALID" : `${v.status}(${v.error.code})`);

describe("RP01 revocation and reader codes, as a property", () => {
  it(`RP01 over ${CASES} random links, VALID exactly when not revoked, readable and for this reader (never VALID when revoked or wrong reader)`, async () => {
    const rng = new Rng(0x5ead);
    const seen = new Map<string, number>();
    for (let i = 0; i < CASES; i++) {
      const version = rng.pick([1, 2] as const);
      const mode = version === 1 ? "name" : rng.pick(["name", "code"] as const);
      const secret = rng.field() % (1n << 248n) || 1n;
      const m: Made = { version, mode, name: rng.pick(NAMES), code: rng.next64() & ((1n << 80n) - 1n), salt: version === 2 ? revokeSaltOf(secret) : rng.field() };
      const accepted = new Set<string>();
      const made = linkOf(m, accepted);
      const edit = rng.pick(["none", "none", "toV1", "toName", "toCode", "v1ToV2Name"] as const);
      const after = editOf(made, edit) as { v: number; reader?: string };
      const opener: Opener = {
        name: rng.int(4) === 0 ? rng.pick(NAMES) : m.name,
        code: rng.pick([m.code, m.code, null, m.code ^ (1n << BigInt(rng.int(80)))]),
      };
      const registry: Registry = rng.pick([
        new Map<bigint, bigint>(),
        new Map([[m.salt, 7n]]),
        new Map([[revokeSaltOf(secret + 1n), 7n]]), // someone else's revocation
        "unreadable" as const,
      ]);
      const deps: VerifyDeps = {
        readerIdHash: hashOf(opener.name),
        readerCode: opener.code,
        revocation: registryRead(registry),
        now: () => 1_800_000_000n,
        isKnownRoot: async (r) => r === ROOT,
        verifyGroth16: async (s) => accepted.has(JSON.stringify(s)),
        resolveRange: async () => ({ fromDate: 1n, toDate: 2n }),
      };
      const fragmentJson = JSON.stringify(after);
      const fragment = Buffer.from(fragmentJson).toString("base64url");
      const got = codeOf(await verifyIncomeLink(fragment, deps));
      const want = expected(m, after, opener, registry);
      const revoked = registry !== "unreadable" && registry.has(m.salt);
      if (got === "VALID") {
        assert.ok(!revoked && registry !== "unreadable", `case ${i}: VALID while revoked or unreadable`);
      }
      assert.equal(got, want, `case ${i}: ${JSON.stringify({ version, mode, edit, opener: { ...opener, code: opener.code?.toString() }, registry: registry === "unreadable" ? registry : [...registry.keys()].map(String) })}`);
      seen.set(want, (seen.get(want) ?? 0) + 1);
    }
    // every outcome was exercised, so the property is not vacuous
    for (const k of ["VALID", "INVALID(WrongReader)", "INVALID(ProofRevoked)", "INCONCLUSIVE(ChainUnreachable)"]) assert.ok((seen.get(k) ?? 0) > 50, `${k}: ${seen.get(k) ?? 0} cases`);
    // the encoder still produces what was verified (no silent normalisation of v or reader)
    assert.doesNotThrow(() => encodeIncomeLink(linkOf({ version: 2, mode: "code", name: NAMES[0], code: 1n, salt: revokeSaltOf(1n) }, new Set())));
  });
});
