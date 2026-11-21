// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGloamPool, IFiatTokenV2} from "./interfaces/IGloamPool.sol";

/// @title ShaidaDepositor
/// @notice Puts tUSD8 into the Gloam pool as a note the depositor chose (shieldBound), two ways:
///         - gasless: the payer signs an EIP-3009 ReceiveWithAuthorization, anyone (the relayer)
///           submits it. The nonce is keccak256(abi.encode(this, commitment)), so the signature
///           is valid for exactly one note, one amount and one use (spike S6);
///         - standard: the payer approves this contract and calls deposit().
///         Refuses up front, with names, when tUSD8 is paused or the payer is blacklisted (D7).
/// @dev Holds no funds between transactions: each deposit pulls `amount` and the pool pulls the
///      same `amount` back out in the same call (checked as a zero balance change). Gasless pattern adapted from the Aevum Starter Kit
///      Checkout.payWithAuthorization (MIT, (c) 2026 PQA Labs).
contract ShaidaDepositor {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IGloamPool public immutable pool;

    /// @notice The payer's EIP-3009 ReceiveWithAuthorization fields (to = this contract).
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Deposited(address indexed payer, bytes32 indexed commitment, uint256 amount, bool gasless);

    error TokenPaused();
    error PayerBlacklisted(address payer);
    error ZeroAmount();
    error ZeroAddress();
    error PoolPullMismatch(uint256 balanceBefore, uint256 balanceAfter);

    constructor(IERC20 token_, IGloamPool pool_) {
        if (address(token_) == address(0) || address(pool_) == address(0)) revert ZeroAddress();
        token = token_;
        pool = pool_;
    }

    /// @notice The EIP-3009 nonce a payer signs for a gasless deposit into `commitment`.
    function authorizationNonce(bytes32 commitment) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), commitment));
    }

    function depositWithAuthorization(
        address payer,
        uint256 amount,
        bytes32 commitment,
        bytes calldata shieldProof,
        Authorization calldata auth
    ) external {
        _refuseUnusableToken(payer, amount);
        // Every field is known up front; a revert below undoes the event.
        emit Deposited(payer, commitment, amount, true);
        uint256 balanceBefore = token.balanceOf(address(this));
        // receiveWithAuthorization requires msg.sender == to, so nobody else can redirect the signature.
        IFiatTokenV2(address(token)).receiveWithAuthorization(
            payer,
            address(this),
            amount,
            auth.validAfter,
            auth.validBefore,
            authorizationNonce(commitment),
            auth.v,
            auth.r,
            auth.s
        );
        _shield(amount, commitment, shieldProof, balanceBefore);
    }

    function deposit(uint256 amount, bytes32 commitment, bytes calldata shieldProof) external {
        _refuseUnusableToken(msg.sender, amount);
        emit Deposited(msg.sender, commitment, amount, false);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        _shield(amount, commitment, shieldProof, balanceBefore);
    }

    function _refuseUnusableToken(address payer, uint256 amount) internal view {
        if (amount == 0) revert ZeroAmount();
        IFiatTokenV2 fiat = IFiatTokenV2(address(token));
        if (fiat.paused()) revert TokenPaused();
        if (fiat.isBlacklisted(payer)) revert PayerBlacklisted(payer);
    }

    /// @dev Compares against the balance before this deposit, not against zero: tokens someone sends
    ///      here directly must not be able to block deposits (they stay here; there is no rescue path).
    function _shield(uint256 amount, bytes32 commitment, bytes calldata shieldProof, uint256 balanceBefore)
        internal
    {
        token.forceApprove(address(pool), amount);
        pool.shieldBound(address(token), amount, commitment, shieldProof);
        uint256 balanceAfter = token.balanceOf(address(this));
        if (balanceAfter != balanceBefore) revert PoolPullMismatch(balanceBefore, balanceAfter);
    }
}
