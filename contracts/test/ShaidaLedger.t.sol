// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";
import {ShaidaBase} from "./helpers/ShaidaBase.sol";

contract ShaidaLedgerTest is ShaidaBase {
    function test_vouchedPay_by_an_active_payer_inserts_the_vouch_leaf() public {
        uint32 id = _register(payer);
        ShaidaLedger.TransferArgs memory t = _transfer();
        bytes32 expected = _poseidon3(1, id, uint256(t.newCommitments[0]));

        vm.expectEmit(address(ledger));
        emit ShaidaLedger.Vouched(id, t.newCommitments[0], 0, expected);
        vm.prank(payer);
        assertEq(ledger.vouchedPay(t), 0);

        assertTrue(pool.isSpent(t.nullifier), "the pool transfer happened");
        assertEq(ledger.nextIndex(), 1);
        assertTrue(ledger.isKnownRoot(ledger.currentRoot()));
    }

    function test_X01_refuses_vouchedPay_from_an_unregistered_sender() public {
        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, stranger));
        vm.prank(stranger);
        ledger.vouchedPay(t);
        assertFalse(pool.isSpent(t.nullifier), "nothing was sent");
        assertEq(ledger.nextIndex(), 0, "no leaf");
    }

    function test_X02_refuses_a_relayed_pay_signed_by_an_unregistered_key() public {
        ShaidaLedger.TransferArgs memory t = _transfer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(strangerKey, t, deadline);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, stranger));
        vm.prank(relayer);
        ledger.vouchedPayFor(t, stranger, deadline, sig);
        assertEq(ledger.nextIndex(), 0);
    }

    function test_X02_refuses_a_registered_payers_signature_moved_to_another_transfer() public {
        _register(payer);
        ShaidaLedger.TransferArgs memory signed = _transfer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(payerKey, signed, deadline);

        ShaidaLedger.TransferArgs memory swapped = _transfer(); // e.g. the recipient's self-pay
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.BadPayerSignature.selector, payer));
        vm.prank(relayer);
        ledger.vouchedPayFor(swapped, payer, deadline, sig);

        signed.newCommitments[1] = swapped.newCommitments[1]; // only the change note changed
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.BadPayerSignature.selector, payer));
        vm.prank(relayer);
        ledger.vouchedPayFor(signed, payer, deadline, sig);
    }

    function test_X02_a_relayed_pay_signed_by_an_active_payer_is_vouched_once() public {
        _register(payer);
        ShaidaLedger.TransferArgs memory t = _transfer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(payerKey, t, deadline);

        vm.prank(relayer);
        ledger.vouchedPayFor(t, payer, deadline, sig);
        assertEq(ledger.nextIndex(), 1);
        assertTrue(ledger.isKnownRoot(ledger.currentRoot()));

        vm.expectRevert(bytes4(keccak256("AlreadySpent()")));
        vm.prank(relayer);
        ledger.vouchedPayFor(t, payer, deadline, sig);
        assertEq(ledger.nextIndex(), 1, "a replayed signature adds no leaf");
    }

    function test_refuses_a_relayed_pay_after_its_deadline() public {
        _register(payer);
        ShaidaLedger.TransferArgs memory t = _transfer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(payerKey, t, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.SignatureExpired.selector, deadline));
        ledger.vouchedPayFor(t, payer, deadline, sig);
    }

    function test_X03_refuses_a_revoked_payer_direct_and_relayed() public {
        uint32 id = _register(payer);
        vm.prank(attestor);
        registry.revoke(id);

        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        vm.prank(payer);
        ledger.vouchedPay(t);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(payerKey, t, deadline);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        vm.prank(relayer);
        ledger.vouchedPayFor(t, payer, deadline, sig);
        assertEq(ledger.nextIndex(), 0);
    }

    function test_X03_revocation_leaves_earlier_vouches_in_place() public {
        uint32 id = _register(payer);
        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.prank(payer);
        ledger.vouchedPay(t);
        bytes32 rootBefore = ledger.currentRoot();
        vm.prank(attestor);
        registry.revoke(id);
        assertTrue(ledger.isKnownRoot(rootBefore), "revocation applies to future payments only (D3)");
    }

    function test_sweep_inserts_the_sweep_leaf_from_nullifier_and_fresh_note() public {
        ShaidaLedger.TransferArgs memory t = _transfer();
        bytes32 expected = _poseidon3(2, uint256(t.nullifier), uint256(t.newCommitments[0]));
        vm.expectEmit(address(ledger));
        emit ShaidaLedger.Swept(t.nullifier, t.newCommitments[0], 0, expected);
        vm.prank(stranger); // anyone may submit a sweep; only the leaf contents matter to the circuit
        ledger.sweep(t);
        assertTrue(pool.isSpent(t.nullifier));
    }

    function test_sweep_and_vouch_leaves_differ_for_the_same_inputs() public view {
        assertTrue(_poseidon3(1, 5, 7) != _poseidon3(2, 5, 7), "domain tags separate V and S leaves");
    }

    function test_a_refused_pool_transfer_adds_no_leaf() public {
        _register(payer);
        spendVerifier.setAccept(false);
        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.expectRevert(bytes4(keccak256("InvalidProof()")));
        vm.prank(payer);
        ledger.vouchedPay(t);
        assertEq(ledger.nextIndex(), 0);
    }

    function _sign(uint256 key, ShaidaLedger.TransferArgs memory t, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ledger.vouchDigest(t, deadline));
        return abi.encodePacked(r, s, v);
    }
}
