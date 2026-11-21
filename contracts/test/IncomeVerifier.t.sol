// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IIncomeGroth16Verifier, ILedgerRoots, IncomeVerifier} from "../src/IncomeVerifier.sol";
import {ThrowawayIncomeVerifierA} from "./fixtures/income/ThrowawayIncomeVerifierA.sol";
import {ThrowawayIncomeVerifierB} from "./fixtures/income/ThrowawayIncomeVerifierB.sol";

/// Placeholder Groth16 verifier for the wrapper's own logic. Tests only; production uses the ceremony verifier.
contract PlaceholderIncomeGroth16 is IIncomeGroth16Verifier {
    bool public accept = true;

    function setAccept(bool accept_) external {
        accept = accept_;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[7] calldata)
        external
        view
        returns (bool)
    {
        return accept;
    }
}

contract LedgerRootsStub is ILedgerRoots {
    mapping(bytes32 => bool) public known;

    function setKnown(bytes32 root, bool isKnown) external {
        known[root] = isKnown;
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return known[root];
    }
}

contract IncomeVerifierTest is Test {
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 internal constant THRESHOLD = 2;

    LedgerRootsStub internal ledger;
    PlaceholderIncomeGroth16 internal placeholder;
    IncomeVerifier internal wrapped;

    IncomeVerifier.Proof internal proofA; // a real proof made with THROWAWAY key A
    uint256[7] internal signalsA;

    function setUp() public {
        ledger = new LedgerRootsStub();
        placeholder = new PlaceholderIncomeGroth16();
        wrapped = new IncomeVerifier(placeholder, ledger, TUSD8);

        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/income/throwaway-proof.json"));
        uint256[] memory a = vm.parseJsonUintArray(json, ".a");
        uint256[] memory b0 = vm.parseJsonUintArray(json, ".b[0]");
        uint256[] memory b1 = vm.parseJsonUintArray(json, ".b[1]");
        uint256[] memory c = vm.parseJsonUintArray(json, ".c");
        uint256[] memory s = vm.parseJsonUintArray(json, ".signals");
        proofA = IncomeVerifier.Proof([a[0], a[1]], [[b0[0], b0[1]], [b1[0], b1[1]]], [c[0], c[1]]);
        for (uint256 i = 0; i < 7; i++) {
            signalsA[i] = s[i];
        }
        ledger.setKnown(bytes32(signalsA[0]), true);
    }

    // --- wrapper logic, placeholder verifier ---

    function test_check_passes_for_a_known_root_tUSD8_and_an_accepted_proof() public view {
        assertTrue(wrapped.check{gas: 400_000}(proofA, signalsA));
    }

    function test_check_refuses_another_asset_with_AssetMismatch() public {
        uint256[7] memory s = signalsA;
        s[1] = uint256(uint160(TUSD8)) + 1;
        vm.expectRevert(abi.encodeWithSelector(IncomeVerifier.AssetMismatch.selector, s[1]));
        wrapped.check(proofA, s);
    }

    function test_check_refuses_a_root_the_ledger_never_had_with_UnknownRoot() public {
        ledger.setKnown(bytes32(signalsA[0]), false);
        vm.expectRevert(abi.encodeWithSelector(IncomeVerifier.UnknownRoot.selector, bytes32(signalsA[0])));
        wrapped.check(proofA, signalsA);
    }

    function test_check_reverts_ProofInvalid_where_the_verifier_returns_false() public {
        placeholder.setAccept(false);
        vm.expectRevert(IncomeVerifier.ProofInvalid.selector);
        wrapped.check(proofA, signalsA);
    }

    function test_check_refuses_to_start_short_of_gas_with_InsufficientGas_not_ProofInvalid() public view {
        (bool ok, bytes memory ret) =
            address(wrapped).staticcall{gas: 200_000}(abi.encodeCall(IncomeVerifier.check, (proofA, signalsA)));
        assertFalse(ok);
        assertEq(bytes4(ret), IncomeVerifier.InsufficientGas.selector);
    }

    function test_attest_emits_IncomeProofChecked_with_context_threshold_and_count() public {
        vm.expectEmit(true, false, false, true, address(wrapped));
        emit IncomeVerifier.IncomeProofChecked(signalsA[6], signalsA[2], signalsA[3]);
        assertTrue(wrapped.attest{gas: 420_000}(proofA, signalsA));
    }

    function test_attest_emits_nothing_for_a_refused_proof() public {
        placeholder.setAccept(false);
        vm.recordLogs();
        vm.expectRevert(IncomeVerifier.ProofInvalid.selector);
        wrapped.attest(proofA, signalsA);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_constructor_refuses_zero_addresses() public {
        vm.expectRevert(IncomeVerifier.ZeroAddress.selector);
        new IncomeVerifier(IIncomeGroth16Verifier(address(0)), ledger, TUSD8);
        vm.expectRevert(IncomeVerifier.ZeroAddress.selector);
        new IncomeVerifier(placeholder, ILedgerRoots(address(0)), TUSD8);
        vm.expectRevert(IncomeVerifier.ZeroAddress.selector);
        new IncomeVerifier(placeholder, ledger, address(0));
    }

    // --- real snarkjs verifiers from two THROWAWAY keys for the same circuit ---

    /// A generated verifier does not declare the interface; it has the same verifyProof signature.
    function _under(address generated) internal returns (IncomeVerifier) {
        return new IncomeVerifier(IIncomeGroth16Verifier(generated), ledger, TUSD8);
    }

    function test_a_throwaway_key_A_proof_verifies_under_key_A() public {
        IncomeVerifier underA = _under(address(new ThrowawayIncomeVerifierA()));
        assertTrue(underA.check{gas: 400_000}(proofA, signalsA));
    }

    function test_a_throwaway_key_A_proof_is_refused_by_key_B_verifier_with_ProofInvalid() public {
        IncomeVerifier underB = _under(address(new ThrowawayIncomeVerifierB()));
        vm.expectRevert(IncomeVerifier.ProofInvalid.selector);
        underB.check{gas: 400_000}(proofA, signalsA);
    }

    function test_X12_key_A_refuses_its_proof_with_the_threshold_raised() public {
        IncomeVerifier underA = _under(address(new ThrowawayIncomeVerifierA()));
        uint256[7] memory s = signalsA;
        s[THRESHOLD] += 1;
        vm.expectRevert(IncomeVerifier.ProofInvalid.selector);
        underA.check{gas: 400_000}(proofA, s);
    }

    /// The trap the wrapper exists for: a bare snarkjs verifier short of gas returns false, it does not revert.
    function test_a_bare_snarkjs_verifier_short_of_gas_returns_false_for_a_valid_proof() public {
        ThrowawayIncomeVerifierA bare = new ThrowawayIncomeVerifierA();
        assertTrue(bare.verifyProof(proofA.a, proofA.b, proofA.c, signalsA));
        (bool ok, bytes memory ret) =
            address(bare).staticcall{gas: 100_000}(abi.encodeCall(bare.verifyProof, (proofA.a, proofA.b, proofA.c, signalsA)));
        assertTrue(ok, "no revert");
        assertFalse(abi.decode(ret, (bool)), "returns false");
    }

    function test_GAS_verifyProof_fits_within_MIN_VERIFY_GAS() public {
        ThrowawayIncomeVerifierA bare = new ThrowawayIncomeVerifierA();
        uint256 before = gasleft();
        bool ok = bare.verifyProof(proofA.a, proofA.b, proofA.c, signalsA);
        uint256 used = before - gasleft();
        assertTrue(ok);
        console.log("verifyProof gas (7 public signals, throwaway key A):", used);
        // The call gets 63/64 of the gas left at the guard; keep a 10% margin above the measured cost.
        assertLt((used * 110) / 100, (wrapped.MIN_VERIFY_GAS() * 63) / 64);
    }
}
