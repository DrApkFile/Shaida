// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoseidon2} from "gloam/src/lib/IPoseidon.sol";

/// @title Revocations
/// @notice Lets the holder of a Shaida proof link revoke it, with no wallet and no signature (DECISIONS D35).
///         A revocable link (link version 2) uses salt = Poseidon(REVOKE_TAG, revokeSecret) in its context
///         Poseidon(readerIdHash, expiry, salt). The secret stays in the holder's vault. Revealing it here proves
///         the right to revoke: only someone who knows a preimage of the salt can mark it.
/// @dev Anyone may send `revoke`: a copy of a pending call (front-running) only causes the same revocation.
///      Verifiers read `revokedAt(salt)` at their pinned block (PRD §5 step 5a); a hit is ProofRevoked.
///      Poseidon is the circomlibjs PoseidonT3 the stack already deployed (the ledger and pool use it), so the salt
///      is the same field element the browser and the SDK compute with poseidon-lite.
contract Revocations {
    /// Domain tag, next to ShaidaLedger's VOUCH_TAG (1) and SWEEP_TAG (2) and the reader tag (3).
    uint256 public constant REVOKE_TAG = 4;
    /// BN254 scalar field order: Poseidon's inputs and outputs live below it.
    uint256 internal constant FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IPoseidon2 public immutable poseidon2;

    /// @notice The block a salt was revoked in, or 0 if it never was.
    mapping(uint256 salt => uint256 blockNumber) public revokedAt;

    event Revoked(uint256 indexed salt, uint256 blockNumber);

    error ZeroAddress();
    /// The secret is 0 or not below the field order (it would alias another secret's salt).
    error BadSecret();
    error AlreadyRevoked(uint256 salt, uint256 blockNumber);

    constructor(IPoseidon2 poseidon2_) {
        if (address(poseidon2_) == address(0)) revert ZeroAddress();
        poseidon2 = poseidon2_;
    }

    /// @notice The salt a revoke secret stands for: Poseidon(REVOKE_TAG, secret).
    function saltOf(uint256 secret) public view returns (uint256) {
        if (secret == 0 || secret >= FIELD_ORDER) revert BadSecret();
        return poseidon2.poseidon([REVOKE_TAG, secret]);
    }

    /// @notice Revokes the link whose salt is Poseidon(REVOKE_TAG, secret). Permanent. A second call reverts.
    function revoke(uint256 secret) external returns (uint256 salt) {
        salt = saltOf(secret);
        uint256 at = revokedAt[salt];
        if (at != 0) revert AlreadyRevoked(salt, at);
        revokedAt[salt] = block.number;
        emit Revoked(salt, block.number);
    }

    /// @notice Whether a salt was revoked at or before the block this is read at.
    function isRevoked(uint256 salt) external view returns (bool) {
        return revokedAt[salt] != 0;
    }
}
