// Revocations.revokedAt(salt) at one pinned block, and that revocation's block time (D35, PRD §5 step 5a). Used by the
// verify page and the underwriting bot. A read that fails is `unreadable` (INCONCLUSIVE in the core), never "none".
import { parseAbi, type Address, type PublicClient } from "viem";
import type { RevocationState } from "@shaida/proofs";

export const revocationsReadAbi = parseAbi(["function revokedAt(uint256 salt) view returns (uint256)"]);

export async function revocationAt(client: PublicClient, revocations: Address, salt: bigint, block: bigint): Promise<RevocationState> {
  let at: bigint;
  try {
    at = await client.readContract({ address: revocations, abi: revocationsReadAbi, functionName: "revokedAt", args: [salt], blockNumber: block });
  } catch (e) {
    return { state: "unreadable", code: "ChainUnreachable", message: `Revocations.revokedAt at block ${block}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  }
  if (at === 0n) return { state: "none" };
  if (at > block) return { state: "unreadable", code: "ChainUnreachable", message: `Revocations answered block ${at}, after the pinned block ${block}` };
  try {
    return { state: "revoked", block: at, time: (await client.getBlock({ blockNumber: at })).timestamp };
  } catch (e) {
    return { state: "unreadable", code: "ChainUnreachable", message: `the time of block ${at}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  }
}
