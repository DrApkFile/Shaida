// verifyIncomeLink: PRD §5 in full (packages/shaida-proofs verifyIncomeLink: schema, asset, one context, one root,
// disjoint ranges, context opening, reader (name, or name + code), expiry, revocation, root known on chain, Groth16
// with the pinned final key, dates),
// with the chain reads done here over the caller's RPC. The result is a closed union; nothing is recorded anywhere.
import { parseReaderCode, readerIdHashOf, shaidaError, verifyIncomeLink as verifyCore, type ShaidaError } from "@shaida/proofs";
import { fragmentOf } from "../../shaida-underwrite/src/fragment";
import { decodeIncomeLink } from "./decode";
import { groth16Verify } from "./groth16";
import { revocationOf } from "./revocation";
import { ReadFailed, sessionOf, WrongChain } from "./session";
import type { InconclusiveCode, InvalidCode, Verification, VerifyOptions } from "./types";

const INVALID: readonly string[] = ["ProofInvalid", "AssetMismatch", "MixedContexts", "MixedRoots", "RangesOverlap", "ContextMismatch", "WrongReader", "ProofExpired", "ProofRevoked"] satisfies InvalidCode[];
const INCONCLUSIVE: readonly string[] = ["UnknownRoot", "RangeUnresolvable", "ChainUnreachable", "NotConfigured", "InputRejected"] satisfies InconclusiveCode[];

export const inconclusive = (code: InconclusiveCode, message: string): Verification => {
  const e = shaidaError(code, message);
  return { status: "INCONCLUSIVE", code, message: e.message, nextAction: e.nextAction };
};

function fromCore(e: ShaidaError, status: "INVALID" | "INCONCLUSIVE", revokedAt?: { block: bigint; time: bigint }): Verification {
  if (status === "INVALID" && e.code === "ProofRevoked") {
    if (!revokedAt) throw new Error("ProofRevoked without the revocation's block");
    return { status, code: "ProofRevoked", message: e.message, nextAction: e.nextAction, revokedAt: { block: revokedAt.block, time: new Date(Number(revokedAt.time) * 1000) } };
  }
  if (status === "INVALID" && INVALID.includes(e.code)) return { status, code: e.code as Exclude<InvalidCode, "ProofRevoked">, message: e.message, nextAction: e.nextAction };
  if (status === "INCONCLUSIVE" && INCONCLUSIVE.includes(e.code)) return { status, code: e.code as InconclusiveCode, message: e.message, nextAction: e.nextAction };
  throw new Error(`verifyIncomeLink core returned ${status}(${e.code}), which the SDK does not map`);
}

export async function verifyIncomeLink(link: string, o: VerifyOptions): Promise<Verification> {
  const s = sessionOf(o);
  if (!s.ok) return inconclusive("NotConfigured", `${s.why}. Nothing was verified.`);
  const reader = readerIdHashOf(o.readerName);
  if (!reader.ok) return inconclusive("InputRejected", reader.error.message);
  const code = o.readerCode === undefined ? null : parseReaderCode(o.readerCode);
  if (code && !code.ok) return inconclusive("InputRejected", code.error.message);
  const { read, ledger } = s.value;
  const now = o.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  try {
    const v = await verifyCore(fragmentOf(link), {
      readerIdHash: reader.value,
      readerCode: code ? code.value : null,
      revocation: revocationOf(s.value),
      now,
      isKnownRoot: (root) => read("ShaidaLedger.isKnownRoot", (l) => l.isKnownRoot(root)),
      verifyGroth16: groth16Verify,
      resolveRange: (from, to) => read("ShaidaLedger leaf dates", (l) => l.datesForRange(from, to)),
    });
    if (v.status !== "VALID") return fromCore(v.error, v.status, v.status === "INVALID" ? v.revokedAt : undefined);
    const decoded = decodeIncomeLink(link);
    if (!decoded.ok) throw new Error("a VALID link no longer decodes");
    return {
      status: "VALID",
      threshold: v.threshold,
      count: Number(v.count),
      from: new Date(Number(v.fromDate) * 1000),
      to: new Date(Number(v.toDate) * 1000),
      expiry: new Date(Number(v.expiry) * 1000),
      proofs: v.proofs,
      leafRange: { from: Number(v.fromIndex), to: Number(v.toIndex) },
      ledgerRoot: decoded.link.proofs[0]!.ledgerRoot,
      network: s.value.net.name,
      block: (await ledger()).block,
      link: v.link,
    };
  } catch (e) {
    if (e instanceof WrongChain) return inconclusive("NotConfigured", `${e.message}. Nothing was verified.`);
    if (e instanceof ReadFailed) return inconclusive("ChainUnreachable", `The chain could not be read (${e.message}). Nothing was verified or recorded.`);
    throw e;
  }
}
