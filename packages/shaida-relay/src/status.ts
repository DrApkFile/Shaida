// GET /api/relay/status?id=…: settles a record by its hash. The only ways out of pending/unknown are a receipt
// (mined) or the relayer's nonce having moved past it with no receipt for this hash (dropped). Nothing resends.
import { shaidaError } from "@shaida/proofs";
import { isNetwork, type RelayDeps } from "./deps";
import { moveTo } from "./submit";
import type { RelayReply, RequestRecord } from "./types";

/** A record still `accepted` after this long was persisted but its send never reported back (a crash). */
export const ACCEPTED_STALE_MS = 30_000;

export async function status(requestId: string, deps: RelayDeps): Promise<RelayReply> {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) {
    return { ok: false, status: 400, error: shaidaError("InputRejected", "Malformed request id. Nothing was read.") };
  }
  const record = await deps.store.record(requestId);
  if (!record) return { ok: false, status: 404, error: shaidaError("InputRejected", "No relayed request has this id.") };
  if (record.state === "mined" || record.state === "dropped") return { ok: true, status: 200, record, repeated: true };

  const net = deps.network(record.chainId);
  if (!isNetwork(net)) return { ok: true, status: 200, record, repeated: true };
  let next: RequestRecord = record;
  try {
    // Nonce BEFORE receipt: if the nonce had already moved past ours and a receipt read made after that still finds
    // nothing, the nonce went to another tx and ours can never land. Read the other way round, a block landing
    // between the two reads makes a mined tx look dropped (seen on the fork, 2026-11-21: R17).
    const nonceBefore = await net.chain.nonce(net.signer.address, "latest");
    const receipt = await net.chain.receipt(record.hash);
    if (receipt) {
      const reverted = receipt.status === "reverted";
      next = await moveTo(deps, record, "mined", reverted ? shaidaError("TxRejected", "The transaction was mined but reverted: its gas was spent, nothing else changed.") : null, {
        gasUsed: receipt.gasUsed.toString(),
        block: receipt.blockNumber.toString(),
        reverted,
      });
    } else if (nonceBefore > record.nonce) {
      next = await moveTo(deps, record, "dropped", shaidaError("TxRejected", "This transaction never landed: the relayer's nonce was used by another transaction. Nothing changed; you may submit again."));
    } else if (record.state === "accepted" && deps.nowMs() - Date.parse(record.history[0]?.at ?? "") > ACCEPTED_STALE_MS) {
      next = await moveTo(deps, record, "unknown", shaidaError("TxOutcomeUnknown", "The relayer stopped before it heard back from the node. It is checked by its hash and never sent again."));
    }
  } catch (e) {
    deps.log({ event: "relay-status-read-failed", id: requestId, error: e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e) });
  }
  return { ok: true, status: 200, record: next, repeated: true };
}
