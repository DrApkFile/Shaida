// What kind of link this is (D35, D36): its version, how the reader is checked, and whether it can be revoked. The
// verify page reads it before verifying, only to decide which fields to ask for; it is the link's own claim, and
// verifyIncomeLink alone decides VALID (a relabelled link fails the reader or context check, or its revocation check).
import { decodeFragment, type IncomeLink, incomeLinkSchema } from "./link";

export interface LinkKind {
  readonly version: 1 | 2;
  /** "code": the reader's name and code were both checked. "name": the name only. */
  readonly readerMode: "name" | "code";
  /** v2 links can be revoked by their holder; v1 links were made before revocation existed. */
  readonly revocable: boolean;
}

export const linkKindOf = (link: IncomeLink): LinkKind =>
  link.v === 1 ? { version: 1, readerMode: "name", revocable: false } : { version: 2, readerMode: link.reader, revocable: true };

/** The kind a fragment claims, or null if it is not a well-formed link (verification then names why). */
export function claimedLinkKind(fragment: string): LinkKind | null {
  const d = decodeFragment(fragment);
  if (!d.ok) return null;
  const p = incomeLinkSchema.safeParse(d.json);
  return p.success ? linkKindOf(p.data) : null;
}
