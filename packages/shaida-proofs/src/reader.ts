// The reader id of a proof link (PRD §5 step 4, D27): hash(name) after normalization, so "Landlord Bola" and
// "  landlord   BOLA " are one reader. A name is not authentication (LIMITS.md): it names who a link is for.
import { poseidon6 } from "poseidon-lite";
import { type Result, shaidaError } from "./errors";

/** Domain tag of the reader hash, next to the ledger's VOUCH_TAG (1) and SWEEP_TAG (2). */
export const READER_TAG = 3n;
export const READER_NAME_MAX_BYTES = 96;
const CHUNK = 31; // bytes per field element (31 × 8 = 248 bits < the BN254 field)
const CHUNKS = 4; // 4 × 31 = 124 bytes ≥ READER_NAME_MAX_BYTES

/** NFC, trimmed, inner whitespace collapsed to one space, lower case. */
export const normalizeReaderName = (name: string): string => name.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

export function readerIdHashOf(name: string): Result<bigint> {
  const normal = normalizeReaderName(name);
  const bytes = new TextEncoder().encode(normal);
  if (bytes.length === 0) return { ok: false, error: shaidaError("InputRejected", "The reader name is empty. Nothing was built or checked.") };
  if (bytes.length > READER_NAME_MAX_BYTES) {
    return { ok: false, error: shaidaError("InputRejected", `The reader name is ${bytes.length} bytes; at most ${READER_NAME_MAX_BYTES}. Nothing was built or checked.`) };
  }
  const chunks: bigint[] = [];
  for (let c = 0; c < CHUNKS; c++) {
    let v = 0n;
    for (const b of bytes.subarray(c * CHUNK, (c + 1) * CHUNK)) v = (v << 8n) | BigInt(b);
    chunks.push(v);
  }
  return { ok: true, value: poseidon6([READER_TAG, BigInt(bytes.length), ...chunks]) };
}
