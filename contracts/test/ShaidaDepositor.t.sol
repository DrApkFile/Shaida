// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShaidaDepositor} from "../src/ShaidaDepositor.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";
import {ShaidaBase} from "./helpers/ShaidaBase.sol";

/// Gasless deposit binding (spike S6) and the D7 refusals, against the real Gloam pool code.
contract ShaidaDepositorTest is ShaidaBase {
    uint256 internal constant AMOUNT = 1_500_000; // 1.5 tUSD8
    bytes internal constant PROOF = hex"01"; // the stub shield verifier accepts it

    function setUp() public override {
        super.setUp();
        token.mint(payer, 10e6);
    }

    function test_S6_gasless_deposit_moves_exactly_the_signed_amount_into_the_note() public {
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        uint256 payerGasBefore = payer.balance;

        vm.expectEmit(address(depositor));
        emit ShaidaDepositor.Deposited(payer, commitment, AMOUNT, true);
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);

        assertEq(token.balanceOf(address(pool)), AMOUNT);
        assertEq(token.balanceOf(payer), 10e6 - AMOUNT);
        assertEq(token.balanceOf(address(depositor)), 0, "nothing stays in the depositor");
        assertEq(pool.nextIndex(), 1, "the commitment is a pool leaf");
        assertEq(payer.balance, payerGasBefore, "the payer paid no gas");
    }

    function test_S6_refuses_a_replayed_signature() public {
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);

        vm.expectRevert(MockUSD8.AuthorizationUsedAlready.selector);
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);
        assertEq(token.balanceOf(address(pool)), AMOUNT, "paid once");
    }

    function test_S6_refuses_a_signature_reused_for_another_commitment() public {
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, _field("signed note"));
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT, _field("relayer's note"), PROOF, auth);
        assertEq(token.balanceOf(payer), 10e6);
    }

    function test_S6_refuses_an_amount_changed_by_the_relayer() public {
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT + 1, commitment, PROOF, auth);
        assertEq(token.balanceOf(payer), 10e6);
    }

    function test_S6_refuses_a_signature_presented_for_another_payer() public {
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        token.mint(stranger, 10e6);
        vm.expectRevert(MockUSD8.InvalidSignature.selector);
        depositor.depositWithAuthorization(stranger, AMOUNT, commitment, PROOF, auth);
    }

    function test_D7_refuses_TokenPaused_before_pulling_anything() public {
        token.setPaused(true);
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        vm.expectRevert(ShaidaDepositor.TokenPaused.selector);
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);

        vm.prank(payer);
        token.approve(address(depositor), AMOUNT);
        vm.expectRevert(ShaidaDepositor.TokenPaused.selector);
        vm.prank(payer);
        depositor.deposit(AMOUNT, commitment, PROOF);
        assertEq(token.balanceOf(payer), 10e6);
    }

    function test_D7_refuses_PayerBlacklisted_on_both_paths() public {
        token.setBlacklisted(payer, true);
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        vm.expectRevert(abi.encodeWithSelector(ShaidaDepositor.PayerBlacklisted.selector, payer));
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);

        vm.prank(payer);
        token.approve(address(depositor), AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(ShaidaDepositor.PayerBlacklisted.selector, payer));
        vm.prank(payer);
        depositor.deposit(AMOUNT, commitment, PROOF);
    }

    function test_standard_deposit_pulls_from_the_caller_into_the_pool() public {
        bytes32 commitment = _field("note");
        vm.startPrank(payer);
        token.approve(address(depositor), AMOUNT);
        vm.expectEmit(address(depositor));
        emit ShaidaDepositor.Deposited(payer, commitment, AMOUNT, false);
        depositor.deposit(AMOUNT, commitment, PROOF);
        vm.stopPrank();
        assertEq(token.balanceOf(address(pool)), AMOUNT);
        assertEq(token.allowance(address(depositor), address(pool)), 0, "no allowance left over");
    }

    function test_tokens_sent_to_the_depositor_directly_do_not_block_deposits() public {
        token.mint(address(depositor), 7);
        bytes32 commitment = _field("note");
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, _sign(AMOUNT, commitment));
        assertEq(token.balanceOf(address(depositor)), 7, "the stray 7 stay; the deposit went through");
    }

    function test_a_rejected_shield_proof_moves_nothing() public {
        shieldVerifier.setAccept(false);
        bytes32 commitment = _field("note");
        ShaidaDepositor.Authorization memory auth = _sign(AMOUNT, commitment);
        vm.expectRevert(bytes4(keccak256("InvalidProof()")));
        depositor.depositWithAuthorization(payer, AMOUNT, commitment, PROOF, auth);
        assertEq(token.balanceOf(payer), 10e6);
        assertFalse(token.authorizationState(payer, depositor.authorizationNonce(commitment)), "signature unused");
    }

    function test_refuses_a_zero_amount() public {
        vm.expectRevert(ShaidaDepositor.ZeroAmount.selector);
        depositor.deposit(0, _field("note"), PROOF);
    }

    function _sign(uint256 value, bytes32 commitment) internal view returns (ShaidaDepositor.Authorization memory a) {
        a.validAfter = 0;
        a.validBefore = block.timestamp + 1 hours;
        (a.v, a.r, a.s) = Signing.signReceive(
            vm,
            payerKey,
            token.DOMAIN_SEPARATOR(),
            Signing.Auth({
                from: payer,
                to: address(depositor),
                value: value,
                validAfter: a.validAfter,
                validBefore: a.validBefore,
                nonce: depositor.authorizationNonce(commitment)
            })
        );
    }
}
