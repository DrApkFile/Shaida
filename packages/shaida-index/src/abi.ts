import { parseAbi } from "viem";

/** Gloam ShieldPoolPoseidon (contracts/lib/gloam/contracts/src/interfaces/IShieldPool.sol, ShieldPoolCore.sol). */
export const poolAbi = parseAbi([
  "event Shielded(bytes32 indexed commitment, address indexed asset, uint256 amount, uint256 leafIndex, address indexed from)",
  "event Transferred(bytes32 indexed nullifier, bytes32[2] newCommitments)",
  "function nextIndex() view returns (uint256)",
  "function currentRoot() view returns (bytes32)",
  "function isKnownRoot(bytes32 root) view returns (bool)",
  "function isSpent(bytes32 nullifier) view returns (bool)",
  "function commitmentSeen(bytes32 commitment) view returns (bool)",
]);

/** contracts/src/ShaidaLedger.sol (events and reads). */
export const ledgerEventsAbi = parseAbi([
  "event Vouched(uint32 indexed payerId, bytes32 indexed paymentCommitment, uint256 leafIndex, bytes32 leaf)",
  "event Swept(bytes32 indexed nullifier, bytes32 indexed sweepCommitment, uint256 leafIndex, bytes32 leaf)",
  "function nextIndex() view returns (uint256)",
  "function isKnownRoot(bytes32 root) view returns (bool)",
]);

/** Gloam GloamPayMemo (contracts/lib/gloam/contracts/src/GloamPayMemo.sol). */
export const memoAbi = parseAbi(["event PaymentMemo(bytes32 indexed paymentCommitment, bytes memo)"]);
