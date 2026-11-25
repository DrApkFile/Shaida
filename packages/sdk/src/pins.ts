// What the SDK verifies with is fixed at build time: the ceremony's final verification key and the 44005 network
// config, each with a pinned sha256 over its canonical JSON. A copy that was edited after build (a patched bundle, a
// swapped key) no longer matches, and every call refuses with NotConfigured before reading the chain.
import { sha256, stringToBytes } from "./viem-shim";
import { INCOME_FINAL_VKEY } from "@shaida/proofs";
import { AEVUM_TESTNET } from "./network";

/** sha256 of canonical JSON (keys sorted at every level; bigint as decimal string). */
export function canonicalHash(value: unknown): string {
  const canon = (v: unknown): unknown =>
    typeof v === "bigint" ? v.toString()
      : Array.isArray(v) ? v.map(canon)
        : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
          : v;
  return sha256(stringToBytes(JSON.stringify(canon(value)))).slice(2);
}

export const PINNED = Object.freeze({
  /** Canonical-JSON hash of income_final_vkey.json (file sha256 2635a810…, ceremony/record.json final.vkey). */
  vkeySha256: "6a782a2b31d9d6b8e90e7950c34be731c2445060c1b1d8ada47b735c32534265",
  /** Canonical-JSON hash of AEVUM_TESTNET (0.2.0: with `revocations`). */
  networkSha256: "66fcf3fb643a561b74202468706b84b77ab40be0d77e498a0033956be96e7047",
});

/** Pure: compares what is about to be used with what was pinned. Exported for the tests, not from the package. */
export function checkPins(
  vkey: unknown,
  network: unknown,
  pins: { readonly vkeySha256: string; readonly networkSha256: string },
): { ok: true } | { ok: false; why: string } {
  const k = canonicalHash(vkey);
  if (k !== pins.vkeySha256) return { ok: false, why: `the bundled verification key hashes to ${k.slice(0, 12)}…, not the pinned ${pins.vkeySha256.slice(0, 12)}…` };
  const n = canonicalHash(network);
  if (n !== pins.networkSha256) return { ok: false, why: `the bundled network config hashes to ${n.slice(0, 12)}…, not the pinned ${pins.networkSha256.slice(0, 12)}…` };
  return { ok: true };
}

let checked: { ok: true } | { ok: false; why: string } | null = null;
/** The bundled pair, checked once per process. */
export const bundledPins = () => (checked ??= checkPins(INCOME_FINAL_VKEY, AEVUM_TESTNET, PINNED));
