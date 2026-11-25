// Proof templates (D31): wording and a suggested reader for who the proof is for. Presentation only: the circuit,
// the link and the VALID facts are the same for every template, and the template rides in the URL's query (?for=),
// outside the proof, so nothing about it is proven (LIMITS.md).
import { PRESETS } from "@shaida/underwrite";

export const TEMPLATE_IDS = ["income", "merchant", "grantee"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface Template {
  readonly id: TemplateId;
  /** The choice on /app/prove. */
  readonly label: string;
  readonly forWhom: string;
  /** "payment" in the reader's words. */
  readonly paymentWord: string;
  readonly readerPlaceholder: string;
  /** A reader name to offer on /app/prove, with why. Demo names are labelled demo. */
  readonly suggestedReader: { readonly name: string; readonly why: string } | null;
  readonly verifyTitle: string;
  readonly verifyLede: string;
  /** A bot preset to point the reader at after VALID. */
  readonly botPreset: string | null;
}

/** One bot, one reader name for both presets (config/underwrite-policies.json). */
const BOT_READER = PRESETS[0]!.readerName;

export const TEMPLATES: Record<TemplateId, Template> = {
  income: {
    id: "income", label: "Income, for a landlord", forWhom: "Freelancers and anyone renting",
    paymentWord: "payment", readerPlaceholder: "Landlord Bola", suggestedReader: null,
    verifyTitle: "Check an income proof",
    verifyLede: "Someone sent you this link to show they earn at least an amount. You see that amount, how many payments and the dates, not the single amounts. The public ledger also shows which registered payers paid in those dates.",
    botPreset: null,
  },
  merchant: {
    id: "merchant", label: "Revenue proof, for a lender", forWhom: "Merchants",
    paymentWord: "customer payment", readerPlaceholder: "Acme Lending", suggestedReader: { name: BOT_READER, why: "the demo lender's bot: it can decide on this link under its revenue-credit policy" },
    verifyTitle: "Check a revenue proof",
    verifyLede: "A merchant sent you this link to show revenue of at least an amount from customer payments. You see that amount, how many payments and the dates, not the single amounts. The public ledger also shows which registered payers paid in those dates.",
    botPreset: "revenue-credit",
  },
  grantee: {
    id: "grantee", label: "Disbursements, for a donor or sponsor", forWhom: "Grantees",
    paymentWord: "disbursement", readerPlaceholder: "Sponsor Chidi (demo)", suggestedReader: null,
    verifyTitle: "Check disbursements received",
    verifyLede: "A grantee sent you this link to show they received at least an amount in disbursements from registered payers. You see that amount, how many disbursements and the dates, not the single amounts. The public ledger also shows which registered payers paid in those dates.",
    botPreset: null,
  },
};

/** The template named by ?for=…; no or an unknown value shows the plain income wording (the facts are the same). */
export const templateOf = (raw: string | null | undefined): Template =>
  (TEMPLATE_IDS as readonly string[]).includes(raw ?? "") ? TEMPLATES[raw as TemplateId] : TEMPLATES.income;

/** The reader's link for a fragment: /v#… for income, /v?for=<id>#… otherwise. */
export const verifyPath = (template: TemplateId, fragment: string): string => `/v${template === "income" ? "" : `?for=${template}`}#${fragment}`;

export const plural = (n: bigint | number, word: string): string => `${n} ${word}${BigInt(n) === 1n ? "" : "s"}`;
