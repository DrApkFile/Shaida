// underwrite: the bot's deterministic decision engine (packages/shaida-underwrite, D30) run in the caller's process:
// PRD §5 for the policy's reader, then the policy's six rules. Same link + same policy → same decisionId. No LLM,
// nothing recorded, nothing sent.
import { chainUnreachable, LedgerNotReadable, underwrite as decide } from "../../shaida-underwrite/src/decide";
import { fragmentOf } from "../../shaida-underwrite/src/fragment";
import { policyOf, policySchema, PolicyConfigError } from "../../shaida-underwrite/src/policy";
import { presetById } from "../../shaida-underwrite/src/presets";
import { groth16Verify } from "./groth16";
import { ReadFailed, sessionOf, ShaidaConfigError, WrongChain } from "./session";
import type { Decision, Policy, PolicyInput, ReadOptions } from "./types";

const preset = (id: string): Policy => {
  const p = presetById(id);
  if (!p) throw new Error(`preset ${id} is missing from config/underwrite-policies.json`);
  return p;
};

/** rent-check@1: a landlord's check (the policy the live bot serves under the same name). */
export const RENT_CHECK: Policy = preset("rent-check");
/** revenue-credit@1: a lender's revenue-based credit check. */
export const REVENUE_CREDIT: Policy = preset("revenue-credit");

/** A policy of your own (your reader name, your limits), strictly validated. Pure; never throws. */
export function definePolicy(input: PolicyInput): { readonly ok: true; readonly policy: Policy } | { readonly ok: false; readonly code: "InputRejected"; readonly message: string } {
  const r = policySchema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, code: "InputRejected", message: `The policy is not valid at ${issue?.path.join(".") || "its root"}: ${issue?.message ?? "invalid"}. Nothing was decided.` };
  }
  try {
    return { ok: true, policy: policyOf(r.data) };
  } catch (e) {
    if (!(e instanceof PolicyConfigError)) throw e;
    return { ok: false, code: "InputRejected", message: `${e.message}. Nothing was decided.` };
  }
}

export interface UnderwriteOptions extends ReadOptions {
  /** Unix seconds. Default: the system clock. */
  readonly now?: () => bigint;
}

const notReadable = (e: unknown): never => {
  if (e instanceof LedgerNotReadable) throw e;
  if (e instanceof WrongChain) throw e;
  throw chainUnreachable(e instanceof ReadFailed ? e.what : "the ledger", e);
};

/** Decides APPROVE / DECLINE / INCONCLUSIVE for a link under a policy. Throws ShaidaConfigError only for a bad setup. */
export async function underwrite(link: string, policy: Policy, o: UnderwriteOptions): Promise<Decision> {
  const s = sessionOf(o);
  if (!s.ok) throw new ShaidaConfigError(`${s.why}. Nothing was decided.`);
  const { read } = s.value;
  const guard = <T>(f: () => Promise<T>) => f().catch(notReadable);
  try {
    return await decide(fragmentOf(link), policy, {
      now: o.now ?? (() => BigInt(Math.floor(Date.now() / 1000))),
      isKnownRoot: (root) => guard(() => read("ShaidaLedger.isKnownRoot", (l) => l.isKnownRoot(root))),
      verifyGroth16: groth16Verify,
      resolveRange: (from, to) => guard(() => read("ShaidaLedger leaf dates", (l) => l.datesForRange(from, to))),
      rootTime: (root) => guard(() => read("ShaidaLedger root time", (l) => l.rootTime(root))),
    });
  } catch (e) {
    if (e instanceof WrongChain) throw new ShaidaConfigError(`${e.message}. Nothing was decided.`);
    throw e;
  }
}

