// Underwriting policies (D30): a strict, versioned schema, loaded from config/underwrite-policies.json and validated
// once at startup. A policy names the reader the bot is (links must be made out to it) and six limits.
import { sha256, stringToBytes } from "viem";
import { z } from "zod";
import { MAX_BUNDLE_PROOFS, INCOME_SLOTS, readerIdHashOf, THRESHOLD_LIMIT } from "@shaida/proofs";

export const POLICY_FILE_SCHEMA = "shaida-underwrite-policies/1" as const;
const MAX_PAYMENTS = INCOME_SLOTS * MAX_BUNDLE_PROOFS;
const days = (max: number) => z.number().int().nonnegative().max(max);

export const policySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, "lowercase slug"),
    /** Bump on any change: decisions and records name id@version and the policy's hash. */
    version: z.number().int().positive().max(1_000_000),
    title: z.string().min(1).max(80),
    audience: z.enum(["landlord", "lender", "donor"]),
    /** The reader name links must be made out to (D27 normalisation). Demo bots say so in the name. */
    readerName: z.string().refine((n) => readerIdHashOf(n).ok, "must be a valid reader name (1–96 bytes)"),
    /** tUSD8 base units (6 decimals), a canonical decimal string. */
    minThreshold: z.string().regex(/^(0|[1-9][0-9]{0,20})$/).refine((s) => BigInt(s) < THRESHOLD_LIMIT * BigInt(MAX_BUNDLE_PROOFS)),
    minPayments: z.number().int().min(1).max(MAX_PAYMENTS),
    minPeriodDays: days(3660).min(1),
    maxPeriodDays: days(3660).min(1),
    /** Days since the proof's ledger root was formed (a bound on how long ago the proof could have been built). */
    maxProofAgeDays: days(3660),
    minDaysLeft: days(366),
  })
  .strict()
  .refine((p) => p.minPeriodDays <= p.maxPeriodDays, { message: "minPeriodDays must be <= maxPeriodDays", path: ["maxPeriodDays"] });

export type PolicyInput = z.infer<typeof policySchema>;

export interface Policy extends Omit<PolicyInput, "minThreshold"> {
  readonly minThreshold: bigint;
  readonly readerIdHash: bigint;
  /** sha256 of the policy's canonical JSON: a silent edit without a version bump still changes it. */
  readonly hash: string;
}

const policyFileSchema = z
  .object({ schema: z.literal(POLICY_FILE_SCHEMA), note: z.string().max(400).optional(), policies: z.array(policySchema).min(1).max(20) })
  .strict()
  .refine((f) => new Set(f.policies.map((p) => p.id)).size === f.policies.length, { message: "policy ids must be unique", path: ["policies"] });

const canonical = (p: PolicyInput): string =>
  JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1))));

export function policyOf(input: PolicyInput): Policy {
  const reader = readerIdHashOf(input.readerName);
  if (!reader.ok) throw new PolicyConfigError(`policy ${input.id}: ${reader.error.message}`);
  return { ...input, minThreshold: BigInt(input.minThreshold), readerIdHash: reader.value, hash: sha256(stringToBytes(canonical(input))).slice(2) };
}

/** The config refused at startup: the server exits rather than serve decisions from an unchecked policy. */
export class PolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyConfigError";
  }
}

/** Parses the whole policy file; throws PolicyConfigError naming the first problem. */
export function parsePolicies(raw: unknown): readonly Policy[] {
  const r = policyFileSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new PolicyConfigError(`config/underwrite-policies.json: ${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}`);
  }
  return r.data.policies.map(policyOf);
}

export const policyLabel = (p: Pick<Policy, "id" | "version">): string => `${p.id}@${p.version}`;
