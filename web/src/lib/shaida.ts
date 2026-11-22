// Shaida's contracts on each network, validated once. NEXT_PUBLIC_* values are inlined at build time, so they
// are written out in full; `node tools/write-web-env.mjs` fills them from deployments/<network>.json.
import { z } from "zod";
import type { Address } from "viem";
import type { NetworkKey } from "./env";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase() as Address);
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

export type ShaidaSetup =
  | { readonly ok: true; readonly contracts: ShaidaContracts }
  | { readonly ok: false; readonly problem: string };

const RAW: Record<NetworkKey, string | undefined> = {
  aevum: process.env.NEXT_PUBLIC_SHAIDA_AEVUM,
  fork: process.env.NEXT_PUBLIC_SHAIDA_FORK,
  local: process.env.NEXT_PUBLIC_SHAIDA_LOCAL,
};

const ENV_NAME: Record<NetworkKey, string> = {
  aevum: "NEXT_PUBLIC_SHAIDA_AEVUM",
  fork: "NEXT_PUBLIC_SHAIDA_FORK",
  local: "NEXT_PUBLIC_SHAIDA_LOCAL",
};

function parse(key: NetworkKey): ShaidaSetup {
  const raw = RAW[key];
  if (!raw?.trim()) return { ok: false, problem: `${ENV_NAME[key]} is not set (run node tools/write-web-env.mjs)` };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, problem: `${ENV_NAME[key]} is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = contractsSchema.safeParse(json);
  return r.success ? { ok: true, contracts: r.data } : { ok: false, problem: `${ENV_NAME[key]}: ${r.error.issues[0]?.message ?? "invalid"}` };
}

const SETUPS: Record<NetworkKey, ShaidaSetup> = { aevum: parse("aevum"), fork: parse("fork"), local: parse("local") };

export const shaidaSetup = (key: NetworkKey): ShaidaSetup => SETUPS[key];
