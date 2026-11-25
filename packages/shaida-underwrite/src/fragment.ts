// The proof part of a link (D30): what the bot and the SDK verify. Pure.

/** The fragment of a link: the part after the first "#", or the whole string when there is no "#". */
export function fragmentOf(link: string): string {
  const trimmed = link.trim();
  const at = trimmed.indexOf("#");
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}
