// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {DualProofVerifier} from "gloam/src/verifiers/DualProofVerifier.sol";
import {ShieldVerifierFinal} from "gloam/src/verifiers/final/ShieldVerifierFinal.sol";
import {ShieldIVerifierFinal} from "gloam/src/verifiers/final/ShieldIVerifierFinal.sol";
import {UnshieldVerifierFinal} from "gloam/src/verifiers/final/UnshieldVerifierFinal.sol";
import {UnshieldIVerifierFinal} from "gloam/src/verifiers/final/UnshieldIVerifierFinal.sol";
import {TransferVerifierFinal} from "gloam/src/verifiers/final/TransferVerifierFinal.sol";
import {TransferIVerifierFinal} from "gloam/src/verifiers/final/TransferIVerifierFinal.sol";
import {PayerRegistry} from "../../src/PayerRegistry.sol";
import {ShaidaDepositor} from "../../src/ShaidaDepositor.sol";
import {ShaidaLedger} from "../../src/ShaidaLedger.sol";
import {IGloamPool} from "../../src/interfaces/IGloamPool.sol";
import {Signing} from "../Signing.sol";
import {PoseidonDeployer} from "../helpers/ShaidaBase.sol";

/**
 * PRD §11 step 1 exit check, on a fork of Aevum testnet with the REAL tUSD8 and Gloam's FINAL ceremony
 * verifiers: gasless deposit -> vouchedPay -> sweep, then the payer's clawback is refused.
 * Proofs come from test/fixtures/fork-flow.json (packages/gloam-fixtures, final keys, sha256-pinned);
 * they replay because the pool here is fresh, so its tree is the one the generator mirrored.
 *
 * Gas is printed two ways: `call` = execution gas of the call (forge lastCallGas); `tx` = call + 21,000
 * + calldata gas (16 per non-zero byte, 4 per zero byte), which is what a legacy tx's gasUsed adds up to.
 *
 * Run: make test-fork
 */
contract ExitCheckForkTest is PoseidonDeployer {
    using stdJson for string;

    IERC20 internal constant TUSD8 = IERC20(0x456569838f1d43009A91ebA4263147Afd7233483);
    bytes4 internal constant ALREADY_SPENT = bytes4(keccak256("AlreadySpent()"));

    ShieldPoolPoseidon internal pool;
    PayerRegistry internal registry;
    ShaidaLedger internal ledger;
    ShaidaDepositor internal depositor;
    string internal fx;

    address internal attestor = makeAddr("attestor");
    address internal relayer = makeAddr("relayer");
    address internal recipient = makeAddr("recipient");
    address internal payer;
    uint256 internal payerKey;

    function setUp() public {
        assertEq(block.chainid, 44005, "run with --fork-url https://rpc-test.qday.info");
        fx = vm.readFile("test/fixtures/fork-flow.json");
        assertEq(fx.readAddress(".asset"), address(TUSD8));
        (payer, payerKey) = makeAddrAndKey("payer (Acme Studio, demo)");

        IPoseidon2 p2 = IPoseidon2(_deployPoseidon("Poseidon2"));
        IPoseidon3 p3 = IPoseidon3(_deployPoseidon("Poseidon3"));
        ShieldIVerifierFinal shieldV = new ShieldIVerifierFinal(new ShieldVerifierFinal());
        DualProofVerifier dual = new DualProofVerifier(
            new UnshieldIVerifierFinal(new UnshieldVerifierFinal()),
            new TransferIVerifierFinal(new TransferVerifierFinal())
        );
        pool = new ShieldPoolPoseidon(address(p2), address(dual));
        pool.turnOnDepositLimits();
        pool.setShieldVerifier(address(shieldV));
        pool.setDepositLimit(address(TUSD8), 100e6, 10_000e6);
        pool.endSetup();

        registry = new PayerRegistry(attestor);
        ledger = new ShaidaLedger(IGloamPool(address(pool)), registry, p2, p3);
        depositor = new ShaidaDepositor(TUSD8, IGloamPool(address(pool)));

        vm.prank(attestor);
        assertEq(registry.register(payer, keccak256("Acme Studio (demo)")), uint32(fx.readUint(".payerId")));
        deal(address(TUSD8), payer, 10e6);
    }

    function test_EXIT_gasless_deposit_then_vouchedPay_then_sweep_on_real_tUSD8() public {
        uint256 amount = fx.readUint(".deposit.amount");

        // 1. Gasless deposit: the payer only signs; the relayer submits.
        bytes32 commitment = fx.readBytes32(".deposit.commitment");
        ShaidaDepositor.Authorization memory auth = _signDeposit(amount, commitment);
        bytes memory proof = fx.readBytes(".deposit.proof");
        vm.prank(relayer);
        depositor.depositWithAuthorization(payer, amount, commitment, proof, auth);
        _report(
            "depositWithAuthorization",
            abi.encodeCall(depositor.depositWithAuthorization, (payer, amount, commitment, proof, auth))
        );
        assertEq(TUSD8.balanceOf(address(pool)), amount, "real tUSD8 is in the pool");
        assertEq(TUSD8.balanceOf(payer), 10e6 - amount);

        // 2. Vouched pay from the registered payer: V leaf at ledger index 0.
        ShaidaLedger.TransferArgs memory pay = _args(".pay");
        assertTrue(pool.isKnownRoot(pay.root), "the pool tree matches the generator's");
        vm.prank(payer);
        assertEq(ledger.vouchedPay(pay), 0);
        _report("vouchedPay", abi.encodeCall(ledger.vouchedPay, (pay)));
        assertEq(ledger.currentRoot(), fx.readBytes32(".expected.ledgerRootAfterPay"), "V leaf matches off-chain");

        // 3. Sweep by the recipient: S leaf at ledger index 1.
        ShaidaLedger.TransferArgs memory sw = _args(".sweep");
        vm.prank(recipient);
        assertEq(ledger.sweep(sw), 1);
        _report("sweep", abi.encodeCall(ledger.sweep, (sw)));
        assertEq(ledger.currentRoot(), fx.readBytes32(".expected.ledgerRootAfterSweep"), "S leaf matches off-chain");
        assertEq(pool.currentRoot(), fx.readBytes32(".expected.poolRootAfterSweep"));
        assertTrue(ledger.isKnownRoot(ledger.currentRoot()));

        // 4. The payer still knows the payment note's secret, but after the sweep it is spent (A2).
        ShaidaLedger.TransferArgs memory claw = _args(".clawback");
        vm.expectRevert(ALREADY_SPENT);
        vm.prank(payer);
        pool.transfer(claw.proof, claw.root, claw.nullifier, claw.newCommitments);
        vm.expectRevert(ALREADY_SPENT);
        vm.prank(payer);
        ledger.sweep(claw);
        assertEq(ledger.nextIndex(), 2, "no leaf for the clawback");
    }

    function test_EXIT_a_tampered_payment_proof_is_refused_by_the_final_verifier() public {
        uint256 amount = fx.readUint(".deposit.amount");
        bytes32 commitment = fx.readBytes32(".deposit.commitment");
        vm.prank(relayer);
        depositor.depositWithAuthorization(
            payer, amount, commitment, fx.readBytes(".deposit.proof"), _signDeposit(amount, commitment)
        );
        ShaidaLedger.TransferArgs memory pay = _args(".pay");
        pay.newCommitments[0] = pay.newCommitments[1]; // redirect the payment note
        vm.expectRevert(bytes4(keccak256("InvalidProof()")));
        vm.prank(payer);
        ledger.vouchedPay(pay);
        assertEq(ledger.nextIndex(), 0);
    }

    /// Baseline for the ledger's overhead: the same payment proof sent to the Gloam pool directly
    /// (allowed by Gloam, but it leaves no vouch leaf, so the payment never counts).
    function test_GAS_baseline_same_payment_sent_to_the_pool_directly() public {
        uint256 amount = fx.readUint(".deposit.amount");
        bytes32 commitment = fx.readBytes32(".deposit.commitment");
        vm.prank(relayer);
        depositor.depositWithAuthorization(
            payer, amount, commitment, fx.readBytes(".deposit.proof"), _signDeposit(amount, commitment)
        );
        ShaidaLedger.TransferArgs memory pay = _args(".pay");
        vm.prank(payer);
        pool.transfer(pay.proof, pay.root, pay.nullifier, pay.newCommitments);
        _report(
            "pool.transfer (no ledger)",
            abi.encodeCall(pool.transfer, (pay.proof, pay.root, pay.nullifier, pay.newCommitments))
        );
        assertEq(ledger.nextIndex(), 0, "no vouch leaf without the ledger");
    }

    function _args(string memory key) internal view returns (ShaidaLedger.TransferArgs memory t) {
        t.proof = fx.readBytes(string.concat(key, ".proof"));
        t.root = fx.readBytes32(string.concat(key, ".root"));
        t.nullifier = fx.readBytes32(string.concat(key, ".nullifier"));
        bytes32[] memory c = fx.readBytes32Array(string.concat(key, ".newCommitments"));
        t.newCommitments = [c[0], c[1]];
    }

    function _signDeposit(uint256 amount, bytes32 commitment)
        internal
        view
        returns (ShaidaDepositor.Authorization memory a)
    {
        a.validBefore = block.timestamp + 1 hours;
        (a.v, a.r, a.s) = Signing.signReceive(
            vm,
            payerKey,
            _domainSeparator(),
            Signing.Auth({
                from: payer,
                to: address(depositor),
                value: amount,
                validAfter: 0,
                validBefore: a.validBefore,
                nonce: depositor.authorizationNonce(commitment)
            })
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        (bool ok, bytes memory out) = address(TUSD8).staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "DOMAIN_SEPARATOR failed");
        return abi.decode(out, (bytes32));
    }

    /// Reads the gas of the call just made. Must run before any other external call.
    function _report(string memory name, bytes memory calldata_) internal view {
        Vm.Gas memory g = vm.lastCallGas(); // forge 1.10 prints a rename notice; forge-std 1.9.6 has no lastFrameGas
        uint256 calldataGas;
        for (uint256 i = 0; i < calldata_.length; i++) {
            calldataGas += calldata_[i] == 0 ? 4 : 16;
        }
        console2.log(name);
        console2.log("  call gas", uint256(g.gasTotalUsed));
        console2.log("  tx gas  ", uint256(g.gasTotalUsed) + 21_000 + calldataGas);
    }
}
