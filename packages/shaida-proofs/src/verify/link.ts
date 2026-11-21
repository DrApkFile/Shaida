// The proof link payload (PRD §3 "Proof link", D12): a bundle of 1..MAX_BUNDLE_PROOFS Groth16 proofs plus the one
// context opening they share. Lives in the URL fragment as base64url(JSON); the server never sees it.
import { z } from "zod";
import { FIELD_ORDER, MAX_BUNDLE_PROOFS } from "../field";
import { PUBLIC_SIGNAL_ORDER } from "../circuit-input";

/** A canonical decimal string below the field order (what snarkjs emits and takes). */
const fieldString = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/, "must be a canonical decimal string")
  .refine((s) => BigInt(s) < FIELD_ORDER, "must be below the field order");
const pair = z.tuple([fieldString, fieldString]);

export const groth16ProofSchema = z
  .object({
    pi_a: z.tuple([fieldString, fieldString, fieldString]),
    pi_b: z.tuple([pair, pair, pair]),
    pi_c: z.tuple([fieldString, fieldString, fieldString]),
    protocol: z.literal("groth16"),
    curve: z.literal("bn128"),
  })
  .strict();

const signals = z.array(fieldString).length(PUBLIC_SIGNAL_ORDER.length);

export const incomeLinkSchema = z
  .object({
    v: z.literal(1),
    proofs: z
      .array(z.object({ proof: groth16ProofSchema, publicSignals: signals }).strict())
      .min(1)
      .max(MAX_BUNDLE_PROOFS),
    readerIdHash: fieldString,
    /** Unix seconds. */
    expiry: z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine((s) => BigInt(s) < 1n << 64n, "must be below 2^64"),
    salt: fieldString,
  })
  .strict();

export type Groth16Proof = z.infer<typeof groth16ProofSchema>;
export type IncomeLink = z.infer<typeof incomeLinkSchema>;

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The fragment for a link (without "#"). */
export function encodeIncomeLink(link: IncomeLink): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(incomeLinkSchema.parse(link))));
}

/** Fragment → JSON value, still unchecked (verify.ts applies the schema), or why it is not base64url JSON. */
export function decodeFragment(fragment: string): { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly why: string } {
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!/^[A-Za-z0-9_-]*$/.test(body)) return { ok: false, why: "the fragment is not base64url" };
  const b64 = body.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (body.length % 4)) % 4);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch (e) {
    return { ok: false, why: `the fragment does not decode: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, why: `the fragment is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}
