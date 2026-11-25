// Machine-readable surfaces for agents (D30): /.well-known/agent.json and /llms.txt, built from the same constants the
// handler and engine use (codes, limits, presets, schemas), so they cannot drift from the code. test U19 checks that.
import { ERROR_CODES } from "@shaida/proofs";
import { INCONCLUSIVE_CODES, REFUSAL_CODES, REFUSAL_WORDS, RULE_CODES, RULE_WORDS } from "./codes";
import { MAX_BODY_BYTES, MAX_LINK_CHARS, type UnderwriteLimits } from "./handle";
import type { Policy } from "./policy";
import type { RecorderConfig } from "./record";

export interface CardInput {
  readonly origin: string;
  readonly chainId: number;
  readonly policies: readonly Policy[];
  readonly limits: UnderwriteLimits;
  readonly recorder: RecorderConfig;
  readonly botAddress: string | null;
  readonly repoUrl: string;
}

const decimal = { type: "string", pattern: "^(0|[1-9][0-9]*)$" } as const;
const facts = {
  type: "object",
  additionalProperties: false,
  required: ["threshold", "count", "fromDate", "toDate", "expiry", "rootTime", "periodDays", "proofAgeSeconds", "secondsLeft", "proofs"],
  properties: {
    threshold: { ...decimal, description: "tUSD8 base units (6 decimals): the link proves at least this much" },
    count: decimal, fromDate: { ...decimal, description: "unix seconds" }, toDate: decimal, expiry: decimal,
    rootTime: { ...decimal, description: "block time of the ledger leaf that formed the proof's root" },
    periodDays: decimal, proofAgeSeconds: decimal, secondsLeft: { type: "string", pattern: "^-?(0|[1-9][0-9]*)$" },
    proofs: { type: "integer", minimum: 1, maximum: 8 },
  },
} as const;

export function agentCard(c: CardInput) {
  const errorCode = { type: "string", enum: Object.keys(ERROR_CODES) };
  return {
    schema: "shaida-agent-card/1",
    name: "Shaida underwriting bot (demo)",
    description:
      "Decides APPROVE, DECLINE or INCONCLUSIVE on a Shaida income proof link under a fixed, versioned policy. Deterministic rules, no LLM. It runs the full proof verification (strict schema, context opening, reader, expiry, ShaidaLedger.isKnownRoot at a pinned block, Groth16 with the ceremony's final key, dates from ledger events) and only then the policy rules in a fixed order.",
    chain: { id: c.chainId, token: "tUSD8 0x456569838f1d43009A91ebA4263147Afd7233483 (6 decimals)" },
    determinism:
      "The same link and the same policy (id, version, hash) give the same decisionId and decision while no time limit (expiry, proof age, days left) is crossed. INCONCLUSIVE is never an approval and is not cached: ask again.",
    sees:
      "Only what is in the link: up to 8 Groth16 proofs with their 7 public signals (ledger root, asset, threshold, count, leaf range, context) and the context opening (reader id hash, expiry, salt). No payer, no amount per payment, no address, no note secret. The bot logs decision and proof ids and codes, never the link; it stores a hash of each proof it records on chain, and the rate limit keeps request times per IP for two minutes.",
    readerBinding:
      "A link must be made out to the policy's readerName. A name binds intent, not identity: anyone holding the link can submit it (LIMITS.md).",
    endpoints: [
      {
        method: "GET",
        url: `${c.origin}/api/underwrite`,
        description: "Presets, recording switch, caps and the bot's address.",
      },
      {
        method: "POST",
        url: `${c.origin}/api/underwrite`,
        contentType: "application/json",
        maxBodyBytes: MAX_BODY_BYTES,
        rateLimit: { perIpPerMinute: c.limits.perIpPerMinute, window: "sliding 60 s, counted before the body is read", refusal: "429 RateLimited" },
        request: {
          type: "object",
          additionalProperties: false,
          required: ["link", "preset"],
          properties: {
            link: { type: "string", minLength: 1, maxLength: MAX_LINK_CHARS, description: "the proof link (https://…/v#…) or its fragment" },
            preset: { type: "string", enum: c.policies.map((p) => p.id) },
            record: { type: "boolean", default: false, description: "also record an APPROVE on chain with IncomeVerifier.attest from the bot's key" },
          },
        },
        response: {
          "200": {
            type: "object",
            required: ["decision", "record"],
            properties: {
              decision: {
                oneOf: [
                  { required: ["kind", "decisionId", "proofId", "policy", "evaluatedAt", "facts"], properties: { kind: { const: "APPROVE" }, facts } },
                  { required: ["kind", "decisionId", "proofId", "policy", "evaluatedAt", "reasons", "facts"], properties: { kind: { const: "DECLINE" }, reasons: { type: "array", minItems: 1, items: { type: "object", required: ["code", "message"], properties: { code: { enum: [...REFUSAL_CODES, ...RULE_CODES] }, message: { type: "string" } } } }, facts: { oneOf: [facts, { type: "null" }] } } },
                  { required: ["kind", "decisionId", "proofId", "policy", "evaluatedAt", "error"], properties: { kind: { const: "INCONCLUSIVE" }, error: { type: "object", properties: { code: { enum: [...INCONCLUSIVE_CODES] } } } } },
                ],
              },
              record: { description: "null unless record was true: {ok, repeated, records} or {ok:false, error, records}" },
            },
          },
          "400 | 413 | 429": { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "retryable", "nextAction"], properties: { code: errorCode } } } },
        },
      },
    ],
    decisionCodes: {
      decline: [...REFUSAL_CODES.map((code) => ({ code, kind: "verification", means: REFUSAL_WORDS[code] })), ...RULE_CODES.map((code) => ({ code, kind: "policy rule", means: RULE_WORDS[code] }))],
      inconclusive: INCONCLUSIVE_CODES.map((code) => ({ code, means: ERROR_CODES[code].nextAction })),
      ruleOrder: [...RULE_CODES],
    },
    errorCodes: Object.entries(ERROR_CODES).map(([code, s]) => ({ code, retryable: s.retryable, nextAction: s.nextAction })),
    presets: c.policies.map((p) => ({
      id: p.id, version: p.version, hash: p.hash, title: p.title, audience: p.audience, readerName: p.readerName,
      minThreshold: p.minThreshold.toString(), minPayments: p.minPayments, minPeriodDays: p.minPeriodDays, maxPeriodDays: p.maxPeriodDays,
      maxProofAgeDays: p.maxProofAgeDays, minDaysLeft: p.minDaysLeft,
    })),
    recording: {
      enabled: c.recorder.enabled,
      bot: c.botAddress,
      what: "IncomeVerifier.attest for each proof of an APPROVED link: a public IncomeProofChecked(context, threshold, count) event. Never for a DECLINE or INCONCLUSIVE.",
      caps: { recordsPerUtcDay: c.recorder.dailyCount, gasPerUtcDay: c.recorder.dailyGas.toString(), gasPerRecord: "420000" },
      oncePerProof: true,
    },
    source: c.repoUrl,
  };
}

export type AgentCard = ReturnType<typeof agentCard>;

export function llmsTxt(c: CardInput): string {
  const card = agentCard(c);
  const lines = [
    "# Shaida",
    "",
    "> Private income proofs on Aevum testnet (chain 44005, tUSD8). A recipient proves \"at least X received from N payments by registered payers, in a period\" to one named reader, with an expiry. Which registered payer paid is public by design (see Shaida's privacy audit).",
    "",
    "Testnet only. Not audited. Demo personas and the demo bot are labelled demo.",
    "",
    "## Underwriting bot (deterministic, no LLM)",
    "",
    `- Agent card (JSON, with request and response schemas): ${c.origin}/.well-known/agent.json`,
    `- POST ${c.origin}/api/underwrite with {"link": "<proof link or fragment>", "preset": "<id>", "record": false}; body ≤ ${MAX_BODY_BYTES} bytes, ${c.limits.perIpPerMinute} requests per IP per minute (429 RateLimited).`,
    `- GET ${c.origin}/api/underwrite: presets, recording switch, caps, bot address.`,
    "- Answer: decision.kind APPROVE (every rule holds), DECLINE (reasons: closed codes, all that apply), or INCONCLUSIVE (chain or ledger not readable yet: never an approval; ask again).",
    `- Rules, in order: ${RULE_CODES.join(", ")}. Verification refusals (DECLINE): ${REFUSAL_CODES.join(", ")}. INCONCLUSIVE: ${INCONCLUSIVE_CODES.join(", ")}.`,
    `- ${card.determinism}`,
    `- ${card.sees}`,
    `- ${card.readerBinding}`,
    `- Recording (${c.recorder.enabled ? "on" : "off"}): ${card.recording.what} At most ${c.recorder.dailyCount} records and ${c.recorder.dailyGas} gas per UTC day; once per proof.`,
    "",
    "## Presets",
    "",
    ...c.policies.map((p) => `- ${p.id}@${p.version} "${p.title}": reader "${p.readerName}", at least ${p.minThreshold} base units, ≥ ${p.minPayments} payments, period ${p.minPeriodDays}–${p.maxPeriodDays} days, proof age ≤ ${p.maxProofAgeDays} days, ≥ ${p.minDaysLeft} days left.`),
    "",
    "## Pages",
    "",
    `- ${c.origin}/v#<payload>: verify a proof link in the browser (the fragment never reaches the server).`,
    `- ${c.origin}/underwrite: the bot's page.`,
    `- Source, limits and claims: ${c.repoUrl} (LIMITS.md, CLAIMS.md, DECISIONS.md D30).`,
    "",
  ];
  return lines.join("\n");
}
