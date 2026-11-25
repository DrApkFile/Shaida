// The web app's network config, validated as a whole (audit B2, B3): NEXT_PUBLIC_NETWORKS and the contracts of every
// network it lists. One pure module, imported by next.config.ts (the build refuses), by startup.node.ts (the server
// refuses to start, exit 78) and by env.ts / shaida.ts (the app reads the same parse). It imports only zod, and uses
// only erasable TypeScript, so Node can load it directly (next.config.ts, node --test).
import { z } from "zod";

export const NETWORK_KEYS = ["aevum", "fork", "local"] as const;
export type NetworkKey = (typeof NETWORK_KEYS)[number];

export const CONTRACTS_ENV: Record<NetworkKey, string> = {
  aevum: "NEXT_PUBLIC_SHAIDA_AEVUM",
  fork: "NEXT_PUBLIC_SHAIDA_FORK",
  local: "NEXT_PUBLIC_SHAIDA_LOCAL",
};

/** A named refusal: the config is wrong, so the app does not build or start. */
export class WebConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`WebConfigError: ${problems.join("; ")}`);
    this.name = "WebConfigError";
    this.problems = problems;
  }
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const isKey = (k: string): k is NetworkKey => (NETWORK_KEYS as readonly string[]).includes(k);

/** NEXT_PUBLIC_NETWORKS: required; a comma list of known keys, no blanks, no repeats. Never a silent default. */
export function parseNetworkKeys(raw: string | undefined): Parsed<readonly [NetworkKey, ...NetworkKey[]]> {
  if (raw === undefined || raw.trim() === "") return { ok: false, problem: `NEXT_PUBLIC_NETWORKS is not set: set it to one or more of ${NETWORK_KEYS.join(", ")} (production: aevum)` };
  const parts = raw.split(",").map((k) => k.trim());
  const unknown = parts.filter((k) => !isKey(k));
  if (unknown.length) return { ok: false, problem: `NEXT_PUBLIC_NETWORKS has unknown network(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")}: allowed ${NETWORK_KEYS.join(", ")}` };
  const keys = parts.filter(isKey);
  if (new Set(keys).size !== keys.length) return { ok: false, problem: `NEXT_PUBLIC_NETWORKS lists a network twice: ${JSON.stringify(raw)}` };
  const [first, ...rest] = keys;
  if (!first) return { ok: false, problem: "NEXT_PUBLIC_NETWORKS lists no network" };
  return { ok: true, value: [first, ...rest] };
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not a 20-byte hex address").transform((a) => a.toLowerCase() as `0x${string}`);
const contractsSchema = z
  .object({
    pool: address,
    ledger: address,
    depositor: address,
    registry: address,
    memo: address,
    /** IncomeVerifier: check (view) and attest for income proofs (PRD §3, D27). */
    incomeVerifier: address,
    /** First block to index: the pool's deploy block. */
    startBlock: z.string().regex(/^[1-9][0-9]*$/).transform((b) => BigInt(b)),
  })
  .strict();

export type ShaidaContracts = z.output<typeof contractsSchema>;

/** NEXT_PUBLIC_SHAIDA_<NETWORK>: JSON of the contract addresses (tools/write-web-env.mjs writes it). */
export function parseContracts(key: NetworkKey, raw: string | undefined): Parsed<ShaidaContracts> {
  const name = CONTRACTS_ENV[key];
  if (!raw?.trim()) return { ok: false, problem: `${name} is not set (run node tools/write-web-env.mjs --network ${key})` };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, problem: `${name} is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = contractsSchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, problem: `${name}: ${issue ? `${issue.path.join(".") || "value"}: ${issue.message}` : "invalid"}` };
}

export interface WebConfig {
  readonly networks: readonly [NetworkKey, ...NetworkKey[]];
  readonly contracts: Readonly<Partial<Record<NetworkKey, ShaidaContracts>>>;
}

/** The whole config: every listed network must have valid contracts. Lists every problem, not the first. */
export function checkWebConfig(env: Readonly<Record<string, string | undefined>>): { readonly ok: true; readonly config: WebConfig } | { readonly ok: false; readonly problems: readonly string[] } {
  const nets = parseNetworkKeys(env.NEXT_PUBLIC_NETWORKS);
  if (!nets.ok) return { ok: false, problems: [nets.problem] };
  const problems: string[] = [];
  const contracts: Partial<Record<NetworkKey, ShaidaContracts>> = {};
  for (const key of nets.value) {
    const c = parseContracts(key, env[CONTRACTS_ENV[key]]);
    if (c.ok) contracts[key] = c.value;
    else problems.push(c.problem);
  }
  return problems.length ? { ok: false, problems } : { ok: true, config: { networks: nets.value, contracts } };
}
