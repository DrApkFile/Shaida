// Reader codes (D36): a random code the reader makes on /v and gives to the person proving to them. A code-protected
// link (link v2, reader "code") binds readerIdHash = Poseidon(READER_CODE_TAG, nameHash, Poseidon(code)), so a
// forwarded link plus the reader's name, without the code, is WrongReader. The code never goes in the link.
// Format: 16 Crockford base32 characters (80 random bits), shown as XXXX-XXXX-XXXX-XXXX. Pure: randomness injected.
import { poseidon1, poseidon3 } from "poseidon-lite";
import { type Result, shaidaError } from "./errors";

/** Domain tag of a code-bound reader id, next to the ledger's 1 and 2, the reader name's 3 and the revoke salt's 4. */
export const READER_CODE_TAG = 5n;
export const READER_CODE_CHARS = 16;
export const READER_CODE_BITS = READER_CODE_CHARS * 5; // 80
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

/** Upper case, spaces and dashes dropped, and Crockford's look-alikes read as digits (O → 0, I and L → 1). */
export const normalizeReaderCode = (text: string): string =>
  text.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/** The code's value as a field element (< 2^80). InputRejected for a wrong length or a character outside the alphabet. */
export function parseReaderCode(text: string): Result<bigint> {
  const s = normalizeReaderCode(text);
  if (s.length !== READER_CODE_CHARS) {
    return { ok: false, error: shaidaError("InputRejected", `A reader code has ${READER_CODE_CHARS} characters; this one has ${s.length}. Nothing was built or checked.`) };
  }
  let v = 0n;
  for (const ch of s) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) return { ok: false, error: shaidaError("InputRejected", `"${ch}" is not a reader-code character. Nothing was built or checked.`) };
    v = (v << 5n) | BigInt(d);
  }
  return { ok: true, value: v };
}

/** A code from 10 random bytes (80 bits), grouped XXXX-XXXX-XXXX-XXXX. The caller supplies the randomness. */
export function readerCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== READER_CODE_BITS / 8) throw new RangeError(`a reader code needs ${READER_CODE_BITS / 8} random bytes, got ${bytes.length}`);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  let s = "";
  for (let i = READER_CODE_CHARS - 1; i >= 0; i--) s += ALPHABET[Number((v >> BigInt(i * 5)) & 31n)];
  return s.match(/.{4}/g)!.join("-");
}

/** The reader id a code-protected link is bound to: Poseidon(5, nameHash, Poseidon(code)). */
export const codeBoundReaderIdHash = (nameHash: bigint, code: bigint): bigint => poseidon3([READER_CODE_TAG, nameHash, poseidon1([code])]);
