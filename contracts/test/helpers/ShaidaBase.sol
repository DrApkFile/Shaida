// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShieldPoolPoseidon} from "gloam/src/ShieldPoolPoseidon.sol";
import {IVerifier} from "gloam/src/interfaces/IVerifier.sol";
import {IPoseidon2, IPoseidon3} from "gloam/src/lib/IPoseidon.sol";
import {MockUSD8} from "../mocks/MockUSD8.sol";
import {PayerRegistry} from "../../src/PayerRegistry.sol";
import {ShaidaDepositor} from "../../src/ShaidaDepositor.sol";
import {ShaidaLedger} from "../../src/ShaidaLedger.sol";
import {IGloamPool} from "../../src/interfaces/IGloamPool.sol";

/// MockUSD8 plus the two FiatToken reads the depositor makes (D7). Flags only: the mock does not
/// enforce them, so these tests check that Shaida refuses on its own, before touching the token.
contract MockFiatToken is MockUSD8 {
    bool public paused;
    mapping(address => bool) public isBlacklisted;

    function setPaused(bool paused_) external {
        paused = paused_;
    }

    function setBlacklisted(address account, bool listed) external {
        isBlacklisted[account] = listed;
    }
}

/// Unit-test stand-in for a Groth16 verifier. Real proofs are tested in test/fork/ExitCheckFork.t.sol.
contract StubVerifier is IVerifier {
    bool public accept = true;

    function setAccept(bool accept_) external {
        accept = accept_;
    }

    function verify(bytes calldata, uint256[] calldata) external view returns (bool) {
        return accept;
    }
}

/// Deploys circomlibjs Poseidon from Gloam's fixtures (the same bytecode DeployStack deploys).
abstract contract PoseidonDeployer is Test {
    using stdJson for string;

    function _deployPoseidon(string memory name) internal returns (address addr) {
        bytes memory code =
            vm.readFile(string.concat("lib/gloam/contracts/test/fixtures/", name, ".json")).readBytes(".bytecode");
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "poseidon deploy failed");
    }
}

/// The real Gloam pool (unmodified) behind stub verifiers, plus the Shaida contracts.
abstract contract ShaidaBase is PoseidonDeployer {
    MockFiatToken internal token;
    StubVerifier internal shieldVerifier;
    StubVerifier internal spendVerifier;
    ShieldPoolPoseidon internal pool;
    IPoseidon2 internal poseidon2;
    IPoseidon3 internal poseidon3;
    PayerRegistry internal registry;
    ShaidaLedger internal ledger;
    ShaidaDepositor internal depositor;

    address internal attestor = makeAddr("attestor");
    address internal relayer = makeAddr("relayer");
    address internal payer;
    uint256 internal payerKey;
    address internal stranger;
    uint256 internal strangerKey;

    uint256 private _nonce;

    function setUp() public virtual {
        (payer, payerKey) = makeAddrAndKey("payer");
        (stranger, strangerKey) = makeAddrAndKey("stranger");
        token = new MockFiatToken();
        shieldVerifier = new StubVerifier();
        spendVerifier = new StubVerifier();
        poseidon2 = IPoseidon2(_deployPoseidon("Poseidon2"));
        poseidon3 = IPoseidon3(_deployPoseidon("Poseidon3"));

        pool = new ShieldPoolPoseidon(address(poseidon2), address(spendVerifier));
        pool.turnOnDepositLimits();
        pool.setShieldVerifier(address(shieldVerifier));
        pool.setDepositLimit(address(token), 100e6, 10_000e6);
        pool.endSetup();

        registry = new PayerRegistry(attestor);
        ledger = new ShaidaLedger(IGloamPool(address(pool)), registry, poseidon2, poseidon3);
        depositor = new ShaidaDepositor(IERC20(address(token)), IGloamPool(address(pool)));
    }

    function _register(address account) internal returns (uint32 id) {
        vm.prank(attestor);
        id = registry.register(account, keccak256(abi.encode("name", account)));
    }

    /// A transfer the stub verifier accepts: a known root, a fresh nullifier, fresh field-sized commitments.
    function _transfer() internal returns (ShaidaLedger.TransferArgs memory t) {
        t.proof = hex"01";
        t.root = pool.currentRoot();
        t.nullifier = _field("nullifier");
        t.newCommitments = [_field("c0"), _field("c1")];
    }

    function _field(string memory label) internal returns (bytes32) {
        uint256 bn254 = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
        return bytes32(uint256(keccak256(abi.encode(label, ++_nonce))) % bn254);
    }

    function _poseidon3(uint256 a, uint256 b, uint256 c) internal view returns (bytes32) {
        return bytes32(poseidon3.poseidon([a, b, c]));
    }
}
