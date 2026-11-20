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
///         The ledger is the only writer of V and S leaves.
/// @dev Gloam's pool accepts transfers from anyone, so a transfer sent to the pool directly (or copied
///      from the mempool and sent there first) spends the note without a leaf here. That never creates
///      a false leaf; it can only leave a real payment uncounted (LIMITS.md).
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

    IGloamPool public immutable pool;
    PayerRegistry public immutable registry;
    IPoseidon3 public immutable poseidon3;
    IMT.Tree private _tree;

    event Vouched(uint32 indexed payerId, bytes32 indexed paymentCommitment, uint256 leafIndex, bytes32 leaf);
    event Swept(bytes32 indexed nullifier, bytes32 indexed sweepCommitment, uint256 leafIndex, bytes32 leaf);

    error ZeroAddress();
    error SignatureExpired(uint256 deadline);
    error BadPayerSignature(address payer);

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
        bytes32 leaf = _hash3(VOUCH_TAG, payerId, uint256(t.newCommitments[0]));
        leafIndex = _tree.insert(uint256(leaf));
        emit Vouched(payerId, t.newCommitments[0], leafIndex, leaf);
    }

    function _hash3(uint256 a, uint256 b, uint256 c) internal view returns (bytes32) {
        return bytes32(poseidon3.poseidon([a, b, c]));
    }
}
