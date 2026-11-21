// Every flow error shown to a user: the closed code, what happened, and whether anything changed.
import { ERROR_CODES, type ErrorCode } from "@shaida/proofs";

export interface Problem {
  readonly code: string;
  readonly message: string;
  readonly nextAction?: string;
}

const isCode = (c: string): c is ErrorCode => c in ERROR_CODES;

/** A thrown error from a wallet or a prover: named, never swallowed. */
export function problemOf(e: unknown, during: string): Problem {
  const message = e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e);
  if (/user rejected|denied|cancel/i.test(message)) return { code: "SignatureInvalid", message: `You cancelled the signature while ${during}. Nothing was sent.` };
  return { code: "TxRejected", message: `Something failed while ${during}: ${message}. Nothing was sent by this step.` };
}

export const codeLabel = (code: string) => (isCode(code) ? code : `Error (${code})`);
