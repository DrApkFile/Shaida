// PRD §5 step 5a over the session (0.2.0, D35): Revocations.revokedAt(salt) at the pinned block. A network with no
// registry is NotConfigured (INCONCLUSIVE in the core, never "not revoked"). A failed read throws ReadFailed, like
// every other chain read, so each caller maps it exactly as before (verify: INCONCLUSIVE ChainUnreachable,
// "Nothing was verified or recorded"; underwrite: its chainUnreachable). A wrong chain stays a WrongChain.
import type { RevocationState } from "@shaida/proofs";
import type { Session } from "./session";

export const revocationOf = (s: Session, guard: <T>(f: () => Promise<T>) => Promise<T> = (f) => f()) => async (salt: bigint): Promise<RevocationState> => {
  if (s.net.revocations === null) return { state: "unreadable", code: "NotConfigured", message: `network ${s.net.name} has no Revocations registry in this SDK build, so revocation can't be checked` };
  const r = await guard(() => s.read("Revocations.revokedAt", (l) => l.revokedAt(salt)));
  return r === null ? { state: "none" } : { state: "revoked", block: r.block, time: r.time };
};
