// What a sealed memo's bytes show without the receive key. Ticket format (Gloam SDK receiveTag.ts, MIT):
//   gloam2t.<base64url( ephemLen (2 bytes) | ephemeral P-256 SPKI | iv (12) | AES-GCM(padded plaintext) )>
// A part that repeated across memos to one recipient (and not to others) would link them; this measures it.
import { hexToString } from "viem";

const b64urlBytes = (s) => Uint8Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

export function memoShape(memos) {
  const tickets = memos.map((m) => {
    const text = hexToString(m.memo).trim();
    if (!text.startsWith("gloam2t.")) return { memo: m.hash, format: "not a gloam2t ticket", length: m.memoLength };
    const bytes = b64urlBytes(text.slice(8));
    const ephemLen = (bytes[0] << 8) | bytes[1];
    return { memo: m.hash, format: "gloam2t", length: m.memoLength, bytes, ephem: Buffer.from(bytes.subarray(2, 2 + ephemLen)).toString("hex"), iv: Buffer.from(bytes.subarray(2 + ephemLen, 14 + ephemLen)).toString("hex") };
  });
  const sealed = tickets.filter((t) => t.format === "gloam2t");
  let common = 0;
  if (sealed.length > 1) {
    const first = sealed[0].bytes;
    while (common < first.length && sealed.every((t) => t.bytes[common] === first[common])) common++;
  }
  return {
    count: memos.length,
    lengths: [...new Set(tickets.map((t) => t.length))],
    commonPrefixBytes: common,
    // 2 length bytes + the 26-byte DER header every P-256 SPKI starts with + 0x04 (uncompressed point) = 29.
    constantHeaderBytes: 29,
    distinctEphemeralKeys: new Set(sealed.map((t) => t.ephem)).size,
    distinctIvs: new Set(sealed.map((t) => t.iv)).size,
    notTickets: tickets.filter((t) => t.format !== "gloam2t").map((t) => t.memo),
  };
}
