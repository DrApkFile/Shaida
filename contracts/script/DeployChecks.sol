// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {IVerifier} from "gloam/src/interfaces/IVerifier.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {KeyCheckProofs} from "gloam/script/KeyCheckProofs.sol";
import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaDepositor} from "../src/ShaidaDepositor.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";
import {IncomeVerifier, IIncomeGroth16Verifier} from "../src/IncomeVerifier.sol";
import {Vm} from "forge-std/Vm.sol";

/// One income proof in snarkjs calldata order, read from a fixture file.
struct IncomeProof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256[7] signals;
}

/// Everything DeployStack deployed, and the read-back checks it must pass before anyone uses it.
struct Stack {
    address poseidon2;
    address poseidon3;
    address shieldVerifier;
    address dualVerifier;
    address pool;
    address payMemo;
    address registry;
    address ledger;
    address depositor;
    address incomeGroth16;
    address incomeVerifier;
}

library DeployChecks {
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    /// @dev circomlib Poseidon([1, 2]) and Poseidon([1, 2, 3]), computed with circomlibjs 0.1.7.
    uint256 internal constant POSEIDON_1_2 = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;
    uint256 internal constant POSEIDON_1_2_3 = 0x0e7732d89e6939c0ff03d5e58dab6302f3230e269dc5b968f725df34ab36d732;

    /// @dev Reads back from the chain; any mismatch fails the run. Do not use a stack that fails here.
    function check(Stack memory s, uint128 perDeposit, uint128 total, address attestor) internal view {
        checkWiring(s, perDeposit, total, attestor);
        require(PayerRegistry(s.registry).payerCount() == 0, "registry not empty");
        require(ShaidaLedger(s.ledger).nextIndex() == 0, "ledger not empty");
    }

    /// @dev The checks that stay true after the stack is in use (no emptiness checks); VerifyDeployment reruns these
    /// against a recorded deployment on the live chain.
    function checkWiring(Stack memory s, uint128 perDeposit, uint128 total, address attestor) internal view {
        require(IPoseidon2(s.poseidon2).poseidon([uint256(1), uint256(2)]) == POSEIDON_1_2, "PoseidonT3 wrong");
        require(
            IPoseidon3(s.poseidon3).poseidon([uint256(1), uint256(2), uint256(3)]) == POSEIDON_1_2_3,
            "PoseidonT4 wrong"
        );
        requireCeremonyKeys(s.dualVerifier, s.shieldVerifier);

        ShieldPoolPoseidon pool = ShieldPoolPoseidon(payable(s.pool));
        require(address(pool.poseidon2()) == s.poseidon2, "pool poseidon mismatch");
        require(address(pool.verifier()) == s.dualVerifier, "pool spend verifier mismatch");
        require(address(pool.shieldVerifier()) == s.shieldVerifier, "pool shield verifier mismatch");
        require(address(pool.sealedSwapVerifier()) == address(0), "sealed swaps must stay off");
        require(pool.depositLimitsOn(), "deposit limits off");
        require(!pool.setupMode(), "setup not ended");
        require(pool.withdrawFeeBps() == 0, "withdraw fee must be off");
        (uint128 per, uint128 cap) = pool.depositLimit(TUSD8);
        require(per == perDeposit && cap == total, "tUSD8 limit mismatch");
        require(s.payMemo.code.length > 0, "GloamPayMemo has no code");

        PayerRegistry registry = PayerRegistry(s.registry);
        require(registry.owner() == attestor, "registry attestor mismatch");
        ShaidaLedger ledger = ShaidaLedger(s.ledger);
        require(address(ledger.pool()) == s.pool, "ledger pool mismatch");
        require(address(ledger.registry()) == s.registry, "ledger registry mismatch");
        require(address(ledger.poseidon3()) == s.poseidon3, "ledger poseidon mismatch");
        ShaidaDepositor depositor = ShaidaDepositor(s.depositor);
        require(address(depositor.token()) == TUSD8, "depositor token mismatch");
        require(address(depositor.pool()) == s.pool, "depositor pool mismatch");
    }

    /// @dev The income verifier must be the ceremony's: it accepts a proof made with the final key and rejects a proof
    /// of the same public signals made with a throwaway key. Gas is set explicitly (snarkjs returns false when short).
    function requireIncomeKey(Stack memory s, IncomeProof memory finalKey, IncomeProof memory throwaway) internal view {
        IIncomeGroth16Verifier g = IIncomeGroth16Verifier(s.incomeGroth16);
        require(
            g.verifyProof{gas: 400_000}(finalKey.a, finalKey.b, finalKey.c, finalKey.signals),
            "income verifier rejects a final-key proof"
        );
        require(
            !g.verifyProof{gas: 400_000}(throwaway.a, throwaway.b, throwaway.c, throwaway.signals),
            "income verifier accepts a THROWAWAY-key proof"
        );
        IncomeVerifier v = IncomeVerifier(s.incomeVerifier);
        require(address(v.groth16()) == s.incomeGroth16, "IncomeVerifier groth16 mismatch");
        require(address(v.ledger()) == s.ledger, "IncomeVerifier ledger mismatch");
        require(v.asset() == uint256(uint160(TUSD8)), "IncomeVerifier asset is not tUSD8");
    }

    function readIncomeProof(Vm vm, string memory path) internal view returns (IncomeProof memory p) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/", path));
        uint256[] memory a = vm.parseJsonUintArray(json, ".a");
        uint256[] memory b0 = vm.parseJsonUintArray(json, ".b[0]");
        uint256[] memory b1 = vm.parseJsonUintArray(json, ".b[1]");
        uint256[] memory c = vm.parseJsonUintArray(json, ".c");
        uint256[] memory sig = vm.parseJsonUintArray(json, ".signals");
        require(a.length == 2 && b0.length == 2 && b1.length == 2 && c.length == 2 && sig.length == 7, "bad proof file");
        p.a = [a[0], a[1]];
        p.b = [[b0[0], b0[1]], [b1[0], b1[1]]];
        p.c = [c[0], c[1]];
        for (uint256 i = 0; i < 7; i++) {
            p.signals[i] = sig[i];
        }
    }

    // Source: gloamtrade/gloam contracts/script/MainnetDeploy.sol `_requireCeremonyKeys` (MIT, (c) 2026 Gloam).
    function requireCeremonyKeys(address dual, address shieldI) internal view {
        (bytes memory p, uint256[] memory pub) = KeyCheckProofs.shieldFinal();
        require(IVerifier(shieldI).verify(p, pub), "shield verifier rejects a final-key proof");
        (p, pub) = KeyCheckProofs.shieldDev();
        require(!IVerifier(shieldI).verify(p, pub), "shield verifier accepts a DEV-key proof");
        (p, pub) = KeyCheckProofs.unshieldFinal();
        require(IVerifier(dual).verify(p, pub), "unshield verifier rejects a final-key proof");
        (p, pub) = KeyCheckProofs.unshieldDev();
        require(!IVerifier(dual).verify(p, pub), "unshield verifier accepts a DEV-key proof");
        (p, pub) = KeyCheckProofs.transferFinal();
        require(IVerifier(dual).verify(p, pub), "transfer verifier rejects a final-key proof");
        (p, pub) = KeyCheckProofs.transferDev();
        require(!IVerifier(dual).verify(p, pub), "transfer verifier accepts a DEV-key proof");
    }
}
