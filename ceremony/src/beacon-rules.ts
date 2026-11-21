// Pure rules for the beacon: which block to announce, and whether an announced block may be used. The beacon only
// helps if nobody could know its hash when the last contribution was made, so its number is fixed in a pushed
// commit before the block exists, and applied only once the block is mined and buried.
import { BEACON_CONFIRMATIONS, BEACON_DELAY_HOURS, BLOCK_SECONDS, MIN_CONTRIBUTIONS } from "./config.js";
import type { Announcement, CeremonyRecord } from "./record.js";
import { humanContributions, lastVerified } from "./record.js";

export interface Head {
  readonly number: number;
  readonly timestamp: number;
}

/** The block ~`hours` after `head`, at the measured block time. */
export function pickBeaconBlock(head: Head, hours: number = BEACON_DELAY_HOURS, blockSeconds: number = BLOCK_SECONDS) {
  const blocks = Math.ceil((hours * 3600) / blockSeconds);
  return { blockNumber: head.number + blocks, expectedTimestamp: head.timestamp + Math.round(blocks * blockSeconds) };
}

/** Why the beacon cannot be announced now, or null. */
export function cannotAnnounce(r: CeremonyRecord): string | null {
  if (r.beaconAnnouncement !== null) return `block ${r.beaconAnnouncement.blockNumber} is already announced; an announcement is never changed.`;
  const v = lastVerified(r);
  if (v === null) return "no verified zkey yet: run verify on the last contribution first.";
  if (v.contributions.some((c) => c.beacon !== null)) return "the last verified zkey already has a beacon.";
  const n = humanContributions(v).length;
  if (n < MIN_CONTRIBUTIONS) return `the last verified zkey has ${n} contribution(s); the ceremony needs ${MIN_CONTRIBUTIONS} before the beacon.`;
  return null;
}

export type BeaconReadiness =
  | { readonly kind: "ready" }
  | { readonly kind: "wait"; readonly why: string }
  | { readonly kind: "refuse"; readonly why: string };

/**
 * May the announced block be used now? `block` is null when not mined yet. `commitTime` is when the announcement
 * was first committed (unix seconds), null in a dry run.
 */
export function beaconReadiness(
  a: Announcement,
  head: Head,
  block: { readonly timestamp: number } | null,
  commitTime: number | null,
  confirmations: number = BEACON_CONFIRMATIONS,
): BeaconReadiness {
  if (block === null || head.number < a.blockNumber) {
    const left = a.blockNumber - head.number;
    return { kind: "wait", why: `block ${a.blockNumber} is not mined yet (head ${head.number}, ~${Math.ceil((left * BLOCK_SECONDS) / 60)} min left).` };
  }
  if (head.number < a.blockNumber + confirmations) {
    return { kind: "wait", why: `block ${a.blockNumber} has ${head.number - a.blockNumber} of ${confirmations} confirmations.` };
  }
  if (commitTime !== null && commitTime >= block.timestamp) {
    return { kind: "refuse", why: `the announcement was committed at ${commitTime}, not before block ${a.blockNumber} (timestamp ${block.timestamp}).` };
  }
  return { kind: "ready" };
}
