// Parses the info lines of snarkjs 0.7.6 `zkey verify` (src/zkey_verify_frominit.js): the circuit hash, then per
// contribution a "contribution #n name:" title with its hash as 4 lines of 4 hex words, and for a beacon the
// generator and iterations (newest contribution first), then "ZKey Ok!". Pure, so it is unit-tested on fixed logs.
import type { Contribution } from "./record.js";

export interface ParsedVerifyLog {
  readonly circuitHash: string;
  readonly contributions: Contribution[];
}

type Parsed = { readonly ok: true; readonly value: ParsedVerifyLog } | { readonly ok: false; readonly why: string };

const HASH_LINE = /^\s*([0-9a-f]{8}) ([0-9a-f]{8}) ([0-9a-f]{8}) ([0-9a-f]{8})\s*$/;

/** Joins a title line followed by 4 hash lines (snarkjs formatHash) into 128 hex chars. */
function hashAfter(lines: readonly string[], titleAt: number): string | null {
  const words: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const m = HASH_LINE.exec(lines[titleAt + i] ?? "");
    if (!m) return null;
    words.push(m[1]!, m[2]!, m[3]!, m[4]!);
  }
  return words.join("");
}

/** `lines` are CapturingLogger lines ("[INFO] ...", one logger message may span several lines). */
export function parseVerifyLog(captured: readonly string[]): Parsed {
  const info = captured.filter((l) => l.startsWith("[INFO] ")).flatMap((l) => l.slice(7).split("\n"));
  if (info.at(-1) !== "ZKey Ok!") return { ok: false, why: 'the verify log does not end with "ZKey Ok!"' };

  const circuitAt = info.indexOf("Circuit Hash: ");
  const circuitHash = circuitAt >= 0 ? hashAfter(info, circuitAt) : null;
  if (circuitHash === null) return { ok: false, why: "no circuit hash in the verify log" };

  const contributions: Contribution[] = [];
  for (let i = 0; i < info.length; i++) {
    const title = /^contribution #(\d+) ?(.*):$/.exec(info[i]!);
    if (!title) continue;
    const hash = hashAfter(info, i);
    if (hash === null) return { ok: false, why: `contribution #${title[1]} has no readable hash` };
    const gen = /^Beacon generator: ([0-9a-f]+)$/.exec(info[i + 5] ?? "");
    const exp = /^Beacon iterations Exp: (\d+)$/.exec(info[i + 6] ?? "");
    contributions.push({
      n: Number(title[1]),
      name: title[2] ?? "",
      hash,
      beacon: gen && exp ? { value: gen[1]!, iterationsExp: Number(exp[1]) } : null,
    });
  }
  // snarkjs prints the newest contribution first
  contributions.sort((x, y) => x.n - y.n);
  if (contributions.some((c, k) => c.n !== k + 1)) return { ok: false, why: "contributions are not numbered 1..n" };
  return { ok: true, value: { circuitHash, contributions } };
}
