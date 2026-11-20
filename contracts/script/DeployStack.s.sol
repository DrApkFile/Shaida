// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

// Gloam (MIT, (c) 2026 Gloam), pinned submodule at contracts/lib/gloam. Imported, never copied.
import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {GloamPayMemo} from "gloam/src/GloamPayMemo.sol";
import {IVerifier} from "gloam/src/interfaces/IVerifier.sol";
import {IPoseidon2} from "gloam/src/lib/IPoseidon.sol";
import {DualProofVerifier} from "gloam/src/verifiers/DualProofVerifier.sol";
import {ShieldVerifierFinal} from "gloam/src/verifiers/final/ShieldVerifierFinal.sol";
import {ShieldIVerifierFinal} from "gloam/src/verifiers/final/ShieldIVerifierFinal.sol";
import {UnshieldVerifierFinal} from "gloam/src/verifiers/final/UnshieldVerifierFinal.sol";
import {UnshieldIVerifierFinal} from "gloam/src/verifiers/final/UnshieldIVerifierFinal.sol";
import {TransferVerifierFinal} from "gloam/src/verifiers/final/TransferVerifierFinal.sol";
import {TransferIVerifierFinal} from "gloam/src/verifiers/final/TransferIVerifierFinal.sol";
import {KeyCheckProofs} from "gloam/script/KeyCheckProofs.sol";

/**
 * Deploys the Shaida stack on Aevum testnet (44005) or on `make fork` (440050), in one broadcast:
 *
 *   1. PoseidonT3 (circomlibjs bytecode from Gloam's fixture), checked against a known vector
 *   2. Gloam's FINAL ceremony verifiers + DualProofVerifier, refused unless they accept
 *      final-key proofs and reject dev-key proofs (DECISIONS D2)
 *   3. ShieldPoolPoseidon: deposit limits on, shield verifier set (plain shield() refused,
 *      deposits go through shieldBound), tUSD8 listed, setup ended
 *   4. GloamPayMemo
 *
 * Not built yet (PRD §11 step 1, still to do): PayerRegistry, ShaidaDepositor, ShaidaLedger.
 * IncomeVerifier waits for the ceremony (step 3).
 *
 * Environment (all required; the Makefile sets them, nothing has a silent default):
 *   TUSD8_PER_DEPOSIT   pool deposit limit per deposit, tUSD8 base units (6 decimals)
 *   TUSD8_TOTAL         pool deposit limit in total, tUSD8 base units
 *
 * Addresses, tx hashes and blocks are written to deployments/ by tools/write-deployment.mjs,
 * from the broadcast receipts, never from this script's simulation.
 */
contract DeployStack is Script {
    using stdJson for string;

    uint256 internal constant AEVUM_TESTNET = 44005;
    uint256 internal constant AEVUM_FORK = 440050;
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    string internal constant POSEIDON2_FIXTURE = "lib/gloam/contracts/test/fixtures/Poseidon2.json";
    /// @dev circomlib Poseidon([1, 2]), the reference vector from circomlibjs' own tests.
    uint256 internal constant POSEIDON_1_2 =
        0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;

    struct Stack {
        address poseidon2;
        address shieldVerifier;
        address dualVerifier;
        address pool;
        address payMemo;
    }

    function run() external returns (Stack memory s) {
        require(
            block.chainid == AEVUM_TESTNET || block.chainid == AEVUM_FORK,
            "DeployStack runs only on Aevum testnet (44005) or make fork (440050)"
        );
        require(TUSD8.code.length > 0, "tUSD8 has no code here: wrong RPC?");
        uint128 perDeposit = _envUint128("TUSD8_PER_DEPOSIT");
        uint128 total = _envUint128("TUSD8_TOTAL");
        require(perDeposit > 0 && perDeposit <= total, "need 0 < TUSD8_PER_DEPOSIT <= TUSD8_TOTAL");

        bytes memory poseidonCode = vm.readFile(POSEIDON2_FIXTURE).readBytes(".bytecode");

        vm.startBroadcast();
        s.poseidon2 = _create(poseidonCode);
        (s.dualVerifier, s.shieldVerifier) = _deployFinalVerifiers();
        ShieldPoolPoseidon pool = new ShieldPoolPoseidon(s.poseidon2, s.dualVerifier);
        // Limits on before the shield verifier, so no block exists where any deposit is accepted.
        pool.turnOnDepositLimits();
        pool.setShieldVerifier(s.shieldVerifier);
        pool.setDepositLimit(TUSD8, perDeposit, total);
        // Irreversible: later changes to verifiers or limits go through Gloam's timelock.
        pool.endSetup();
        s.pool = address(pool);
        s.payMemo = address(new GloamPayMemo());
        vm.stopBroadcast();

        _checkDeployed(s, perDeposit, total);
        _log(s);
    }

    function _create(bytes memory code) internal returns (address addr) {
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "PoseidonT3 deploy failed");
    }

    // Source: gloamtrade/gloam contracts/script/MainnetDeploy.sol `_deployVerifiers` (MIT, (c) 2026 Gloam).
    function _deployFinalVerifiers() internal returns (address dual, address shieldI) {
        ShieldIVerifierFinal shieldV = new ShieldIVerifierFinal(new ShieldVerifierFinal());
        UnshieldIVerifierFinal unshieldV = new UnshieldIVerifierFinal(new UnshieldVerifierFinal());
        TransferIVerifierFinal transferV = new TransferIVerifierFinal(new TransferVerifierFinal());
        dual = address(new DualProofVerifier(unshieldV, transferV));
        shieldI = address(shieldV);
    }

    /// @dev Read back from the chain; any mismatch fails the run. Do not use a stack that fails here.
    function _checkDeployed(Stack memory s, uint128 perDeposit, uint128 total) internal view {
        require(IPoseidon2(s.poseidon2).poseidon([uint256(1), uint256(2)]) == POSEIDON_1_2, "PoseidonT3 wrong");
        _requireCeremonyKeys(s.dualVerifier, s.shieldVerifier);

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
    }

    // Source: gloamtrade/gloam contracts/script/MainnetDeploy.sol `_requireCeremonyKeys` (MIT, (c) 2026 Gloam).
    function _requireCeremonyKeys(address dual, address shieldI) internal view {
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

    function _envUint128(string memory name) internal view returns (uint128) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint128).max, string.concat(name, " does not fit in uint128"));
        return uint128(raw);
    }

    function _log(Stack memory s) internal view {
        console2.log("chainId           ", block.chainid);
        console2.log("PoseidonT3        ", s.poseidon2);
        console2.log("ShieldIVerifier   ", s.shieldVerifier);
        console2.log("DualProofVerifier ", s.dualVerifier);
        console2.log("ShieldPoolPoseidon", s.pool);
        console2.log("GloamPayMemo      ", s.payMemo);
        console2.log("All checks passed: final keys, limits on, setup ended.");
    }
}
