// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {PayerRegistry} from "../src/PayerRegistry.sol";
import {ShaidaLedger} from "../src/ShaidaLedger.sol";
import {DeployChecks, Stack} from "./DeployChecks.sol";

/// @notice Read-only: reruns DeployStack's checks against a recorded deployment on the live chain, so the record is
/// checked by the chain itself and not by the deploy run's local simulation. Sends nothing; needs no key.
///   forge script script/VerifyDeployment.s.sol --rpc-url aevum
/// with DEPLOYMENT=../deployments/aevum.json, TUSD8_PER_DEPOSIT, TUSD8_TOTAL (set by `make verify-aevum`).
contract VerifyDeployment is Script {
    using stdJson for string;

    string internal constant INCOME_FINAL_PROOF = "script/fixtures/income-final-proof.json";
    string internal constant INCOME_THROWAWAY_PROOF = "test/fixtures/income/throwaway-proof.json";
    string[16] internal NAMES = [
        "PoseidonT3",
        "PoseidonT4",
        "ShieldVerifierFinal",
        "ShieldIVerifierFinal",
        "UnshieldVerifierFinal",
        "UnshieldIVerifierFinal",
        "TransferVerifierFinal",
        "TransferIVerifierFinal",
        "DualProofVerifier",
        "ShieldPoolPoseidon",
        "GloamPayMemo",
        "PayerRegistry",
        "ShaidaLedger",
        "ShaidaDepositor",
        "IncomeGroth16Verifier",
        "IncomeVerifier"
    ];

    function run() external view {
        string memory json = vm.readFile(vm.envString("DEPLOYMENT"));
        require(block.chainid == json.readUint(".chainId"), "RPC chain differs from the recorded chainId");
        require(DeployChecks.TUSD8.code.length > 0, "tUSD8 has no code here");
        for (uint256 i = 0; i < NAMES.length; i++) {
            address a = _addr(json, NAMES[i]);
            require(a.code.length > 0, string.concat(NAMES[i], " has no code"));
            console2.log(string.concat("code ok  ", NAMES[i]), a, a.code.length);
        }
        Stack memory s = Stack({
            poseidon2: _addr(json, "PoseidonT3"),
            poseidon3: _addr(json, "PoseidonT4"),
            shieldVerifier: _addr(json, "ShieldIVerifierFinal"),
            dualVerifier: _addr(json, "DualProofVerifier"),
            pool: _addr(json, "ShieldPoolPoseidon"),
            payMemo: _addr(json, "GloamPayMemo"),
            registry: _addr(json, "PayerRegistry"),
            ledger: _addr(json, "ShaidaLedger"),
            depositor: _addr(json, "ShaidaDepositor"),
            incomeGroth16: _addr(json, "IncomeGroth16Verifier"),
            incomeVerifier: _addr(json, "IncomeVerifier")
        });
        uint128 perDeposit = uint128(vm.envUint("TUSD8_PER_DEPOSIT"));
        uint128 total = uint128(vm.envUint("TUSD8_TOTAL"));
        DeployChecks.checkWiring(s, perDeposit, total, json.readAddress(".attestor"));
        console2.log("wiring ok: Gloam final keys accept/dev reject, deposit limits on, setup ended, Shaida wired");
        DeployChecks.requireIncomeKey(
            s,
            DeployChecks.readIncomeProof(vm, INCOME_FINAL_PROOF),
            DeployChecks.readIncomeProof(vm, INCOME_THROWAWAY_PROOF)
        );
        console2.log("income key ok: final-key proof accepted, throwaway-key proof rejected (gas 400000)");
        console2.log("block", block.number);
        console2.log("payers registered", PayerRegistry(s.registry).payerCount());
        console2.log("ledger leaves", ShaidaLedger(s.ledger).nextIndex());
    }

    function _addr(string memory json, string memory name) internal pure returns (address) {
        return json.readAddress(string.concat(".contracts.", name, ".address"));
    }
}
