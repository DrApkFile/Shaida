// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The Gloam ShieldPoolPoseidon functions Shaida calls
///         (gloamtrade/gloam contracts/src/ShieldPoolCore.sol, MIT).
interface IGloamPool {
    function shieldBound(address asset, uint256 amount, bytes32 commitment, bytes calldata proof)
        external
        payable;

    function transfer(bytes calldata proof, bytes32 root, bytes32 nullifier, bytes32[2] calldata newCommitments)
        external;

    /// @notice True once a commitment has been inserted into the pool tree (shield or transfer output).
    function commitmentSeen(bytes32 commitment) external view returns (bool);
}

/// @notice tUSD8 (Circle FiatTokenV2_2) functions the depositor uses. S9 measured these on the live token.
interface IFiatTokenV2 {
    function paused() external view returns (bool);
    function isBlacklisted(address account) external view returns (bool);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
