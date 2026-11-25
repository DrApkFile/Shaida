// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoseidon2} from "gloam/src/lib/IPoseidon.sol";
import {Revocations} from "../src/Revocations.sol";
import {PoseidonDeployer} from "./helpers/ShaidaBase.sol";

/// Revocations over the same circomlibjs PoseidonT3 bytecode DeployStack deployed (D35).
contract RevocationsTest is PoseidonDeployer {
    Revocations internal rev;

    /// poseidon-lite (the browser's and the SDK's hash): poseidon2([4, 1]) and poseidon2([4, 2^248 - 1]).
    uint256 internal constant SALT_OF_1 = 0x0c9d5facc929a65bc38007fe19281760a02ac15f4b85bff641d65d156d4c213d;
    uint256 internal constant SALT_OF_MAX31 = 0x1e01ce1e471a8599d69338b1407b50010c29865fced0dffb177a6bf344b375ad;
    uint256 internal constant FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event Revoked(uint256 indexed salt, uint256 blockNumber);

    function setUp() public {
        rev = new Revocations(IPoseidon2(_deployPoseidon("Poseidon2")));
    }

    function test_RV05_salt_equals_the_browsers_poseidon() public view {
        assertEq(rev.saltOf(1), SALT_OF_1);
        assertEq(rev.saltOf((uint256(1) << 248) - 1), SALT_OF_MAX31);
    }

    function test_RV01_revoke_marks_the_salt_with_its_block_and_emits_Revoked() public {
        vm.roll(4_000_123);
        vm.expectEmit(true, false, false, true, address(rev));
        emit Revoked(SALT_OF_1, 4_000_123);
        assertEq(rev.revoke(1), SALT_OF_1);
        assertEq(rev.revokedAt(SALT_OF_1), 4_000_123);
        assertTrue(rev.isRevoked(SALT_OF_1));
    }

    function test_RV02_a_wrong_secret_cannot_revoke_another_links_salt() public {
        rev.revoke(2);
        assertFalse(rev.isRevoked(SALT_OF_1), "secret 2 marked secret 1's salt");
        assertEq(rev.revokedAt(SALT_OF_1), 0);
        // There is no way to mark a salt directly: revoking "the salt itself" marks Poseidon(4, salt) instead.
        rev.revoke(SALT_OF_1);
        assertFalse(rev.isRevoked(SALT_OF_1), "revoking the salt as a secret marked the salt");
    }

    function test_RV03_a_second_revoke_is_refused_and_keeps_the_first_block() public {
        vm.roll(100);
        rev.revoke(1);
        vm.roll(200);
        vm.expectRevert(abi.encodeWithSelector(Revocations.AlreadyRevoked.selector, SALT_OF_1, 100));
        rev.revoke(1);
        assertEq(rev.revokedAt(SALT_OF_1), 100);
    }

    function test_RV04_zero_or_out_of_field_secrets_are_refused() public {
        vm.expectRevert(Revocations.BadSecret.selector);
        rev.revoke(0);
        vm.expectRevert(Revocations.BadSecret.selector);
        rev.revoke(FIELD_ORDER);
        vm.expectRevert(Revocations.BadSecret.selector);
        rev.revoke(FIELD_ORDER + 1);
        // FIELD_ORDER + 1 would alias secret 1 if it were reduced: secret 1's salt stays unrevoked.
        assertFalse(rev.isRevoked(SALT_OF_1));
    }

    function test_RV06_anyone_may_send_it_and_a_copied_call_revokes_the_same_salt() public {
        vm.prank(address(0xBEEF));
        rev.revoke(1);
        vm.prank(address(0xF00D));
        vm.expectRevert(abi.encodeWithSelector(Revocations.AlreadyRevoked.selector, SALT_OF_1, block.number));
        rev.revoke(1);
        assertTrue(rev.isRevoked(SALT_OF_1));
    }

    function test_RV07_constructor_refuses_a_zero_poseidon() public {
        vm.expectRevert(Revocations.ZeroAddress.selector);
        new Revocations(IPoseidon2(address(0)));
    }

    /// Measured gas of one revoke (cold slot, as on chain), logged for evidence/revocations-gas.md.
    function test_GAS_revoke() public {
        uint256 g = gasleft();
        rev.revoke((uint256(1) << 248) - 1);
        uint256 used = g - gasleft();
        emit log_named_uint("revoke gas (call body, excl. 21k base + calldata)", used);
        assertLt(used, 120_000);
    }
}
