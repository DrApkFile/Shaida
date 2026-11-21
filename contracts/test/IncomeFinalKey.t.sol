// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IncomeGroth16Verifier} from "../src/generated/IncomeGroth16Verifier.sol";
import {IncomeVerifier, IIncomeGroth16Verifier, ILedgerRoots} from "../src/IncomeVerifier.sol";
import {DeployChecks, IncomeProof, Stack} from "../script/DeployChecks.sol";
import {ThrowawayIncomeVerifierA} from "./fixtures/income/ThrowawayIncomeVerifierA.sol";

contract KnownRoots is ILedgerRoots {
    mapping(bytes32 => bool) public known;

    function setKnown(bytes32 root) external {
        known[root] = true;
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return known[root];
    }
}

/// The ceremony's final income verifier (contracts/src/generated/, from ceremony/finalize.ts) and the deploy-time
/// check DeployStack runs on it: final-key proof accepted, throwaway-key proof of the same signals rejected.
contract IncomeFinalKeyTest is Test {
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    IncomeGroth16Verifier internal finalV;
    KnownRoots internal roots;
    IncomeProof internal finalProof;
    IncomeProof internal throwawayProof;

    function setUp() public {
        finalV = new IncomeGroth16Verifier();
        roots = new KnownRoots();
        finalProof = DeployChecks.readIncomeProof(vm, "script/fixtures/income-final-proof.json");
        throwawayProof = DeployChecks.readIncomeProof(vm, "test/fixtures/income/throwaway-proof.json");
    }

    function _stack(address groth16, address verifier) internal view returns (Stack memory s) {
        s.incomeGroth16 = groth16;
        s.incomeVerifier = verifier;
        s.ledger = address(roots);
    }

    function test_K01_the_final_verifier_accepts_a_final_key_proof() public view {
        assertTrue(finalV.verifyProof{gas: 400_000}(finalProof.a, finalProof.b, finalProof.c, finalProof.signals));
    }

    function test_K02_the_final_verifier_rejects_a_throwaway_key_proof_of_the_same_signals() public view {
        for (uint256 i = 0; i < 7; i++) {
            assertEq(finalProof.signals[i], throwawayProof.signals[i]);
        }
        assertFalse(
            finalV.verifyProof{gas: 400_000}(throwawayProof.a, throwawayProof.b, throwawayProof.c, throwawayProof.signals)
        );
    }

    function test_K03_the_deploy_check_passes_for_the_final_verifier() public {
        IncomeVerifier v = new IncomeVerifier(IIncomeGroth16Verifier(address(finalV)), roots, TUSD8);
        this.requireIncomeKey(_stack(address(finalV), address(v)));
    }

    function test_K04_the_deploy_check_refuses_a_throwaway_verifier() public {
        ThrowawayIncomeVerifierA throwawayV = new ThrowawayIncomeVerifierA();
        IncomeVerifier v = new IncomeVerifier(IIncomeGroth16Verifier(address(throwawayV)), roots, TUSD8);
        vm.expectRevert(bytes("income verifier rejects a final-key proof"));
        this.requireIncomeKey(_stack(address(throwawayV), address(v)));
    }

    function test_K05_IncomeVerifier_over_the_final_key_checks_a_final_proof_on_a_known_root() public {
        IncomeVerifier v = new IncomeVerifier(IIncomeGroth16Verifier(address(finalV)), roots, TUSD8);
        roots.setKnown(bytes32(finalProof.signals[0]));
        IncomeVerifier.Proof memory p = IncomeVerifier.Proof(finalProof.a, finalProof.b, finalProof.c);
        assertTrue(v.check{gas: 400_000}(p, finalProof.signals));
        IncomeVerifier.Proof memory t = IncomeVerifier.Proof(throwawayProof.a, throwawayProof.b, throwawayProof.c);
        vm.expectRevert(IncomeVerifier.ProofInvalid.selector);
        v.check{gas: 400_000}(t, throwawayProof.signals);
    }

    function requireIncomeKey(Stack memory s) external view {
        DeployChecks.requireIncomeKey(s, finalProof, throwawayProof);
    }
}
