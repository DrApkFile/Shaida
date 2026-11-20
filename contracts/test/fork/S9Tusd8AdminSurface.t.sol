// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

/// tUSD8 as Circle's FiatTokenV2_2 exposes it (admin and EIP-3009 surface only).
interface IFiatToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function paused() external view returns (bool);
    function pauser() external view returns (address);
    function blacklister() external view returns (address);
    function owner() external view returns (address);
    function masterMinter() external view returns (address);
    function rescuer() external view returns (address);
    function isBlacklisted(address) external view returns (bool);
    function pause() external;
    function unpause() external;
    function blacklist(address) external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * Spike S9 (REALITY_SPIKES.md): what tUSD8's issuer can do to Shaida, measured on a fork of the
 * real token. The roles are read from the live chain; the attacks use them through vm.prank,
 * which only a fork allows. Nothing here needs funds or touches the real testnet.
 *
 * Run: make test-fork   (forge test --match-path 'test/fork/*' --fork-url https://rpc-test.qday.info)
 */
contract S9Tusd8AdminSurfaceTest is Test {
    IFiatToken internal constant TUSD8 = IFiatToken(0x456569838f1d43009A91ebA4263147Afd7233483);
    /// @dev FiatTokenProxy (zos AdminUpgradeabilityProxy) slots.
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;
    bytes32 internal constant ADMIN_SLOT = 0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b;
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    /// Stands in for the Gloam pool: a contract holding deposits that it later pays out.
    PoolStandIn internal pool;
    address internal payer;
    uint256 internal payerKey;
    address internal recipient;

    function setUp() public {
        assertEq(block.chainid, 44005, "run with --fork-url https://rpc-test.qday.info");
        pool = new PoolStandIn(TUSD8);
        (payer, payerKey) = makeAddrAndKey("payer");
        recipient = makeAddr("recipient");
        deal(address(TUSD8), payer, 10e6);
        deal(address(TUSD8), address(pool), 10e6);
    }

    function test_S9_reports_the_live_admin_roles() public view {
        address impl = address(uint160(uint256(vm.load(address(TUSD8), IMPLEMENTATION_SLOT))));
        address proxyAdmin = address(uint160(uint256(vm.load(address(TUSD8), ADMIN_SLOT))));
        console2.log("block              ", block.number);
        console2.log("implementation     ", impl);
        console2.log("proxy admin        ", proxyAdmin);
        console2.log("proxy admin code   ", proxyAdmin.code.length);
        console2.log("owner              ", TUSD8.owner());
        console2.log("pauser             ", TUSD8.pauser());
        console2.log("blacklister        ", TUSD8.blacklister());
        console2.log("masterMinter       ", TUSD8.masterMinter());
        console2.log("rescuer            ", TUSD8.rescuer());
        console2.log("paused             ", TUSD8.paused());
        assertGt(impl.code.length, 0, "implementation has code");
        assertTrue(TUSD8.pauser() != address(0), "a pauser exists");
        assertTrue(TUSD8.blacklister() != address(0), "a blacklister exists");
        assertFalse(TUSD8.paused(), "token is live, not paused");
    }

    function test_S9_transfers_move_the_exact_amount_no_fee() public {
        uint256 before = TUSD8.balanceOf(recipient);
        vm.prank(payer);
        TUSD8.transfer(recipient, 1_234_567);
        assertEq(TUSD8.balanceOf(recipient) - before, 1_234_567, "fee-on-transfer would break Gloam deposits");
    }

    function test_S9_pause_stops_deposits_payouts_and_gasless_pulls() public {
        vm.prank(TUSD8.pauser());
        TUSD8.pause();

        vm.prank(payer);
        vm.expectRevert(bytes("Pausable: paused"));
        TUSD8.approve(address(pool), 1e6);

        vm.expectRevert(bytes("Pausable: paused"));
        pool.payOut(recipient, 1e6);

        (uint8 v, bytes32 r, bytes32 s, bytes32 nonce) = _signReceive(1e6);
        vm.expectRevert(bytes("Pausable: paused"));
        pool.pullWithAuthorization(payer, 1e6, nonce, v, r, s);
    }

    function test_S9_unpause_restores_payouts() public {
        vm.prank(TUSD8.pauser());
        TUSD8.pause();
        vm.prank(TUSD8.pauser());
        TUSD8.unpause();
        pool.payOut(recipient, 1e6);
        assertEq(TUSD8.balanceOf(recipient), 1e6);
    }

    /// Measured 2026-11-20: approve() by a blacklisted account SUCCEEDS on this tUSD8 (it does not
    /// carry the notBlacklisted guard on approve). The refusal comes at the pull, so Shaida must
    /// check isBlacklisted up front instead of relying on approve to fail.
    function test_S9_blacklisted_payer_can_still_approve_but_every_pull_reverts() public {
        vm.prank(TUSD8.blacklister());
        TUSD8.blacklist(payer);
        assertTrue(TUSD8.isBlacklisted(payer));

        vm.prank(payer);
        assertTrue(TUSD8.approve(address(pool), 1e6), "approve is not blocked by the blacklist");

        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        pool.pullApproved(payer, 1e6);

        (uint8 v, bytes32 r, bytes32 s, bytes32 nonce) = _signReceive(1e6);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        pool.pullWithAuthorization(payer, 1e6, nonce, v, r, s);
        assertEq(TUSD8.balanceOf(payer), 10e6, "nothing moved");
    }

    function test_S9_blacklisted_pool_freezes_every_payout() public {
        vm.prank(TUSD8.blacklister());
        TUSD8.blacklist(address(pool));

        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        pool.payOut(recipient, 1e6);
        assertEq(TUSD8.balanceOf(address(pool)), 10e6, "funds stay stuck in the pool");
    }

    function test_S9_blacklisted_recipient_cannot_be_paid_out() public {
        vm.prank(TUSD8.blacklister());
        TUSD8.blacklist(recipient);

        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        pool.payOut(recipient, 1e6);
    }

    function test_S9_proxy_admin_can_swap_the_token_code() public {
        address proxyAdmin = address(uint160(uint256(vm.load(address(TUSD8), ADMIN_SLOT))));
        address newImpl = address(new PoolStandIn(TUSD8)); // any contract: the proxy only checks for code
        vm.prank(proxyAdmin);
        (bool ok,) = address(TUSD8).call(abi.encodeWithSignature("upgradeTo(address)", newImpl));
        assertTrue(ok, "proxy admin upgrades tUSD8 in one call");
        assertEq(address(uint160(uint256(vm.load(address(TUSD8), IMPLEMENTATION_SLOT)))), newImpl);
    }

    function _signReceive(uint256 value) internal view returns (uint8 v, bytes32 r, bytes32 s, bytes32 nonce) {
        nonce = keccak256(abi.encode(address(pool), "s9"));
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH, payer, address(pool), value, 0, block.timestamp + 1 hours, nonce
            )
        );
        (v, r, s) =
            vm.sign(payerKey, keccak256(abi.encodePacked("\x19\x01", TUSD8.DOMAIN_SEPARATOR(), structHash)));
    }
}

contract PoolStandIn {
    IFiatToken internal immutable token;

    constructor(IFiatToken token_) {
        token = token_;
    }

    function payOut(address to, uint256 amount) external {
        require(token.transfer(to, amount), "transfer returned false");
    }

    function pullApproved(address from, uint256 amount) external {
        require(token.transferFrom(from, address(this), amount), "transferFrom returned false");
    }

    function pullWithAuthorization(address from, uint256 value, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external
    {
        token.receiveWithAuthorization(from, address(this), value, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }
}
