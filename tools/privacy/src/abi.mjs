// Every function and event an observer meets on a Shaida deployment, from the sources: contracts/src/*.sol and
// Gloam's ShieldPoolCore.sol / GloamPayMemo.sol (MIT, vendored in contracts/lib/gloam), and tUSD8's ERC-20 Transfer.
import { parseAbi, toEventSelector, toFunctionSelector } from "viem";

const STRUCTS = [
  "struct TransferArgs { bytes proof; bytes32 root; bytes32 nullifier; bytes32[2] newCommitments; }",
  "struct Authorization { uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }",
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
];

/** [kind, contract key, signature]: kind is the action name the audit uses. */
const FUNCTIONS = [
  ["deposit", "depositor", "function depositWithAuthorization(address payer, uint256 amount, bytes32 commitment, bytes shieldProof, Authorization auth)"],
  ["deposit", "depositor", "function deposit(uint256 amount, bytes32 commitment, bytes shieldProof)"],
  ["vouchedPay", "ledger", "function vouchedPayFor(TransferArgs t, address payer, uint256 deadline, bytes signature)"],
  ["vouchedPay", "ledger", "function vouchedPay(TransferArgs t)"],
  ["lateVouch", "ledger", "function lateVouchFor(bytes32 paymentCommitment, address payer, uint256 deadline, bytes signature)"],
  ["lateVouch", "ledger", "function lateVouch(bytes32 paymentCommitment)"],
  ["sweep", "ledger", "function sweep(TransferArgs t)"],
  ["memo", "memo", "function postMemo(bytes32 paymentCommitment, bytes memo)"],
  ["unshield", "pool", "function unshield(bytes proof, bytes32 root, bytes32 nullifier, address asset, address to, uint256 amount)"],
  ["poolTransfer", "pool", "function transfer(bytes proof, bytes32 root, bytes32 nullifier, bytes32[2] newCommitments)"],
  ["register", "registry", "function register(address account, bytes32 nameHash)"],
  ["revoke", "registry", "function revoke(uint32 payerId)"],
  ["attest", "incomeVerifier", "function attest(Proof proof, uint256[7] signals)"],
];

export const FUNCTION_TABLE = FUNCTIONS.map(([kind, contract, sig]) => {
  const abi = parseAbi([...STRUCTS, sig]).filter((x) => x.type === "function");
  return { kind, contract, sig, abi, selector: toFunctionSelector(abi[0]) };
});

export const EVENTS = parseAbi([
  "event Vouched(uint32 indexed payerId, bytes32 indexed paymentCommitment, uint256 leafIndex, bytes32 leaf)",
  "event Swept(bytes32 indexed nullifier, bytes32 indexed sweepCommitment, uint256 leafIndex, bytes32 leaf)",
  "event Deposited(address indexed payer, bytes32 indexed commitment, uint256 amount, bool gasless)",
  "event Shielded(bytes32 indexed commitment, address indexed asset, uint256 amount, uint256 leafIndex, address indexed from)",
  "event Transferred(bytes32 indexed nullifier, bytes32[2] newCommitments)",
  "event Unshielded(bytes32 indexed nullifier, address indexed asset, address indexed to, uint256 amount)",
  "event PaymentMemo(bytes32 indexed paymentCommitment, bytes memo)",
  "event PayerRegistered(uint32 indexed payerId, address indexed account, bytes32 nameHash)",
  "event PayerIdRevoked(uint32 indexed payerId, address indexed account)",
  "event IncomeProofChecked(uint256 indexed context, uint256 threshold, uint256 count)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const EVENT_BY_TOPIC = new Map(EVENTS.map((e) => [toEventSelector(e), e]));
export const TOKEN_TRANSFER_TOPIC = toEventSelector(EVENTS.find((e) => e.name === "Transfer"));

/** income.circom's public signals, in order (packages/shaida-proofs/src/circuit-input.ts PUBLIC_SIGNAL_ORDER). */
export const SIGNALS = ["ledgerRoot", "asset", "threshold", "count", "fromIndex", "toIndex", "context"];
