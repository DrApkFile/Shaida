// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";
import {ShaidaBase} from "./helpers/ShaidaBase.sol";

/// D9: a vouchedPay copied from the mempool and sent to the pool first leaves a real payment note
/// without a V leaf; the payer repairs it with lateVouch. At most one V leaf per commitment.
contract ShaidaLedgerLateVouchTest is ShaidaBase {
    /// A front-runner sends the payer's transfer to the pool directly: the note exists, no V leaf.
    function _copiedPayment() internal returns (bytes32 paymentCommitment) {
        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.prank(stranger);
        pool.transfer(t.proof, t.root, t.nullifier, t.newCommitments);
        assertEq(ledger.nextIndex(), 0, "the copy added no leaf");
        return t.newCommitments[0];
    }

    function test_D9_lateVouch_by_the_payer_repairs_a_copied_vouchedPay() public {
        uint32 id = _register(payer);
        bytes32 c = _copiedPayment();
        bytes32 expected = _poseidon3(1, id, uint256(c));

        vm.expectEmit(address(ledger));
        emit ShaidaLedger.Vouched(id, c, 0, expected);
        vm.prank(payer);
        assertEq(ledger.lateVouch(c), 0);
        assertTrue(ledger.vouched(c));
        assertTrue(ledger.isKnownRoot(ledger.currentRoot()));
    }

    function test_D9_X01_refuses_lateVouch_from_an_unregistered_sender() public {
        bytes32 c = _copiedPayment();
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, stranger));
        vm.prank(stranger);
        ledger.lateVouch(c);
        assertEq(ledger.nextIndex(), 0);
    }

    function test_D9_X03_refuses_lateVouch_from_a_revoked_payer_direct_and_relayed() public {
        uint32 id = _register(payer);
        bytes32 c = _copiedPayment();
        vm.prank(attestor);
        registry.revoke(id);

        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        vm.prank(payer);
        ledger.lateVouch(c);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signLate(payerKey, c, deadline);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerRevoked.selector, id));
        vm.prank(relayer);
        ledger.lateVouchFor(c, payer, deadline, sig);
        assertEq(ledger.nextIndex(), 0);
    }

    function test_D9_X04_refuses_a_second_lateVouch_for_the_same_commitment() public {
        _register(payer);
        address other = makeAddr("other payer");
        _register(other);
        bytes32 c = _copiedPayment();
        vm.prank(payer);
        ledger.lateVouch(c);

        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.AlreadyVouched.selector, c));
        vm.prank(payer);
        ledger.lateVouch(c);
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.AlreadyVouched.selector, c));
        vm.prank(other);
        ledger.lateVouch(c);
        assertEq(ledger.nextIndex(), 1, "one V leaf per commitment, whoever vouches");
    }

    function test_D9_X04_refuses_lateVouch_for_a_payment_already_vouched_by_vouchedPay() public {
        _register(payer);
        ShaidaLedger.TransferArgs memory t = _transfer();
        vm.prank(payer);
        ledger.vouchedPay(t);

        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.AlreadyVouched.selector, t.newCommitments[0]));
        vm.prank(payer);
        ledger.lateVouch(t.newCommitments[0]);
        assertEq(ledger.nextIndex(), 1);
    }

    function test_D9_X01_a_recipient_who_is_not_a_payer_cannot_vouch_for_their_own_note() public {
        _register(payer);
        bytes32 own = _copiedPayment(); // stands in for a note the recipient shielded or received
        address recipient = stranger;

        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, recipient));
        vm.prank(recipient);
        ledger.lateVouch(own);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory selfSigned = _signLate(strangerKey, own, deadline);
        vm.expectRevert(abi.encodeWithSelector(PayerRegistry.PayerNotRegistered.selector, recipient));
        vm.prank(relayer);
        ledger.lateVouchFor(own, recipient, deadline, selfSigned);

        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.BadPayerSignature.selector, payer));
        vm.prank(relayer);
        ledger.lateVouchFor(own, payer, deadline, selfSigned); // naming a real payer needs their key
        assertEq(ledger.nextIndex(), 0);
    }

    function test_D9_a_relayed_lateVouch_works_once_and_only_for_its_commitment() public {
        uint32 id = _register(payer);
        bytes32 signedFor = _copiedPayment();
        bytes32 other = _copiedPayment();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signLate(payerKey, signedFor, deadline);

        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.BadPayerSignature.selector, payer));
        vm.prank(relayer);
        ledger.lateVouchFor(other, payer, deadline, sig);

        vm.expectEmit(address(ledger));
        emit ShaidaLedger.Vouched(id, signedFor, 0, _poseidon3(1, id, uint256(signedFor)));
        vm.prank(relayer);
        ledger.lateVouchFor(signedFor, payer, deadline, sig);

        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.AlreadyVouched.selector, signedFor));
        vm.prank(relayer);
        ledger.lateVouchFor(signedFor, payer, deadline, sig);
        assertEq(ledger.nextIndex(), 1);
    }

    function test_D9_refuses_a_relayed_lateVouch_after_its_deadline() public {
        _register(payer);
        bytes32 c = _copiedPayment();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signLate(payerKey, c, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.SignatureExpired.selector, deadline));
        ledger.lateVouchFor(c, payer, deadline, sig);
    }

    function test_D9_refuses_lateVouch_for_a_commitment_the_pool_never_saw() public {
        _register(payer);
        bytes32 invented = _field("never in the pool");
        vm.expectRevert(abi.encodeWithSelector(ShaidaLedger.UnknownCommitment.selector, invented));
        vm.prank(payer);
        ledger.lateVouch(invented);
    }

    function _signLate(uint256 key, bytes32 c, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ledger.lateVouchDigest(c, deadline));
        return abi.encodePacked(r, s, v);
    }
}
