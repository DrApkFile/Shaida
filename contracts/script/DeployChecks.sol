// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {IVerifier} from "gloam/src/interfaces/IVerifier.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {KeyCheckProofs} from "gloam/script/KeyCheckProofs.sol";
import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaDepositor} from "../src/ShaidaDepositor.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";

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
}

library DeployChecks {
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    /// @dev circomlib Poseidon([1, 2]) and Poseidon([1, 2, 3]), computed with circomlibjs 0.1.7.
    uint256 internal constant POSEIDON_1_2 = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;
    uint256 internal constant POSEIDON_1_2_3 = 0x0e7732d89e6939c0ff03d5e58dab6302f3230e269dc5b968f725df34ab36d732;

    /// @dev Reads back from the chain; any mismatch fails the run. Do not use a stack that fails here.
    function check(Stack memory s, uint128 perDeposit, uint128 total, address attestor) internal view {
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
        require(registry.payerCount() == 0, "registry not empty");
        ShaidaLedger ledger = ShaidaLedger(s.ledger);
        require(address(ledger.pool()) == s.pool, "ledger pool mismatch");
        require(address(ledger.registry()) == s.registry, "ledger registry mismatch");
        require(address(ledger.poseidon3()) == s.poseidon3, "ledger poseidon mismatch");
        require(ledger.nextIndex() == 0, "ledger not empty");
        ShaidaDepositor depositor = ShaidaDepositor(s.depositor);
        require(address(depositor.token()) == TUSD8, "depositor token mismatch");
        require(address(depositor.pool()) == s.pool, "depositor pool mismatch");
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
