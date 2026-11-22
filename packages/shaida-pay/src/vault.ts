// The recipient's and the payer's secrets (receive key, notes, sweep notes), encrypted with a passphrase before
// they touch storage. The encrypted blob is also the exportable backup. Nothing here is ever sent to a server.
import { z } from "zod";
import { noteSchema } from "./notes";
import { inboxEntrySchema } from "./inbox-state";
import { sharedLinkSchema } from "./income";

const b64 = {
  enc: (u: Uint8Array) => btoa(String.fromCharCode(...u)),
  dec: (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 figure for PBKDF2-HMAC-SHA256

const jwk = z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string(), d: z.string(), ext: z.boolean().optional(), key_ops: z.array(z.string()).optional() }).strict();

export const vaultDataSchema = z
  .object({
    v: z.literal(1),
    chainId: z.number().int().positive(),
    /** The recipient's Gloam receive key (the private half of their gloamr1. address). */
    receiveKey: z.object({ tag: z.string().startsWith("gloamr1."), privateJwk: jwk, createdAt: z.number().optional() }).strict().nullable(),
    /** The payer's own notes (deposits and change), newest last; `spent` once used as a pay's input. */
    payerNotes: z.array(z.object({ note: noteSchema, spent: z.boolean(), label: z.string() }).strict()),
    /** Payments the payer sent (the payer knows their secret until the recipient sweeps; used for the demo clawback). */
    sent: z.array(z.object({ note: noteSchema, to: z.string(), at: z.string(), requestId: z.string().nullable() }).strict()),
    /** The recipient's inbox: one entry per payment, with its sweep state and fresh note. */
    inbox: z.array(inboxEntrySchema),
    /** Fork only: a demo payer key kept in this browser (D21). Refused on 44005. */
    demoPayerKey: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
    /** Proof links made in this browser (D27), newest last. Absent in vaults written before D27: read as empty. */
    shared: z.array(sharedLinkSchema).default([]),
  })
  .strict();
export type VaultData = z.output<typeof vaultDataSchema>;
export type VaultDataInput = z.input<typeof vaultDataSchema>;

export const emptyVault = (chainId: number): VaultData => ({ v: 1, chainId, receiveKey: null, payerNotes: [], sent: [], inbox: [], demoPayerKey: null, shared: [] });

const blobSchema = z
  .object({ v: z.literal(1), kdf: z.literal("PBKDF2-SHA256"), iterations: z.number().int().min(100_000), salt: z.string(), iv: z.string(), ct: z.string() })
  .strict();
export type VaultBlob = z.output<typeof blobSchema>;

async function keyFrom(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealVault(data: VaultData, passphrase: string): Promise<VaultBlob> {
  if (passphrase.length < 8) throw new RangeError("passphrase must be at least 8 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(vaultDataSchema.parse(data)))));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) };
}

export type OpenResult = { readonly ok: true; readonly data: VaultData } | { readonly ok: false; readonly reason: "not-a-vault" | "wrong-passphrase" | "corrupt" };

export async function openVault(raw: unknown, passphrase: string): Promise<OpenResult> {
  const blob = blobSchema.safeParse(raw);
  if (!blob.success) return { ok: false, reason: "not-a-vault" };
  const key = await keyFrom(passphrase, b64.dec(blob.data.salt), blob.data.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(blob.data.iv) }, key, b64.dec(blob.data.ct));
  } catch {
    return { ok: false, reason: "wrong-passphrase" }; // AES-GCM's tag check fails for a wrong key
  }
  const data = vaultDataSchema.safeParse(JSON.parse(new TextDecoder().decode(plain)));
  return data.success ? { ok: true, data: data.data } : { ok: false, reason: "corrupt" };
}

/** A freshly generated SDK receive key, checked into the vault's stricter shape (every JWK field present). */
export const storedReceiveKey = (k: unknown): NonNullable<VaultData["receiveKey"]> => vaultDataSchema.shape.receiveKey.unwrap().parse(k);
