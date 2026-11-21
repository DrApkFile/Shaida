// Request bodies, one per relayed function. Strict: an unknown field is refused, never ignored.
import { z } from "zod";
import type { Address, Hex } from "viem";

const hex = (bytes?: number) =>
  z
    .string()
    .regex(bytes === undefined ? /^0x([0-9a-fA-F]{2})*$/ : new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
    .transform((s) => s.toLowerCase() as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase() as Address);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, "decimal string").transform((s) => BigInt(s));
const chainId = z.number().int().positive();
/** 65-byte ECDSA signature. */
const signature = hex(65);
/** Groth16 proof as Gloam packs it: abi.encode(a, b, c) = 8 words. */
const proof = hex(256);

export const transferSchema = z
  .object({ proof, root: hex(32), nullifier: hex(32), newCommitments: z.tuple([hex(32), hex(32)]) })
  .strict();

export const depositBody = z
  .object({ chainId, payer: address, amount: uint, commitment: hex(32), shieldProof: proof, validAfter: uint, validBefore: uint, signature })
  .strict();

export const vouchedPayBody = z.object({ chainId, payer: address, transfer: transferSchema, deadline: uint, signature }).strict();

export const lateVouchBody = z.object({ chainId, payer: address, commitment: hex(32), deadline: uint, signature }).strict();

export const sweepBody = z.object({ chainId, transfer: transferSchema }).strict();

/** GloamPayMemo allows 8,192 bytes; a sealed Gloam payment is well under 2,048. */
export const MAX_MEMO_BYTES = 2048;
export const memoBody = z
  .object({ chainId, commitment: hex(32), memo: hex().refine((m) => m.length >= 4 && (m.length - 2) / 2 <= MAX_MEMO_BYTES, `1..${MAX_MEMO_BYTES} bytes`) })
  .strict();

export type DepositBody = z.output<typeof depositBody>;
export type VouchedPayBody = z.output<typeof vouchedPayBody>;
export type LateVouchBody = z.output<typeof lateVouchBody>;
export type SweepBody = z.output<typeof sweepBody>;
export type MemoBody = z.output<typeof memoBody>;
