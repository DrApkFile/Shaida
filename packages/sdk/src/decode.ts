// decodeIncomeLink: the link's payload under the strict schema, for display before verifying. Not a verification.
import { decodeFragment, incomeLinkSchema, PUBLIC_SIGNAL_ORDER } from "@shaida/proofs";
import { fragmentOf } from "../../shaida-underwrite/src/fragment";
import type { Decoded } from "./types";

const at = (signals: readonly string[], name: (typeof PUBLIC_SIGNAL_ORDER)[number]) => BigInt(signals[PUBLIC_SIGNAL_ORDER.indexOf(name)]!);
const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

/** Accepts a full link (https://…/v#…), "#…" or the bare fragment. Pure: no network. */
export function decodeIncomeLink(link: string): Decoded {
  const d = decodeFragment(fragmentOf(link));
  if (!d.ok) return { ok: false, code: "ProofInvalid", message: `The link is malformed: ${d.why}. Nothing was checked.` };
  const r = incomeLinkSchema.safeParse(d.json);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, code: "ProofInvalid", message: `The link is malformed at ${issue?.path.join(".") || "its root"}: ${issue?.message}. Nothing was checked.` };
  }
  return {
    ok: true,
    link: {
      version: r.data.v,
      readerMode: r.data.v === 1 ? "name" : r.data.reader,
      proofs: r.data.proofs.map((p) => ({
        ledgerRoot: hex32(at(p.publicSignals, "ledgerRoot")),
        asset: `0x${at(p.publicSignals, "asset").toString(16).padStart(40, "0")}`,
        threshold: at(p.publicSignals, "threshold"),
        count: Number(at(p.publicSignals, "count")),
        fromIndex: Number(at(p.publicSignals, "fromIndex")),
        toIndex: Number(at(p.publicSignals, "toIndex")),
        context: hex32(at(p.publicSignals, "context")),
      })),
      readerIdHash: hex32(BigInt(r.data.readerIdHash)),
      expiry: new Date(Number(r.data.expiry) * 1000),
    },
  };
}
