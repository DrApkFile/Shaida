// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface ITUSD8 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function decimals() external view returns (uint8);
}

/// @notice A10: the tUSD8 Shaida is built for, checked against the real token on a fork of Aevum testnet.
/// Source: adapted from qday-io/aevum-starter-kit contracts/test/fork/AevumFork.t.sol (MIT, (c) 2026 PQA Labs);
/// the kit's Checkout tests were removed with Checkout.
/// Run with: make test-fork
contract AevumForkTest is Test {
    ITUSD8 constant TUSD8 = ITUSD8(0x456569838f1d43009A91ebA4263147Afd7233483);

    function test_A10_real_tUSD8_has_the_expected_domain_and_decimals() public view {
        assertEq(block.chainid, 44005, "run with --fork-url https://rpc-test.qday.info");
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("tUSD8"),
                keccak256("2"),
                uint256(44005),
                address(TUSD8)
            )
        );
        assertEq(TUSD8.DOMAIN_SEPARATOR(), expected);
        assertEq(TUSD8.decimals(), 6);
    }
}
