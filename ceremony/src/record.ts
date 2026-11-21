// ceremony/record.json: what every ceremony step did, written only by the scripts (BUILD_CONTRACT: evidence is
// generated, never hand-written). Each step reads it, checks the chain of files so far, and appends its own entry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { CeremonyPaths } from "./config.js";
import { renderTranscript } from "./transcript.js";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex");
const hash512 = z.string().regex(/^[0-9a-f]{128}$/, "64-byte hex");
const at = z.string().datetime();
const blockHash = z.string().regex(/^0x[0-9a-f]{64}$/, "0x + 32-byte hex");
const file = z.object({ path: z.string(), sha256 }).strict();

export const contributionSchema = z
  .object({
    n: z.number().int().positive(),
    name: z.string(),
    hash: hash512,
    /** Set on the beacon contribution: the beacon value and iterations exponent stored in the zkey. */
    beacon: z.object({ value: z.string().regex(/^[0-9a-f]+$/), iterationsExp: z.number().int() }).strict().nullable(),
  })
  .strict();

const verifiedSchema = z
  .object({
    zkey: file,
    circuitHash: hash512,
    contributions: z.array(contributionSchema),
    /** Full `zkey verify` output, kept as evidence. */
    log: z.string(),
    at,
  })
  .strict();

const announcementSchema = z
  .object({
    chainId: z.number().int(),
    blockNumber: z.number().int().positive(),
    /** The zkey the beacon will be applied to: the last verified contribution. */
    forZkey: file,
    headAtAnnouncement: z.number().int().positive(),
    headTimestamp: z.number().int().positive(),
    blockSeconds: z.number().positive(),
    expectedTimestamp: z.number().int().positive(),
    at,
  })
  .strict();

const beaconSchema = z
  .object({
    chainId: z.number().int(),
    blockNumber: z.number().int().positive(),
    blockHash,
    blockTimestamp: z.number().int().positive(),
    iterationsExp: z.number().int(),
    /** The commit that first announced the block number, and its committer time (null in a dry run). */
    announcementCommit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), committedAt: z.number().int() }).strict().nullable(),
    in: file,
    out: file,
    contributionHash: hash512,
    at,
  })
  .strict();

const finalSchema = z
  .object({
    zkey: file,
    vkey: file,
    verifier: file,
    /** Runtime size of the compiled verifier (bytes), from forge build --sizes. */
    verifierRuntimeBytes: z.number().int().positive(),
    shanghaiCheck: z.literal("pass"),
    /** One honest sample witness proved with the final zkey and checked with the exported vkey. */
    sampleProof: z.object({ verified: z.literal(true), tamperedRefused: z.literal(true), proveMs: z.number() }).strict(),
    at,
  })
  .strict();

export const recordSchema = z
  .object({
    v: z.literal(1),
    dryRun: z.boolean(),
    snarkjs: z.string(),
    circuit: z.object({ r1cs: z.string(), r1csSha256: sha256 }).strict(),
    ptau: z.object({ name: z.string(), blake2b: hash512 }).strict(),
    setup: z.object({ zkey: file, at }).strict(),
    verified: z.array(verifiedSchema),
    beaconAnnouncement: announcementSchema.nullable(),
    beacon: beaconSchema.nullable(),
    final: finalSchema.nullable(),
  })
  .strict();

export type CeremonyRecord = z.infer<typeof recordSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Verified = z.infer<typeof verifiedSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type BeaconEntry = z.infer<typeof beaconSchema>;
export type FinalEntry = z.infer<typeof finalSchema>;
export type RecordedFile = z.infer<typeof file>;

export function readRecord(paths: CeremonyPaths): CeremonyRecord {
  if (!existsSync(paths.record)) throw new Error(`${paths.record} does not exist: run prepare first.`);
  const record = recordSchema.parse(JSON.parse(readFileSync(paths.record, "utf8")));
  if (record.dryRun !== paths.dryRun) {
    throw new Error(`${paths.record} is ${record.dryRun ? "a dry run" : "the real ceremony"}, but this run is ${paths.dryRun ? "a dry run" : "real"}.`);
  }
  return record;
}

/** Writes record.json and regenerates TRANSCRIPT.md from it. */
export function writeRecord(paths: CeremonyPaths, record: CeremonyRecord): void {
  const checked = recordSchema.parse(record);
  mkdirSync(dirname(paths.record), { recursive: true });
  writeFileSync(paths.record, `${JSON.stringify(checked, null, 2)}\n`);
  writeFileSync(paths.transcript, renderTranscript(checked));
}

/** The latest verified zkey, or null. */
export const lastVerified = (r: CeremonyRecord): Verified | null => r.verified.at(-1) ?? null;

/** Contributions before the beacon. */
export const humanContributions = (v: Verified): Contribution[] => v.contributions.filter((c) => c.beacon === null);
