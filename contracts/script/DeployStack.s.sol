// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Gloam (MIT, (c) 2026 Gloam), pinned submodule at contracts/lib/gloam. Imported, never copied.
import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {GloamPayMemo} from "gloam/src/GloamPayMemo.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {DualProofVerifier} from "gloam/src/verifiers/DualProofVerifier.sol";
import {ShieldVerifierFinal} from "gloam/src/verifiers/final/ShieldVerifierFinal.sol";
import {ShieldIVerifierFinal} from "gloam/src/verifiers/final/ShieldIVerifierFinal.sol";
import {UnshieldVerifierFinal} from "gloam/src/verifiers/final/UnshieldVerifierFinal.sol";
import {UnshieldIVerifierFinal} from "gloam/src/verifiers/final/UnshieldIVerifierFinal.sol";
import {TransferVerifierFinal} from "gloam/src/verifiers/final/TransferVerifierFinal.sol";
import {TransferIVerifierFinal} from "gloam/src/verifiers/final/TransferIVerifierFinal.sol";

import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaDepositor} from "../src/ShaidaDepositor.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";
import {IncomeVerifier, IIncomeGroth16Verifier, ILedgerRoots} from "../src/IncomeVerifier.sol";
// Written by ceremony/finalize.ts from the final ceremony key (ceremony/record.json `final`). Never a throwaway key.
import {IncomeGroth16Verifier} from "../src/generated/IncomeGroth16Verifier.sol";
import {IGloamPool} from "../src/interfaces/IGloamPool.sol";
import {DeployChecks, Stack} from "./DeployChecks.sol";

/**
 * Deploys the Shaida stack on Aevum testnet (44005) or on `make fork` (440050), in one broadcast:
 *
 *   1. PoseidonT3 and PoseidonT4 (circomlibjs bytecode from Gloam's fixtures), checked against known vectors
 *   2. Gloam's FINAL ceremony verifiers + DualProofVerifier, refused unless they accept
 *      final-key proofs and reject dev-key proofs (DECISIONS D2)
 *   3. ShieldPoolPoseidon: deposit limits on, shield verifier set (plain shield() refused,
 *      deposits go through shieldBound), tUSD8 listed, setup ended (D8)
 *   4. GloamPayMemo
 *   5. PayerRegistry (owned by ATTESTOR), ShaidaLedger, ShaidaDepositor
 *   6. IncomeGroth16Verifier (the ceremony's final key) and IncomeVerifier over ShaidaLedger and tUSD8, refused
 *      unless the verifier accepts a final-key proof and rejects a throwaway-key proof of the same public signals
 *
 * Environment (all required; the Makefile sets them, nothing has a silent default):
 *   TUSD8_PER_DEPOSIT   pool deposit limit per deposit, tUSD8 base units (6 decimals)
 *   TUSD8_TOTAL         pool deposit limit in total, tUSD8 base units
 *   ATTESTOR            owner of PayerRegistry. On 44005 it must not be a public anvil account.
 *
 * Addresses, tx hashes and blocks are written to deployments/ by tools/write-deployment.mjs,
 * from the broadcast receipts, never from this script's simulation.
 */
contract DeployStack is Script {
    using stdJson for string;

    uint256 internal constant AEVUM_TESTNET = 44005;
    uint256 internal constant AEVUM_FORK = 440050;
    address internal constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    string internal constant FIXTURES = "lib/gloam/contracts/test/fixtures/";
    /// From packages/shaida-proofs/scripts/gen-final-fixture.ts (final key) and gen-verifier-fixtures.ts (throwaway A).
    string internal constant INCOME_FINAL_PROOF = "script/fixtures/income-final-proof.json";
    string internal constant INCOME_THROWAWAY_PROOF = "test/fixtures/income/throwaway-proof.json";
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    function run() external returns (Stack memory s) {
        require(
            block.chainid == AEVUM_TESTNET || block.chainid == AEVUM_FORK,
            "DeployStack runs only on Aevum testnet (44005) or make fork (440050)"
        );
        require(TUSD8.code.length > 0, "tUSD8 has no code here: wrong RPC?");
        uint128 perDeposit = _envUint128("TUSD8_PER_DEPOSIT");
        uint128 total = _envUint128("TUSD8_TOTAL");
        require(perDeposit > 0 && perDeposit <= total, "need 0 < TUSD8_PER_DEPOSIT <= TUSD8_TOTAL");
        address attestor = vm.envAddress("ATTESTOR");
        require(attestor != address(0), "ATTESTOR is zero");
        if (block.chainid == AEVUM_TESTNET) {
            require(!_isAnvilAccount(attestor), "ATTESTOR is a public anvil account. Use your own address.");
        }

        bytes memory poseidon2Code = vm.readFile(string.concat(FIXTURES, "Poseidon2.json")).readBytes(".bytecode");
        bytes memory poseidon3Code = vm.readFile(string.concat(FIXTURES, "Poseidon3.json")).readBytes(".bytecode");

        vm.startBroadcast();
        s.poseidon2 = _create(poseidon2Code);
        s.poseidon3 = _create(poseidon3Code);
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
        PayerRegistry registry = new PayerRegistry(attestor);
        s.registry = address(registry);
        s.ledger = address(
            new ShaidaLedger(IGloamPool(s.pool), registry, IPoseidon2(s.poseidon2), IPoseidon3(s.poseidon3))
        );
        s.depositor = address(new ShaidaDepositor(IERC20(TUSD8), IGloamPool(s.pool)));
        s.incomeGroth16 = address(new IncomeGroth16Verifier());
        s.incomeVerifier = address(
            new IncomeVerifier(IIncomeGroth16Verifier(s.incomeGroth16), ILedgerRoots(s.ledger), TUSD8)
        );
        vm.stopBroadcast();

        DeployChecks.check(s, perDeposit, total, attestor);
        DeployChecks.requireIncomeKey(
            s,
            DeployChecks.readIncomeProof(vm, INCOME_FINAL_PROOF),
            DeployChecks.readIncomeProof(vm, INCOME_THROWAWAY_PROOF)
        );
        _log(s);
    }

    function _create(bytes memory code) internal returns (address addr) {
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "Poseidon deploy failed");
    }

    // Source: gloamtrade/gloam contracts/script/MainnetDeploy.sol `_deployVerifiers` (MIT, (c) 2026 Gloam).
    function _deployFinalVerifiers() internal returns (address dual, address shieldI) {
        ShieldIVerifierFinal shieldV = new ShieldIVerifierFinal(new ShieldVerifierFinal());
        UnshieldIVerifierFinal unshieldV = new UnshieldIVerifierFinal(new UnshieldVerifierFinal());
        TransferIVerifierFinal transferV = new TransferIVerifierFinal(new TransferVerifierFinal());
        dual = address(new DualProofVerifier(unshieldV, transferV));
        shieldI = address(shieldV);
    }

    function _envUint128(string memory name) internal view returns (uint128) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint128).max, string.concat(name, " does not fit in uint128"));
        return uint128(raw);
    }

    // Source: qday-io/aevum-starter-kit contracts/script/Deploy.s.sol `isAnvilAccount` (MIT, (c) 2026 PQA Labs).
    function _isAnvilAccount(address a) internal pure returns (bool) {
        for (uint32 i = 0; i < 10; i++) {
            if (vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)) == a) return true;
        }
        return false;
    }

    function _log(Stack memory s) internal view {
        console2.log("chainId           ", block.chainid);
        console2.log("PoseidonT3        ", s.poseidon2);
        console2.log("PoseidonT4        ", s.poseidon3);
        console2.log("ShieldIVerifier   ", s.shieldVerifier);
        console2.log("DualProofVerifier ", s.dualVerifier);
        console2.log("ShieldPoolPoseidon", s.pool);
        console2.log("GloamPayMemo      ", s.payMemo);
        console2.log("PayerRegistry     ", s.registry);
        console2.log("ShaidaLedger      ", s.ledger);
        console2.log("ShaidaDepositor   ", s.depositor);
        console2.log("IncomeGroth16     ", s.incomeGroth16);
        console2.log("IncomeVerifier    ", s.incomeVerifier);
        console2.log("All checks passed: final keys (Gloam and income), limits on, setup ended, Shaida contracts wired.");
    }
}
