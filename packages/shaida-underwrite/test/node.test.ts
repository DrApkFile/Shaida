// The bot's Node path (node.ts): the real Groth16 check with the ceremony's final vkey on a final-key proof made out
// to the bot (U20), and a real RPC client that cannot reach its node (U12d). Chain reads other than the RPC are stubs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createPublicClient, http, type PublicClient } from "viem";
import type { CheckedTrees } from "@shaida/index";
import { DAY, underwrite } from "../src/index";
import { nodeGroth16, nodeUnderwriteDeps, type LedgerView } from "../src/node";
import { NOW, RENT } from "./helpers";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/final-key-link.json", import.meta.url), "utf8")) as {
  fragment: string;
  signals: Record<string, string>;
};
const root = BigInt(fixture.signals.ledgerRoot!);

const realDeps = {
  now: () => NOW,
  isKnownRoot: async (r: bigint) => r === root,
  verifyGroth16: nodeGroth16,
  resolveRange: async () => ({ fromDate: NOW - 3n * DAY, toDate: NOW - 2n * DAY }),
  rootTime: async () => NOW - 2n * DAY,
};

describe("underwrite over real Groth16 (final key, D30)", () => {
  it("U20 APPROVE for a final-key proof made out to the bot; DECLINE(ProofInvalid) once a public signal is edited", async () => {
    const d = await underwrite(fixture.fragment, RENT, realDeps);
    assert.equal(d.kind, "APPROVE", JSON.stringify(d));
    const json = JSON.parse(Buffer.from(fixture.fragment, "base64url").toString("utf8")) as { proofs: { publicSignals: string[] }[] };
    json.proofs[0]!.publicSignals[2] = (BigInt(fixture.signals.threshold!) + 1_000_000n).toString(); // threshold + 1 tUSD8
    const edited = await underwrite(Buffer.from(JSON.stringify(json)).toString("base64url"), RENT, realDeps);
    assert.equal(edited.kind === "DECLINE" ? edited.reasons[0]!.code : edited.kind, "ProofInvalid");
    // the curve snarkjs used is the single-threaded one node.ts seeded (no worker per CPU)
    const curve = (globalThis as { curve_bn128?: { tm?: { concurrency?: number; workers?: unknown[] } } }).curve_bn128;
    assert.equal(curve?.tm?.concurrency, 1);
    assert.equal(curve?.tm?.workers, undefined);
  });
});

describe("underwrite over an unreachable RPC (D30)", () => {
  const deadClient = createPublicClient({ transport: http("http://127.0.0.1:9", { retryCount: 0, timeout: 3_000 }) }) as PublicClient;
  const view = async (): Promise<LedgerView> => ({ trees: { block: 1n } as CheckedTrees, timed: [], dated: [] });

  it("U12d INCONCLUSIVE(ChainUnreachable) from a real viem client whose node does not answer, and when the index cannot be loaded", async () => {
    const deps = nodeUnderwriteDeps({ client: deadClient, ledger: "0x677659b068278103f83eff413080cb53be3388ed", now: () => NOW, view, verifyGroth16: nodeGroth16 });
    const d = await underwrite(fixture.fragment, RENT, deps);
    assert.equal(d.kind === "INCONCLUSIVE" ? d.error.code : d.kind, "ChainUnreachable");
    const noIndex = nodeUnderwriteDeps({ client: deadClient, ledger: "0x677659b068278103f83eff413080cb53be3388ed", now: () => NOW, view: async () => { throw new Error("fetch failed"); } });
    const d2 = await underwrite(fixture.fragment, RENT, noIndex);
    assert.equal(d2.kind === "INCONCLUSIVE" ? d2.error.code : d2.kind, "ChainUnreachable");
  });

  it("U12e a malformed link is declined without reading the chain at all", async () => {
    let loads = 0;
    const deps = nodeUnderwriteDeps({ client: deadClient, ledger: "0x677659b068278103f83eff413080cb53be3388ed", now: () => NOW, view: async () => { loads++; return view(); } });
    const d = await underwrite("junk", RENT, deps);
    assert.equal(d.kind === "DECLINE" ? d.reasons[0]!.code : d.kind, "ProofInvalid");
    assert.equal(loads, 0);
  });
});
