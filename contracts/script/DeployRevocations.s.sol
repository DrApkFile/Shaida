// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IPoseidon2} from "gloam/src/lib/IPoseidon.sol";
import {Revocations} from "../src/Revocations.sol";

/**
 * Deploys Revocations (D35) next to an existing stack, over that stack's PoseidonT3. One create, nothing else:
 * no existing contract is touched or redeployed.
 *
 *   44005  (Aevum testnet): PoseidonT3 from deployments/aevum.json
 *   440050 (make fork):     PoseidonT3 from deployments/fork.json
 *
 * Refuses unless PoseidonT3 answers the circomlib vector, and unless the new contract answers saltOf(1) with the
 * poseidon-lite value (the browser's and the SDK's hash) and has nothing revoked. The address, tx, block and gas
 * are written to the deployment file by tools/write-revocations.mjs from the broadcast receipt.
 */
contract DeployRevocations is Script {
    using stdJson for string;

    uint256 internal constant AEVUM_TESTNET = 44005;
    uint256 internal constant AEVUM_FORK = 440050;
    /// circomlib Poseidon([1, 2]) (DeployChecks.POSEIDON_1_2).
    uint256 internal constant POSEIDON_1_2 = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;
    /// poseidon-lite poseidon2([4, 1]) (test RV05).
    uint256 internal constant SALT_OF_1 = 0x0c9d5facc929a65bc38007fe19281760a02ac15f4b85bff641d65d156d4c213d;

    function run() external returns (Revocations rev) {
        string memory file;
        if (block.chainid == AEVUM_TESTNET) file = "../deployments/aevum.json";
        else if (block.chainid == AEVUM_FORK) file = "../deployments/fork.json";
        else revert("DeployRevocations runs only on Aevum testnet (44005) or make fork (440050)");
        string memory json = vm.readFile(file);
        require(json.readUint(".chainId") == block.chainid, "deployment file is for another chain");
        address poseidon2 = json.readAddress(".contracts.PoseidonT3.address");
        require(poseidon2.code.length > 0, "PoseidonT3 has no code here: wrong RPC or deployment file?");
        require(IPoseidon2(poseidon2).poseidon([uint256(1), uint256(2)]) == POSEIDON_1_2, "PoseidonT3 wrong");

        vm.startBroadcast();
        rev = new Revocations(IPoseidon2(poseidon2));
        vm.stopBroadcast();

        require(address(rev.poseidon2()) == poseidon2, "Revocations wired to another Poseidon");
        require(rev.REVOKE_TAG() == 4, "REVOKE_TAG is not 4");
        require(rev.saltOf(1) == SALT_OF_1, "saltOf(1) differs from poseidon-lite");
        require(!rev.isRevoked(SALT_OF_1) && rev.revokedAt(SALT_OF_1) == 0, "a fresh Revocations has a revocation");
        console2.log("chainId     ", block.chainid);
        console2.log("PoseidonT3  ", poseidon2);
        console2.log("Revocations ", address(rev));
        console2.log("All checks passed: PoseidonT3 vector, saltOf(1) = poseidon-lite, nothing revoked.");
    }
}
