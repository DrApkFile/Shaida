// Shaida's contracts on each network, validated once. NEXT_PUBLIC_* values are inlined at build time, so they
// are written out in full; `node tools/write-web-env.mjs` fills them from deployments/<network>.json.
import type { NetworkKey } from "./env";
import { parseContracts, type ShaidaContracts } from "./web-config";

export type { ShaidaContracts };

export type ShaidaSetup =
  | { readonly ok: true; readonly contracts: ShaidaContracts }
  | { readonly ok: false; readonly problem: string };

const RAW: Record<NetworkKey, string | undefined> = {
  aevum: process.env.NEXT_PUBLIC_SHAIDA_AEVUM,
  fork: process.env.NEXT_PUBLIC_SHAIDA_FORK,
  local: process.env.NEXT_PUBLIC_SHAIDA_LOCAL,
};

function parse(key: NetworkKey): ShaidaSetup {
  const r = parseContracts(key, RAW[key]);
  return r.ok ? { ok: true, contracts: r.value } : { ok: false, problem: r.problem };
}

const SETUPS: Record<NetworkKey, ShaidaSetup> = { aevum: parse("aevum"), fork: parse("fork"), local: parse("local") };

export const shaidaSetup = (key: NetworkKey): ShaidaSetup => SETUPS[key];
