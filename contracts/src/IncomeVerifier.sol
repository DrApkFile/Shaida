// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The snarkjs Groth16 verifier for income.circom. In production: contracts/src/generated/IncomeGroth16Verifier.sol,
/// written by ceremony/finalize.ts from the final ceremony key. Public signals in the circuit's frozen order.
interface IIncomeGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[7] calldata pubSignals
    ) external view returns (bool);
}

/// The ledger read IncomeVerifier needs: is this a root the ShaidaLedger tree has had.
interface ILedgerRoots {
    function isKnownRoot(bytes32 root) external view returns (bool);
}

/// @title IncomeVerifier
/// @notice On-chain check of one Shaida income proof (PRD §3, §5 steps 2, 6 and 7): asset is tUSD8, the ledger root
/// is known to ShaidaLedger, and the Groth16 proof verifies. Every failure reverts with a named error; it never
/// returns false. The reader's context (reader, expiry) is not checked here: it is opened off-chain (PRD §5 steps
/// 3-5), and `attest` records the context so an on-chain consumer can match it.
/// @dev Gas: snarkjs verifiers return false instead of reverting when they run out of gas, so a short gas limit
/// would look like an invalid proof, and eth_estimateGas under-reports (~30k vs ~258k, REALITY_SPIKES S7). This
/// contract refuses to start the pairing check with less than MIN_VERIFY_GAS left (InsufficientGas). Callers set
/// gas explicitly: 400,000 for `check` in an eth_call or a transaction, 420,000 for `attest`.
/// A proof's calldata comes from snarkjs `groth16.exportSolidityCallData` (pi_b coordinates swapped).
contract IncomeVerifier {
    // Public signal positions (income.circom, BUILD_CONTRACT: frozen).
    uint256 internal constant LEDGER_ROOT = 0;
    uint256 internal constant ASSET = 1;
    uint256 internal constant THRESHOLD = 2;
    uint256 internal constant COUNT = 3;
    uint256 internal constant CONTEXT = 6;

    /// Gas that must remain before the Groth16 call. The call gets 63/64 of what remains (EIP-150); measured
    /// verifyProof cost for this circuit: 262,573 gas (test_GAS_verifyProof, throwaway key; the same for any key of
    /// this circuit, since the precompile costs do not depend on the key).
    uint256 public constant MIN_VERIFY_GAS = 320_000;

    IIncomeGroth16Verifier public immutable groth16;
    ILedgerRoots public immutable ledger;
    /// tUSD8 as a field element (Gloam encodes an asset as uint256(uint160(address))).
    uint256 public immutable asset;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    event IncomeProofChecked(uint256 indexed context, uint256 threshold, uint256 count);

    error ZeroAddress();
    error AssetMismatch(uint256 asset);
    error UnknownRoot(bytes32 root);
    error ProofInvalid();
    error InsufficientGas(uint256 available, uint256 required);

    constructor(IIncomeGroth16Verifier groth16_, ILedgerRoots ledger_, address asset_) {
        if (address(groth16_) == address(0) || address(ledger_) == address(0) || asset_ == address(0)) revert ZeroAddress();
        groth16 = groth16_;
        ledger = ledger_;
        asset = uint256(uint160(asset_));
    }

    /// @notice Reverts unless the proof is valid for these public signals over a known ledger root and tUSD8.
    function check(Proof calldata proof, uint256[7] calldata signals) public view returns (bool) {
        if (signals[ASSET] != asset) revert AssetMismatch(signals[ASSET]);
        bytes32 root = bytes32(signals[LEDGER_ROOT]);
        if (!ledger.isKnownRoot(root)) revert UnknownRoot(root);
        uint256 available = gasleft();
        if (available < MIN_VERIFY_GAS) revert InsufficientGas(available, MIN_VERIFY_GAS);
        if (!groth16.verifyProof(proof.a, proof.b, proof.c, signals)) revert ProofInvalid();
        return true;
    }

    /// @notice `check`, then a public record that a proof for this context passed. Optional (PRD §3).
    function attest(Proof calldata proof, uint256[7] calldata signals) external returns (bool) {
        check(proof, signals);
        emit IncomeProofChecked(signals[CONTEXT], signals[THRESHOLD], signals[COUNT]);
        return true;
    }
}
