// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
// Gloam (MIT, (c) 2026 Gloam): the same depth-20 Poseidon tree the pool and the circuits use.
import {IncrementalMerkleTreePoseidon as IMT} from "gloam/src/lib/IncrementalMerkleTreePoseidon.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {IGloamPool} from "./interfaces/IGloamPool.sol";
import {PayerRegistry} from "./PayerRegistry.sol";

/// @title ShaidaLedger
/// @notice Sends Gloam private transfers and records the two facts the income circuit needs (D3),
///         as leaves of its own Poseidon tree:
///         - vouch leaf  V = Poseidon(1, payerId, paymentCommitment), only when an ACTIVE registered
///           payer sends the payment (directly, or by signing it for a relayer);
///         - sweep leaf  S = Poseidon(2, nullifier, sweepCommitment), only when a payment note is
///           spent through sweep() into newCommitments[0].
///         The ledger is the only writer of V and S leaves, and writes at most one V leaf per
///         payment commitment (the circuit's strict index order relies on that against double counts).
/// @dev Gloam's pool accepts transfers from anyone, so a vouchedPay copied from the mempool and sent to
///      the pool first spends the payer's note without a V leaf. The payer can repair that with
///      lateVouch (D9). A copied sweep cannot be repaired: the ledger cannot tell which note a
///      nullifier spent, so a repair would let anyone write S leaves for unswept payments (D9, LIMITS.md).
contract ShaidaLedger is EIP712 {
    using IMT for IMT.Tree;

    struct TransferArgs {
        bytes proof;
        bytes32 root;
        bytes32 nullifier;
        bytes32[2] newCommitments;
    }

    uint256 public constant VOUCH_TAG = 1;
    uint256 public constant SWEEP_TAG = 2;
    /// @dev Binds a payer's signature to one exact transfer. The nullifier makes it single-use.
    bytes32 public constant VOUCH_TYPEHASH = keccak256(
        "Vouch(bytes32 root,bytes32 nullifier,bytes32 paymentCommitment,bytes32 changeCommitment,uint256 deadline)"
    );
    /// @dev Binds a payer's late vouch to one payment commitment. Single use: one V leaf per commitment.
    bytes32 public constant LATE_VOUCH_TYPEHASH = keccak256("LateVouch(bytes32 paymentCommitment,uint256 deadline)");

    IGloamPool public immutable pool;
    PayerRegistry public immutable registry;
    IPoseidon3 public immutable poseidon3;
    IMT.Tree private _tree;
    /// @notice Payment commitments that already have their V leaf.
    mapping(bytes32 paymentCommitment => bool) public vouched;

    event Vouched(uint32 indexed payerId, bytes32 indexed paymentCommitment, uint256 leafIndex, bytes32 leaf);
    event Swept(bytes32 indexed nullifier, bytes32 indexed sweepCommitment, uint256 leafIndex, bytes32 leaf);

    error ZeroAddress();
    error SignatureExpired(uint256 deadline);
    error BadPayerSignature(address payer);
    error AlreadyVouched(bytes32 paymentCommitment);
    error UnknownCommitment(bytes32 paymentCommitment);

    constructor(IGloamPool pool_, PayerRegistry registry_, IPoseidon2 poseidon2_, IPoseidon3 poseidon3_)
        EIP712("ShaidaLedger", "1")
    {
        if (
            address(pool_) == address(0) || address(registry_) == address(0) || address(poseidon2_) == address(0)
                || address(poseidon3_) == address(0)
        ) revert ZeroAddress();
        pool = pool_;
        registry = registry_;
        poseidon3 = poseidon3_;
        _tree.initialize(poseidon2_);
    }

    /// @notice A registered payer sends a private payment; newCommitments[0] is the payment note.
    function vouchedPay(TransferArgs calldata t) external returns (uint256 leafIndex) {
        return _vouchedPay(registry.activeIdOf(msg.sender), t);
    }

    /// @notice Relayer path: `payer` signed this exact transfer (EIP-712 Vouch), anyone submits it.
    function vouchedPayFor(TransferArgs calldata t, address payer, uint256 deadline, bytes calldata signature)
        external
        returns (uint256 leafIndex)
    {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (!SignatureChecker.isValidSignatureNow(payer, vouchDigest(t, deadline), signature)) {
            revert BadPayerSignature(payer);
        }
        return _vouchedPay(registry.activeIdOf(payer), t);
    }

    /// @notice Repair for a copied vouchedPay: an active payer vouches for a payment note that reached
    ///         the pool without a V leaf. Safe because a V leaf counts only together with an S leaf, and
    ///         S leaves come only from a real sweep through this ledger (D9).
    function lateVouch(bytes32 paymentCommitment) external returns (uint256 leafIndex) {
        return _vouch(registry.activeIdOf(msg.sender), paymentCommitment);
    }

    /// @notice Relayer path for lateVouch: `payer` signed this commitment (EIP-712 LateVouch).
    function lateVouchFor(bytes32 paymentCommitment, address payer, uint256 deadline, bytes calldata signature)
        external
        returns (uint256 leafIndex)
    {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (!SignatureChecker.isValidSignatureNow(payer, lateVouchDigest(paymentCommitment, deadline), signature)) {
            revert BadPayerSignature(payer);
        }
        return _vouch(registry.activeIdOf(payer), paymentCommitment);
    }

    /// @notice The recipient moves a received payment note into newCommitments[0], a note only they know.
    function sweep(TransferArgs calldata t) external returns (uint256 leafIndex) {
        pool.transfer(t.proof, t.root, t.nullifier, t.newCommitments);
        bytes32 leaf = _hash3(SWEEP_TAG, uint256(t.nullifier), uint256(t.newCommitments[0]));
        leafIndex = _tree.insert(uint256(leaf));
        emit Swept(t.nullifier, t.newCommitments[0], leafIndex, leaf);
    }

    function vouchDigest(TransferArgs calldata t, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(VOUCH_TYPEHASH, t.root, t.nullifier, t.newCommitments[0], t.newCommitments[1], deadline)
            )
        );
    }

    function lateVouchDigest(bytes32 paymentCommitment, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(LATE_VOUCH_TYPEHASH, paymentCommitment, deadline)));
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return _tree.isKnownRoot(uint256(root));
    }

    function currentRoot() external view returns (bytes32) {
        return bytes32(_tree.currentRoot);
    }

    function nextIndex() external view returns (uint256) {
        return _tree.nextIndex;
    }

    function _vouchedPay(uint32 payerId, TransferArgs calldata t) internal returns (uint256 leafIndex) {
        pool.transfer(t.proof, t.root, t.nullifier, t.newCommitments);
        return _vouch(payerId, t.newCommitments[0]);
    }

    /// @dev The only place a V leaf is written. The pool refuses a commitment it has seen before, so
    ///      after a transfer the commitment is always fresh here; lateVouch needs both checks.
    function _vouch(uint32 payerId, bytes32 paymentCommitment) internal returns (uint256 leafIndex) {
        if (vouched[paymentCommitment]) revert AlreadyVouched(paymentCommitment);
        if (!pool.commitmentSeen(paymentCommitment)) revert UnknownCommitment(paymentCommitment);
        vouched[paymentCommitment] = true;
        bytes32 leaf = _hash3(VOUCH_TAG, payerId, uint256(paymentCommitment));
        leafIndex = _tree.insert(uint256(leaf));
        emit Vouched(payerId, paymentCommitment, leafIndex, leaf);
    }

    function _hash3(uint256 a, uint256 b, uint256 c) internal view returns (bytes32) {
        return bytes32(poseidon3.poseidon([a, b, c]));
    }
}
