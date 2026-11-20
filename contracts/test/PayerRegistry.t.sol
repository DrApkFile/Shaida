// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PayerRegistry} from "../src/PayerRegistry.sol";

contract PayerRegistryTest is Test {
    PayerRegistry internal registry;
    address internal attestor = makeAddr("attestor");
    address internal acme = makeAddr("acme");
    bytes32 internal constant ACME = keccak256("Acme Studio (demo)");

    function setUp() public {
        registry = new PayerRegistry(attestor);
    }

    function test_registers_payers_with_ids_from_one_and_reads_them_back() public {
        vm.startPrank(attestor);
        assertEq(registry.register(acme, ACME), 1);
        assertEq(registry.register(makeAddr("other"), keccak256("other")), 2);
        vm.stopPrank();
        assertEq(registry.activeIdOf(acme), 1);
        PayerRegistry.Payer memory p = registry.payer(1);
        assertEq(p.account, acme);
        assertEq(p.nameHash, ACME);
        assertFalse(p.revoked);
    }

    function test_X01_activeIdOf_refuses_an_unregistered_address() public {
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, acme));
        registry.activeIdOf(acme);
    }

    function test_X03_revocation_is_immediate_and_permanent() public {
        vm.startPrank(attestor);
        uint32 id = registry.register(acme, ACME);
        registry.revoke(id);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        registry.revoke(id);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.AlreadyRegistered.selector, acme, id));
        registry.register(acme, ACME);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        registry.activeIdOf(acme);
    }

    function test_only_the_attestor_registers_or_revokes() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, acme));
        vm.prank(acme);
        registry.register(acme, ACME);

        vm.prank(attestor);
        uint32 id = registry.register(acme, ACME);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, acme));
        vm.prank(acme);
        registry.revoke(id);
    }

    function test_refuses_zero_address_empty_name_and_unknown_ids() public {
        vm.startPrank(attestor);
        vm.expectRevert(PayerRegistry.ZeroAddress.selector);
        registry.register(address(0), ACME);
        vm.expectRevert(PayerRegistry.EmptyNameHash.selector);
        registry.register(acme, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.UnknownPayerId.selector, uint32(7)));
        registry.revoke(7);
        vm.stopPrank();
    }

    function test_attestor_cannot_renounce_and_hands_over_in_two_steps() public {
        vm.prank(attestor);
        vm.expectRevert(PayerRegistry.RenounceDisabled.selector);
        registry.renounceOwnership();

        address next = makeAddr("next attestor");
        vm.prank(attestor);
        registry.transferOwnership(next);
        assertEq(registry.owner(), attestor, "still the old attestor until accepted");
        vm.prank(next);
        registry.acceptOwnership();
        assertEq(registry.owner(), next);
    }
}
