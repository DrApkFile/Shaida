// The underwriting bot from a terminal (D30): the same engine and policies as POST /api/underwrite, run on this
// machine. Trusts only the RPC: the ledger snapshot comes from a Shaida server's /api/index and is checked here
// (every leaf recomputed, both roots rebuilt and isKnownRoot on chain, PRD §8 A7). Never records on chain.
//   pnpm --filter @shaida/underwrite decide --preset rent-check --link 'https://shaida.onrender.com/v#…'
//   pnpm --filter @shaida/underwrite decide --preset revenue-credit --link @link.txt --json
// Options: --rpc (default https://rpc-test.qday.info), --index (default https://shaida.onrender.com),
//          --deployment (default deployments/aevum.json), --policies (default config/underwrite-policies.json). Exit 0 APPROVE, 2 DECLINE, 3 INCONCLUSIVE, 1 error.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { fetchCheckedTrees } from "@shaida/pay";
import { fragmentOf, ledgerNotReadable, parsePolicies, underwrite, type Decision } from "../src/index";
import { ledgerViewOf, nodeUnderwriteDeps } from "../src/node";

const REPO = new URL("../../..", import.meta.url).pathname;

function args(argv: readonly string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out.set(a.slice(2), true);
    else { out.set(a.slice(2), next); i++; }
  }
  return out;
}

const str = (m: Map<string, string | true>, k: string, fallback?: string): string => {
  const v = m.get(k);
  if (typeof v === "string") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${k} is required`);
};

const roots = parseAbi(["function isKnownRoot(bytes32 root) view returns (bool)"]);
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

function show(d: Decision): string {
  const head = `${d.kind} under ${d.policy.id}@${d.policy.version} (${d.policy.title}); decision ${d.decisionId.slice(0, 16)}…, proof ${d.proofId.slice(0, 16)}…`;
  if (d.kind === "INCONCLUSIVE") return `${head}\n  ${d.error.code}: ${d.error.message}\n  next: ${d.error.nextAction}`;
  const facts = d.facts ? `\n  facts: ≥ ${Number(d.facts.threshold) / 1e6} tUSD8, ${d.facts.count} payments, ${d.facts.periodDays} day(s), ledger state ${(Number(d.facts.proofAgeSeconds) / 86_400).toFixed(1)} days old, ${(Number(d.facts.secondsLeft) / 86_400).toFixed(1)} days left` : "";
  const reasons = d.kind === "DECLINE" ? d.reasons.map((r) => `\n  ✗ ${r.code}: ${r.message}`).join("") : "";
  return `${head}${facts}${reasons}`;
}

async function main(): Promise<number> {
  const a = args(process.argv.slice(2));
  const policies = parsePolicies(JSON.parse(readFileSync(str(a, "policies", join(REPO, "config/underwrite-policies.json")), "utf8")));
  const preset = str(a, "preset");
  const policy = policies.find((p) => p.id === preset);
  if (!policy) throw new Error(`no preset ${preset}; presets: ${policies.map((p) => p.id).join(", ")}`);
  const linkArg = str(a, "link");
  const link = linkArg.startsWith("@") ? readFileSync(linkArg.slice(1), "utf8") : linkArg;

  const deployment = JSON.parse(readFileSync(join(REPO, str(a, "deployment", "deployments/aevum.json")), "utf8")) as { chainId: number; contracts: Record<string, { address: Address }>; revocations?: { address: Address } };
  const ledger = deployment.contracts.ShaidaLedger?.address;
  if (!ledger) throw new Error("the deployment has no ShaidaLedger");
  // D35: every link is checked for revocation; without the registry the bot refuses to decide anything.
  const revocations = deployment.revocations?.address;
  if (!revocations) throw new Error("the deployment has no Revocations (make deploy-revocations-…): nothing can be decided");
  const client = createPublicClient({ transport: http(str(a, "rpc", "https://rpc-test.qday.info"), { retryCount: 2, timeout: 20_000 }) }) as PublicClient;
  if ((await client.getChainId()) !== deployment.chainId) throw new Error(`the RPC is not chain ${deployment.chainId}`);
  const indexBase = str(a, "index", "https://shaida.onrender.com").replace(/\/+$/, "");
  const blockTimes = new Map<bigint, Promise<bigint>>();

  const deps = nodeUnderwriteDeps({
    client,
    ledger,
    revocations,
    now: () => BigInt(Math.floor(Date.now() / 1000)),
    view: async () => {
      const t = await fetchCheckedTrees(indexBase, deployment.chainId, async (url) => { const r = await fetch(url, { cache: "no-store" }); return { status: r.status, json: () => r.json() as Promise<unknown> }; }, {
        isKnownRoot: (c, root, block) => client.readContract({ address: c as Address, abi: roots, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: block }),
      }, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      if (!t.ok) throw ledgerNotReadable("UnknownRoot", t.error.message);
      return ledgerViewOf(t.value, (b) => {
        let p = blockTimes.get(b);
        if (!p) { p = client.getBlock({ blockNumber: b }).then((x) => x.timestamp); blockTimes.set(b, p); }
        return p;
      });
    },
  });
  const d = await underwrite(fragmentOf(link), policy, deps);
  console.log(a.has("json") ? JSON.stringify(d, null, 2) : show(d));
  return d.kind === "APPROVE" ? 0 : d.kind === "DECLINE" ? 2 : 3;
}

// snarkjs keeps Node alive after verifying (CLAUDE.md): exit explicitly.
main().then((code) => process.exit(code), (e: unknown) => {
  console.error(`✗ underwrite: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
