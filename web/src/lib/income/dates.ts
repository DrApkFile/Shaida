// Calendar dates in the browser's time zone ↔ unix seconds (D27: a period runs from 00:00 of its first day to
// 23:59:59 of its last; an expiry is the end of its day).
const parts = (iso: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export function startOfDay(iso: string): bigint | null {
  const p = parts(iso);
  return p ? BigInt(Math.floor(new Date(p[0], p[1] - 1, p[2], 0, 0, 0).getTime() / 1000)) : null;
}

export function endOfDay(iso: string): bigint | null {
  const p = parts(iso);
  return p ? BigInt(Math.floor(new Date(p[0], p[1] - 1, p[2], 23, 59, 59).getTime() / 1000)) : null;
}

/** "YYYY-MM-DD" of a unix time (or of now + days) in the browser's time zone. */
export function isoDate(unix: bigint | number): string {
  const d = new Date(Number(unix) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const isoInDays = (days: number): string => isoDate(Math.floor(Date.now() / 1000) + days * 86_400);
