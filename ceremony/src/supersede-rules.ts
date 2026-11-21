// Pure rules for which zkey a contribution may start from, and which verified zkey may be superseded.
// Superseding never deletes: the entry and its verify log stay in the record, marked with the reason.
import { type CeremonyRecord, latestZkeySha } from "./record.js";

/** Why a contribution must not start from the zkey with this sha256, or null. */
export function cannotContributeTo(r: CeremonyRecord, inSha: string): string | null {
  const latest = latestZkeySha(r);
  if (inSha === latest) return null;
  const entry = r.verified.find((v) => v.zkey.sha256 === inSha);
  if (entry?.superseded) return `input ${inSha} was superseded (${entry.superseded.reason}); start from ${latest}.`;
  if (entry || inSha === r.setup.zkey.sha256) return `input is not the latest zkey (${latest}); contributing to it would fork the chain.`;
  return `input sha256 ${inSha} is neither the setup nor a verified zkey in the record. Verify it first, or pass --in-sha256.`;
}

/** Why the verified zkey with this sha256 must not be superseded now, or null. */
export function cannotSupersede(r: CeremonyRecord, sha: string): string | null {
  if (r.beaconAnnouncement !== null) return "the beacon is announced: the chain of contributions is closed.";
  const entry = r.verified.find((v) => v.zkey.sha256 === sha);
  if (!entry) return `no verified zkey with sha256 ${sha} in the record.`;
  if (entry.superseded) return `zkey ${sha} is already superseded (${entry.superseded.at}).`;
  if (latestZkeySha(r) !== sha) return `zkey ${sha} is not the latest active zkey; supersede the later ones first (latest: ${latestZkeySha(r)}).`;
  return null;
}
