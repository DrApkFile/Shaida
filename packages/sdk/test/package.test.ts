// What the package ships: pinned key and network, an API surface equal to README's, closed codes, exact selectors,
// and a bundle with no GPL code inlined and no host but the bundled RPC.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, toEventSelector, toFunctionSelector } from "viem";
import { INCOME_FINAL_VKEY, solidityArgsOf } from "@shaida/proofs";
import * as sdk from "../dist/index.js";
import { SELECTORS, TOPICS } from "../src/ledger";
import { AEVUM_TESTNET } from "../src/network";
import { canonicalHash, checkPins, PINNED } from "../src/pins";
import { FIXTURE, startFixtureRpc } from "./fixture-rpc";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(`${PKG}${p}`, "utf8");

describe("pins (refuse on mismatch)", () => {
  it("S12 the bundled key and network match their pins; an edited key or network is refused by name", () => {
    assert.deepEqual(checkPins(INCOME_FINAL_VKEY, AEVUM_TESTNET, PINNED), { ok: true });
    const key = structuredClone(INCOME_FINAL_VKEY) as Record<string, unknown>;
    (key.IC as string[][])[0]![0] = "1";
    const k = checkPins(key, AEVUM_TESTNET, PINNED);
    assert.ok(!k.ok && /verification key hashes to/.test(k.why));
    const n = checkPins(INCOME_FINAL_VKEY, { ...AEVUM_TESTNET, ledger: "0x0000000000000000000000000000000000000001" }, PINNED);
    assert.ok(!n.ok && /network config hashes to/.test(n.why));
  });
  it("S12b the pinned key is the ceremony's final vkey (file sha256 in ceremony/record.json) and the network is deployments/aevum.json", () => {
    const record = JSON.parse(readFileSync(`${REPO}ceremony/record.json`, "utf8")) as { final: { vkey: { sha256: string } } };
    const file = readFileSync(`${REPO}packages/shaida-proofs/keys/income_final_vkey.json`);
    assert.equal(createHash("sha256").update(file).digest("hex"), record.final.vkey.sha256);
    assert.equal(canonicalHash(JSON.parse(file.toString())), PINNED.vkeySha256);
    const dep = JSON.parse(readFileSync(`${REPO}deployments/aevum.json`, "utf8")) as { chainId: number; ledgerDeployBlock: number; contracts: Record<string, { address: string }>; revocations?: { address: string } };
    assert.equal(AEVUM_TESTNET.chainId, dep.chainId);
    assert.equal(AEVUM_TESTNET.ledger, dep.contracts.ShaidaLedger!.address.toLowerCase());
    assert.equal(AEVUM_TESTNET.incomeVerifier, dep.contracts.IncomeVerifier!.address.toLowerCase());
    assert.equal(AEVUM_TESTNET.fromBlock, BigInt(dep.ledgerDeployBlock));
    assert.equal(AEVUM_TESTNET.revocations, dep.revocations?.address.toLowerCase() ?? null, "Revocations is the one deployments/aevum.json records (null before it is deployed)");
    assert.deepEqual(sdk.PINNED, PINNED);
  });
});

describe("public API = README", () => {
  const readme = read("README.md");
  const api = readme.slice(readme.indexOf("## API reference"), readme.indexOf("\n## ", readme.indexOf("## API reference") + 5));
  it("S13 every export is documented under API reference, and every documented name is exported", () => {
    const typesTable = api.slice(api.indexOf("### Types"));
    const documented = [...api.matchAll(/^### `([A-Za-z_]+)/gm), ...typesTable.matchAll(/^\| `([A-Za-z_]+)` \|/gm)].map((m) => m[1]!).sort();
    const dts = read("dist/index.d.ts");
    const declared = [...dts.matchAll(/export (?:type )?\{([^}]+)\}/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim().replace(/^type /, "")).filter(Boolean));
    for (const v of Object.keys(sdk)) assert.ok(declared.includes(v), `runtime export ${v} has no declaration`);
    assert.deepEqual([...new Set(declared)].sort(), documented);
  });
  it("S14 the codes table lists exactly CODES, with each code's outcome", () => {
    const table = readme.slice(readme.indexOf("## Codes"));
    const rows = [...table.matchAll(/^\| `(\w+)` \| (VALID|INVALID|INCONCLUSIVE|DECLINE) \|/gm)].map((m) => [m[1]!, m[2]!]);
    assert.deepEqual(Object.fromEntries(rows), Object.fromEntries(Object.entries(sdk.CODES).map(([c, i]) => [c, i.outcome])));
  });
});

describe("wire format", () => {
  it("S15 selectors and topics equal viem's, and checkOnChain sends exactly viem's calldata with 400k gas", async () => {
    assert.equal(SELECTORS.isKnownRoot, toFunctionSelector("function isKnownRoot(bytes32)"));
    assert.equal(SELECTORS.nextIndex, toFunctionSelector("function nextIndex()"));
    assert.equal(SELECTORS.check, toFunctionSelector("function check((uint256[2],uint256[2][2],uint256[2]),uint256[7])"));
    assert.equal(TOPICS.Vouched, toEventSelector("event Vouched(uint32 indexed payerId, bytes32 indexed paymentCommitment, uint256 leafIndex, bytes32 leaf)"));
    assert.equal(TOPICS.Swept, toEventSelector("event Swept(bytes32 indexed nullifier, bytes32 indexed sweepCommitment, uint256 leafIndex, bytes32 leaf)"));
    const rpc = await startFixtureRpc();
    try {
      const link = FIXTURE.links.find((l) => l.name === "chidi")!.url;
      await sdk.checkOnChain(link, { network: FIXTURE.network, rpcUrl: rpc.url });
      const sent = rpc.calls.find((c) => c.method === "eth_call")!.params[0] as { to: string; data: string; gas: string };
      const j = JSON.parse(Buffer.from(link.split("#")[1]!, "base64url").toString()) as { proofs: { proof: Parameters<typeof solidityArgsOf>[0]; publicSignals: string[] }[] };
      const { proof, signals } = solidityArgsOf(j.proofs[0]!.proof, j.proofs[0]!.publicSignals);
      const abi = parseAbi(["struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }", "function check(Proof proof, uint256[7] signals) view returns (bool)"]);
      assert.equal(sent.data, encodeFunctionData({ abi, functionName: "check", args: [proof as never, signals as never] }));
      assert.equal(BigInt(sent.gas), 400_000n);
      assert.equal(sent.to, FIXTURE.network.incomeVerifier);
    } finally { await rpc.close(); }
  });
});

describe("the built package", () => {
  it("S16 dist inlines no GPL code, its declarations stay inside the package, and it names no host but the bundled RPC", () => {
    const inputs = JSON.parse(read("build-inputs.json")) as { packages: string[] };
    for (const p of inputs.packages) assert.ok(!/snarkjs|ffjavascript|circom|r1cs|wasmcurves|wasmbuilder/.test(p), p);
    for (const f of readdirSync(`${PKG}dist`).filter((f) => f.endsWith(".d.ts"))) {
      for (const [, spec] of read(`dist/${f}`).matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(spec!.startsWith("./"), `${f} imports ${spec}`);
    }
    const js = read("dist/index.js");
    const hosts = new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase()));
    assert.deepEqual([...hosts].filter((h) => h !== "rpc-test.qday.info" && !h.endsWith("github.com")), []);
    const imports = new Set([...js.matchAll(/(?:from|import\()\s*["']([^"'./][^"']*)["']/g)].map((m) => m[1]!));
    assert.deepEqual([...imports].sort(), ["ffjavascript", "poseidon-lite", "snarkjs", "zod"]);
  });
});

describe("viem shim", () => {
  it("S17 the bundle's sha256 and stringToBytes equal viem's", async () => {
    const viem = await import("viem");
    const shim = await import("../src/viem-shim");
    for (const s of ["", "shaida-underwrite/1|x", "Landlord Bola ünïcode", "x".repeat(10_000)]) {
      assert.deepEqual(shim.stringToBytes(s), viem.stringToBytes(s));
      assert.equal(shim.sha256(shim.stringToBytes(s)), viem.sha256(viem.stringToBytes(s)));
    }
  });
});

describe("publish manifest", () => {
  it("S19 the shipped package.json is shaida-sdk with its exports, files and runtime deps, and no devDependencies, scripts, workspace: or @shaida/ name", async () => {
    const { publishManifest } = await import("../scripts/pack.mjs");
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const shipped = publishManifest(pkg);
    assert.equal(shipped.name, "shaida-sdk");
    assert.equal(shipped.version, "0.2.0");
    assert.deepEqual(shipped.exports, pkg.exports);
    assert.deepEqual(shipped.files, ["dist", "README.md", "NOTICE.md", "LICENSE"]);
    assert.deepEqual(shipped.dependencies, { ffjavascript: "0.3.1", "poseidon-lite": "0.3.0", snarkjs: "0.7.6", zod: "3.25.76" });
    assert.ok(!("devDependencies" in shipped) && !("scripts" in shipped));
    assert.doesNotMatch(JSON.stringify(shipped), /workspace:|@shaida\//);
    assert.throws(() => publishManifest({ ...pkg, dependencies: { "@shaida/proofs": "workspace:*" } }), /would ship/);
  });
});
