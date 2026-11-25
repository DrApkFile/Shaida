// checkOnChain: IncomeVerifier.check(proof, signals) for each proof of a link, as an eth_call with an explicit gas
// limit (snarkjs verifiers return false when short of gas, so an estimate is not enough; the contract also refuses
// below its own minimum). The contract checks the asset, that the root is known, and Groth16; it does NOT check the
// reader, the expiry, bundle rules or dates: verifyIncomeLink does all of PRD §5. View call: nothing is sent.
import { decodeFragment, incomeLinkSchema, solidityArgsOf } from "@shaida/proofs";
import { fragmentOf } from "../../shaida-underwrite/src/fragment";
import { SELECTORS } from "./ledger";
import { hexOf, RpcError, word } from "./rpc";
import { sessionOf, WrongChain } from "./session";
import type { OnChainCheck, ReadOptions } from "./types";

export const CHECK_GAS = 400_000n;
const REVERTS: Readonly<Record<string, "ProofInvalid" | "AssetMismatch" | "UnknownRoot">> = {
  "0x7fcdd1f4": "ProofInvalid",
  "0x6de70b6b": "AssetMismatch",
  "0x8730d7c8": "UnknownRoot",
};

const inconclusive = (code: "ChainUnreachable" | "NotConfigured", message: string, nextAction: string): OnChainCheck => ({ status: "INCONCLUSIVE", code, message, nextAction });

export async function checkOnChain(link: string, o: ReadOptions): Promise<OnChainCheck> {
  const s = sessionOf(o);
  if (!s.ok) return inconclusive("NotConfigured", `${s.why}. Nothing was checked.`, "use the bundled network, or fix the custom one");
  const d = decodeFragment(fragmentOf(link));
  const parsed = d.ok ? incomeLinkSchema.safeParse(d.json) : null;
  if (!parsed?.success) return { status: "REJECTED", proof: null, code: "ProofInvalid", message: "The link is malformed, so there is no proof to send to the contract. Nothing was checked.", block: null };
  let block: bigint;
  try {
    block = (await s.value.ledger()).block;
  } catch (e) {
    if (e instanceof WrongChain) return inconclusive("NotConfigured", `${e.message}. Nothing was checked.`, "point rpcUrl at this network");
    return inconclusive("ChainUnreachable", `The chain could not be read (${e instanceof Error ? e.message : String(e)}). Nothing was checked.`, "try again shortly");
  }
  for (const [k, p] of parsed.data.proofs.entries()) {
    const { proof, signals } = solidityArgsOf(p.proof, p.publicSignals);
    const data = SELECTORS.check + [proof.a[0], proof.a[1], proof.b[0][0], proof.b[0][1], proof.b[1][0], proof.b[1][1], proof.c[0], proof.c[1], ...signals].map(word).join("");
    let out: string;
    try {
      out = await s.value.rpc.call<string>("eth_call", [{ to: s.value.net.incomeVerifier, data, gas: hexOf(CHECK_GAS) }, hexOf(block)]);
    } catch (e) {
      const named = e instanceof RpcError && e.revertData ? REVERTS[e.revertData.slice(0, 10)] : undefined;
      if (named) return { status: "REJECTED", proof: k + 1, code: named, message: `IncomeVerifier.check refused proof ${k + 1} with ${named}. Nothing was sent.`, block };
      return inconclusive("ChainUnreachable", `IncomeVerifier.check could not be read for proof ${k + 1} (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`, "try again shortly");
    }
    if (BigInt(out) !== 1n) return inconclusive("ChainUnreachable", `IncomeVerifier.check returned ${out} for proof ${k + 1}, neither true nor a named revert. Nothing was sent.`, "try again shortly");
  }
  return { status: "ACCEPTED", proofs: parsed.data.proofs.length, block };
}
