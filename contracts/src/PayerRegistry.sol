// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title PayerRegistry
/// @notice The attestor's list of businesses whose payments Shaida vouches for (PRD §3).
///         Ids start at 1 and are never reused. Revoking an id is immediate and permanent,
///         and an address that ever held an id can never be registered again, so a revoked
///         payer cannot come back under a fresh id without a new address.
/// @dev The owner is the attestor (trust assumption A8). Ownership moves in two steps and
///      cannot be renounced, so the registry can never be left without an attestor by accident.
contract PayerRegistry is Ownable2Step {
    struct Payer {
        address account;
        bytes32 nameHash;
        bool revoked;
    }

    uint32 public payerCount;
    mapping(uint32 payerId => Payer) private _payers;
    mapping(address account => uint32 payerId) public idOf;

    event PayerRegistered(uint32 indexed payerId, address indexed account, bytes32 nameHash);
    event PayerIdRevoked(uint32 indexed payerId, address indexed account);

    error PayerNotRegistered(address account);
    error PayerRevoked(uint32 payerId);
    error AlreadyRegistered(address account, uint32 payerId);
    error UnknownPayerId(uint32 payerId);
    error ZeroAddress();
    error EmptyNameHash();
    error RenounceDisabled();

    constructor(address attestor) Ownable(attestor) {}

    function register(address account, bytes32 nameHash) external onlyOwner returns (uint32 payerId) {
        if (account == address(0)) revert ZeroAddress();
        if (nameHash == bytes32(0)) revert EmptyNameHash();
        uint32 existing = idOf[account];
        if (existing != 0) revert AlreadyRegistered(account, existing);
        payerId = ++payerCount;
        _payers[payerId] = Payer({account: account, nameHash: nameHash, revoked: false});
        idOf[account] = payerId;
        emit PayerRegistered(payerId, account, nameHash);
    }

    function revoke(uint32 payerId) external onlyOwner {
        Payer storage p = _payers[payerId];
        if (p.account == address(0)) revert UnknownPayerId(payerId);
        if (p.revoked) revert PayerRevoked(payerId);
        p.revoked = true;
        emit PayerIdRevoked(payerId, p.account);
    }

    /// @notice The payer id of `account`, or a revert naming why it is not an active payer.
    function activeIdOf(address account) external view returns (uint32 payerId) {
        payerId = idOf[account];
        if (payerId == 0) revert PayerNotRegistered(account);
        if (_payers[payerId].revoked) revert PayerRevoked(payerId);
    }

    function payer(uint32 payerId) external view returns (Payer memory) {
        Payer memory p = _payers[payerId];
        if (p.account == address(0)) revert UnknownPayerId(payerId);
        return p;
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }
}
