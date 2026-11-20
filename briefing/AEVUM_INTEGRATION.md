# Aevum integration guide

Researched: 2026-11-20, commit `e87bcff10fbaffcc920df658b2fdf79b4586b277` of `https://github.com/qday-io/aevum-starter-kit` (branch `main`, latest commit at the time: "Docs: the ERC-8004 registry is not open for this challenge", 2026-11-20 04:37 +0800).

Reference implementation: the official Aevum Starter Kit. Target: QDay Aevum Testnet, chain 44005.

## How to read this file

Every claim carries a label:

| Label | Meaning |
|---|---|
| **verified in code** | I read the cited file and line in the kit at the commit above. |
| **verified by running** | I executed it in this container on 2026-11-20 and quote the output. |
| **docs only (unverified)** | The kit's prose asserts it; I did not execute or observe it. |
| **unclear** | I could not settle it; the text says where I looked. |

Paths are relative to the kit's repo root unless stated otherwise.

### What I ran, and what the results were

Toolchain: Node v22.23.5, pnpm 10.33.0, Foundry 1.5.1-stable (`b0a9dd9ced`, 2025-12-22). The kit pins `pnpm@10.8.1` and `node >=22` (`package.json:7-10`, **verified in code**).

| Command | Result |
|---|---|
| `git submodule update --init --recursive` | OK. `forge-std` at `v1.9.6`, `openzeppelin-contracts` at `v5.1.0` (exact tags). Matches `NOTICE.md:11-12`. |
| `pnpm install` | OK, 389 packages, 5.3 s. Warns: ignored build scripts `bufferutil`, `keccak`, `utf-8-validate`. |
| `make build` | OK. `forge build` + `✓ 4 bytecode blobs checked: Shanghai-safe.` Emits `forge lint` notes (naming, `asm-keccak256`, `unsafe-cheatcode`); they do not fail the build. |
| `make test` | OK. 11 passed, 0 failed (`test/Checkout.t.sol`), 27 ms. |
| `make test-fork` | OK. 3 passed, 0 failed (`test/fork/AevumFork.t.sol`), 5.4 s, against the live `https://rpc-test.qday.info`. |
| `make check` | OK, exit 0 (build + test + test-fork + `pnpm -r typecheck`). |
| `pnpm -r typecheck` | OK (`web`, `examples`). |
| `pnpm build` (`next build`) | OK on the **second** invocation. The first stops with `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability` and asks you to re-run. See Traps. |
| `make fork` → `make deploy-fork` → `make deal` | OK. Fork chain id `440050` on port 8555, ready in ~4 s. Deploy printed a throwaway deployer, `merchant 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, `token 0x4565...3483`. `make deal` printed a tUSD8 balance. |
| `make anvil` → `make deploy-local` → `make mint` | OK. Chain 31337, `MockUSD8` at `0x5FbDB2315678afecb367f032d93F642f64180aa3`, minted 100 (balance `100000000`). |
| `pnpm example check-setup` / `pay-gasless` / `read-payments` | All OK against the fork. The gasless example signed and relayed a real EIP-3009 authorization against the **real tUSD8** bytecode: `success in block 3628245`. |
| `next start` + POST `/api/relay` | OK. All seven validation rails and both rate limits fire as written (table in §4). |

Network note: this container's egress is filtered. `https://rpc-test.qday.info` was initially refused by the HTTPS proxy (`CONNECT tunnel failed, response 403`). I had the host allowed, after which everything above ran for real. Nothing in this file is a guessed test result. The one thing I could **not** separate from the proxy is WebSocket: see §5.

---

## 1. Network facts

| Fact | Value | Defined at | Label |
|---|---|---|---|
| Chain ID | `44005` | `packages/aevum/src/chain.ts:13` | **verified in code** |
| Chain ID (live) | `eth_chainId` → `0xabe5` = 44005 | — | **verified by running** |
| Chain name | `QDay Aevum Testnet` | `packages/aevum/src/chain.ts:14` | **verified in code** |
| RPC | `https://rpc-test.qday.info` | `chain.ts:17`; `Makefile:5` (`AEVUM_RPC`); `contracts/foundry.toml:17` (`[rpc_endpoints] aevum`); `.github/workflows/ci.yml:30`; `examples/.env.example:4` | **verified in code** |
| Explorer | `https://explorer-test.qday.info` | `chain.ts:20` and `chain.ts:59` (`links.explorer`) | **verified in code** |
| Explorer software | Blockscout (`/api/v2/stats` answers, `/api?module=contract&action=getsourcecode` answers) | — | **verified by running** |
| Gas token | tQDAY, 18 decimals | `chain.ts:15` (`nativeCurrency`) | **verified in code** |
| Gas price | `eth_gasPrice` → `0x3b9aca00` = exactly 1 gwei; head block `baseFeePerGas` = `0x7` | — | **verified by running** |
| EVM version | Shanghai | `contracts/foundry.toml:8` (`evm_version = "shanghai"`) | **verified in code** |
| EVM version (live) | head block carries `withdrawalsRoot` but **no** `blobGasUsed`, `excessBlobGas` or `parentBeaconBlockRoot` — Shanghai fields present, Cancun fields absent | — | **verified by running** |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | `chain.ts:23` | **verified in code** |
| Multicall3 (live) | `eth_getCode` → 3808 bytes | — | **verified by running** |
| Max `eth_getLogs` range | `MAX_LOG_RANGE = 1000n` | `chain.ts:56` | **verified in code** |
| Block time | 1.0645 s average over blocks 3,616,196 → 3,626,196 (10,645 s / 10,000 blocks). Explorer `/api/v2/stats` reports `average_block_time: 1010.0` ms | — | **verified by running** |
| Local fork chain ID | `440050` | `chain.ts:42` (`AEVUM_FORK_CHAIN_ID`), `chain.ts:46`; `Makefile:18` (`FORK_CHAIN`); `contracts/script/Deploy.s.sol:21` | **verified in code** |
| Local fork port / RPC | `8555` / `http://127.0.0.1:8555` | `chain.ts:51`; `Makefile:9-10` (`FORK_PORT`, `FORK_RPC`) | **verified in code** |
| Local fork live | chain id `440050`, head `3628240`, ready in ~4 s | — | **verified by running** |
| Plain anvil chain ID / RPC | `31337` / `http://127.0.0.1:8545` | `chain.ts:30,33`; `Makefile:6` (`LOCAL_RPC`); `Deploy.s.sol:20` | **verified in code** |
| Web faucet link | `https://faucet.qday.info/en` | `chain.ts:60` (`links.faucetWeb`) | **verified in code** |
| QDay guide link | `https://community.qday.io/guide/` | `chain.ts:61` (`links.docs`) | **verified in code** |
| Explorer URL helpers | `txUrl(hash)`, `addressUrl(address)` | `chain.ts:64-70` | **verified in code** |

### Why Shanghai matters

Cancun-only opcodes do not exist on Aevum: `BLOBHASH` (`0x49`), `BLOBBASEFEE` (`0x4a`), `TLOAD` (`0x5c`), `TSTORE` (`0x5d`), `MCOPY` (`0x5e`). The list is enumerated in `tools/check-shanghai.mjs:7` (**verified in code**). Code compiled for Cancun **deploys successfully and then reverts at runtime with `invalid opcode`** (`README.md:207`, `web/src/app/docs/page.tsx:330-331` — **docs only (unverified)**; I did not deploy Cancun bytecode to 44005).

Three defences, all in the kit:

1. `contracts/foundry.toml:7-8` pins `solc_version = "0.8.24"` and `evm_version = "shanghai"`. The comment at `foundry.toml:5-6` says never raise it to `cancun` (**verified in code**).
2. `make build` runs `node tools/check-shanghai.mjs contracts/out` (`Makefile:30-31`). The script walks real instructions, skipping PUSH immediates (`check-shanghai.mjs:28`) and the trailing CBOR metadata (`check-shanghai.mjs:22-23`), checks only artifacts whose `compilationTarget` starts with `src/` (`check-shanghai.mjs:38`), and exits 1 if it finds nothing to check (`check-shanghai.mjs:49-52`) (**verified in code**; output `✓ 4 bytecode blobs checked: Shanghai-safe.` — **verified by running**).
3. Both local chains are started with `--hardfork shanghai` (`Makefile:43`, `Makefile:46`). Plain `anvil --fork-url` would run Cancun and hide the problem (`README.md:208`, `docs/page.tsx:335-337` — **docs only (unverified)**).

`README.md:207` also says: avoid OpenZeppelin's `*Transient` contracts (**docs only (unverified)**).

---

## 2. tUSD8

| Fact | Value | Source | Label |
|---|---|---|---|
| Address | `0x456569838f1d43009A91ebA4263147Afd7233483` | `packages/aevum/src/contracts.ts:4` (`TUSD8_ADDRESS`); `contracts/script/Deploy.s.sol:19` (`AEVUM_TUSD8`); `contracts/test/fork/AevumFork.t.sol:18`; `Makefile:11` | **verified in code** |
| Decimals | `6` | `contracts.ts:5` (`TUSD8_DECIMALS`) | **verified in code** |
| Decimals (live) | `decimals()` → `6` | — | **verified by running** |
| `name()` | `tUSD8` | — | **verified by running** |
| `symbol()` | `tUSD8` | — | **verified by running** |
| `version()` | `2` | — | **verified by running** |
| EIP-712 domain | `{ name: "tUSD8", version: "2", chainId, verifyingContract }` — four fields, no `salt` | `contracts.ts:8-10` (`tusd8Domain`) | **verified in code** |
| `DOMAIN_SEPARATOR()` (live) | `0x7838e6c46f8f9874236c9747d9896552a03d22c7c3e701b198879de2cb658022` | — | **verified by running** |
| Domain correctness | The kit's `tusd8Domain(44005, TUSD8_ADDRESS)` reproduces that separator byte for byte | — | **verified by running** |
| `masterMinter()` (live) | `0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1` — equals `Makefile:13` (`TUSD8_MM`) | — | **verified by running** |
| Implementation shape | 1496 bytes of code: a proxy, not the logic contract. Described as "USDC-style (FiatTokenV2)" at `contracts.ts:3` | — | **verified by running** / **verified in code** |

### Which EIP-2612 and EIP-3009 functions the kit actually uses

| Function | In the kit's ABI | Called by kit code | Present on chain |
|---|---|---|---|
| `receiveWithAuthorization` | yes — `contracts.ts:26`; also declared as `IERC3009` in `contracts/src/Checkout.sol:9-19` | **yes**, and only through `Checkout.payWithAuthorization` (`Checkout.sol:77-79`) | yes (exercised by `make test-fork` and by `pay-gasless` on the fork) |
| `authorizationState(address,bytes32)` | yes — `contracts.ts:24`; `ITUSD8` at `AevumFork.t.sol:11` | only in the fork test's assertion (`AevumFork.t.sol:59`) | yes — `authorizationState(0x0,0x0)` returns `false` |
| `transferWithAuthorization` | yes — `contracts.ts:25` | **never called.** It exists in `MockUSD8` (`src/mocks/MockUSD8.sol:44`) and in the ABI only | not probed |
| `permit` (EIP-2612) | **no.** `erc20Abi` (`contracts.ts:12-21`) has no `permit` and no `nonces` | **never called.** `grep` for `permit` across `*.ts/*.tsx/*.sol/*.mjs` finds only prose | yes — `nonces(address)` answers `0`, so the token has the EIP-2612 surface |

**Correction to the kit's own prose:** `README.md:81` and `web/src/app/docs/page.tsx:169` describe tUSD8 as "EIP-2612 `permit`, EIP-3009 signed transfers". The token does expose `nonces` (**verified by running**), but **no code path in the kit uses `permit`** (**verified in code**, by exhaustive grep). If Shaida wants `permit`, you write that integration yourself; there is no kit helper for it.

Why `receiveWithAuthorization` and not `transferWithAuthorization`: `receiveWithAuthorization` requires `to == msg.sender`, so only the `Checkout` contract can consume the signature. Nobody can front-run the signature into a plain transfer that leaves the order unrecorded. Stated at `README.md:176` and `Checkout.sol:62-65`; the rule is enforced in the local stand-in at `MockUSD8.sol:72` (`if (to != msg.sender) revert CallerMustBePayee();`) (**verified in code**).

### Exactly how the kit builds and signs an authorization

**Types** (`packages/aevum/src/eip3009.ts:5-14`, **verified in code**):

```ts
export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
```

The matching typehash is `keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")` = `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8` (**verified by running**). The same string appears in `contracts/src/mocks/MockUSD8.sol:15-17` and `contracts/test/Signing.sol:8-10` (**verified in code**).

**Typed-data builder** (`eip3009.ts:32-39`, **verified in code**):

```ts
export function checkoutTypedData(chainId: number, token: Address, message: CheckoutAuthorization) {
  return { domain: tusd8Domain(chainId, token), types: receiveWithAuthorizationTypes,
           primaryType: "ReceiveWithAuthorization" as const, message };
}
```

Note the `verifyingContract` is the **token**, not the Checkout (`eip3009.ts:33` passes `token` into `tusd8Domain`). `to` inside the message is the Checkout (`eip3009.ts:19` comment, enforced on chain by `Checkout.sol:78` passing `address(this)`).

**Nonce scheme.** The signed `nonce` is not a counter. It is:

```solidity
function authorizationNonce(bytes32 orderId) public view returns (bytes32) {
    return keccak256(abi.encode(address(this), orderId));
}
```

`contracts/src/Checkout.sol:84-86` (**verified in code**). Callers read it from the chain rather than deriving it: `web/src/app/checkout/page.tsx:96`, `examples/src/pay-gasless.ts:25`, `contracts/test/fork/AevumFork.t.sol:50` (**verified in code**).

**`validAfter` / `validBefore` choices** (`eip3009.ts:41-45`, **verified in code**):

```ts
export function authorizationWindow(seconds = 600, nowMs = Date.now()) {
  const now = BigInt(Math.floor(nowMs / 1000));
  return { validAfter: 0n, validBefore: now + BigInt(seconds) };
}
```

- `validAfter = 0n` always. The comment at `eip3009.ts:41` gives the reason: the authorization is valid at once, so clock drift between the signer and the chain cannot reject it. On chain the check is `block.timestamp <= validAfter` → revert (`MockUSD8.sol:91`), so `0` can never trip it.
- `validBefore = now + 600` at both call sites that matter: `checkout/page.tsx:97` and `pay-gasless.ts:26` both call `authorizationWindow(600)` — a 10-minute window (**verified in code**). The UI tells the user "valid for 10 minutes" at `checkout/page.tsx:301`.
- The Solidity tests use `block.timestamp + 1 hours` instead (`Checkout.t.sol:88`, `AevumFork.t.sol:43`) (**verified in code**).
- The relayer independently refuses anything longer than 1 hour: `MAX_WINDOW_SECONDS = 3600n` (`web/src/app/api/relay/route.ts:37`, enforced at `route.ts:161`) (**verified in code**; **verified by running** — a `now+7200` request returned `400 {"error":"Signature window is too long (max 1 hour)."}`).

**Signing call sites**

| Where | Mechanism | Source |
|---|---|---|
| Browser | `signTypedData(config, { account: address, ...checkoutTypedData(appChain.id, token.address, {...}) })` | `web/src/app/checkout/page.tsx:98-101` |
| Node script | `buyer.signTypedData(checkoutTypedData(chain.id, token, {...}))`, then `parseSignature` → `v, r, s, yParity` | `examples/src/pay-gasless.ts:27-30` |
| Solidity test | manual digest: `keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))` then `vm.sign` | `contracts/test/Signing.sol:26-29` |

All three **verified in code**. The `v` recovery is defensive in both TS paths: `v !== undefined ? Number(v) : 27 + (yParity ?? 0)` (`pay-gasless.ts:39`, `route.ts:170`) — viem returns `yParity` rather than `v` for some signatures (**verified in code**).

---

## 3. `contracts/src/Checkout.sol` walkthrough

102 lines. `pragma solidity ^0.8.24`, `SPDX-License-Identifier: MIT` (lines 1-2). Imports `IERC20` and `SafeERC20` from OpenZeppelin v5.1.0 (lines 4-5). All **verified in code**.

### Storage

| Member | Line | Note |
|---|---|---|
| `struct Payment { address payer; uint64 paidAt; uint256 amount; }` | 33-37 | `payer` (20 bytes) + `paidAt` (8 bytes) share one slot; `amount` takes a second. Two slots per order. |
| `IERC20 public immutable token` | 39 | Immutable: no storage slot, set in the constructor. |
| `address public immutable merchant` | 40 | Immutable. **The merchant cannot be changed after deploy.** |
| `mapping(bytes32 orderId => Payment) private _payments` | 42 | Private; reachable only through `paymentOf` / `isPaid`. |

### Events and errors

```solidity
event Paid(bytes32 indexed orderId, address indexed payer, uint256 amount);   // line 44
error AlreadyPaid(bytes32 orderId);   // 46
error ZeroAmount();                   // 47
error ZeroAddress();                  // 48
```

`orderId` and `payer` are indexed, `amount` is not — so you can filter logs by order or by payer but not by amount. The kit uses the `payer` filter at `web/src/app/activity/page.tsx:43` and `examples/src/read-payments.ts:22` (**verified in code**).

The three errors are re-declared in the TypeScript ABI at `packages/aevum/src/contracts.ts:39-41`, which is what lets `viem` decode them; `web/src/lib/errors.ts:14-15` maps `AlreadyPaid` and `ZeroAmount` to user sentences (**verified in code**).

### Constructor

`Checkout.sol:50-54`: reverts `ZeroAddress` if either the token or the merchant is the zero address. Tested at `Checkout.t.sol:136-141` (**verified in code**; **verified by running**, `test_constructor_rejectsZeroAddress` passed).

### Path 1 — standard, buyer pays gas

```solidity
function pay(bytes32 orderId, uint256 amount) external {   // line 57
    _record(orderId, msg.sender, amount);
    token.safeTransferFrom(msg.sender, merchant, amount);
}
```

The buyer must `approve` first. The web app approves the **exact order total, never unlimited** (`checkout/page.tsx:127-132`, which also skips the approval when the allowance already covers it) (**verified in code**).

### Path 2 — gasless, EIP-3009

```solidity
function payWithAuthorization(
    bytes32 orderId, address from, uint256 amount,
    uint256 validAfter, uint256 validBefore,
    uint8 v, bytes32 r, bytes32 s
) external {                                               // line 66
    _record(orderId, from, amount);
    IERC3009(address(token)).receiveWithAuthorization(
        from, address(this), amount, validAfter, validBefore, authorizationNonce(orderId), v, r, s
    );
    token.safeTransfer(merchant, amount);
}
```

Three things to notice (all **verified in code**):

- `to` is hardcoded to `address(this)` (line 78). The caller cannot redirect the pull.
- The `nonce` is computed on chain as `authorizationNonce(orderId)` (line 78). It is **not** a caller-supplied parameter. A relayer cannot swap in a different order's nonce.
- Funds land on the Checkout and are forwarded in the same transaction (line 80). The contract holds no balance between calls.

### Why the nonce is `keccak256(address(this), orderId)`

EIP-3009 nonces are arbitrary 32-byte values, one-shot per authorizer, tracked in `authorizationState[from][nonce]`. Deriving the nonce from `(contract, orderId)` buys three properties:

1. **The signature is bound to one order.** Since `payWithAuthorization` recomputes the nonce from its `orderId` argument, submitting the signature with a different `orderId` changes the nonce, which changes the digest, which fails `ECDSA.recover`. Tested: `test_payWithAuthorization_signatureIsBoundToOrder` expects `MockUSD8.InvalidSignature` (`Checkout.t.sol:99-107`) (**verified by running**, passed).
2. **The amount is bound too**, because `value` is part of the signed struct. `test_payWithAuthorization_cannotChangeAmount` (`Checkout.t.sol:109-116`) expects `InvalidSignature` for `PRICE + 1` (**verified by running**, passed).
3. **It is domain-separated per deployment** by including `address(this)`. The same `orderId` signed for Checkout A is not a valid authorization for Checkout B, so two deployments cannot cannibalise each other's signatures.

`abi.encode` (not `encodePacked`) is used, so both arguments are padded to 32 bytes and no collision is possible between a short address and a long id (`Checkout.sol:85`) (**verified in code**).

### `_record` — the whole state machine

```solidity
function _record(bytes32 orderId, address payer, uint256 amount) private {   // line 96
    if (amount == 0) revert ZeroAmount();
    if (_payments[orderId].payer != address(0)) revert AlreadyPaid(orderId);
    _payments[orderId] = Payment({payer: payer, paidAt: uint64(block.timestamp), amount: amount});
    emit Paid(orderId, payer, amount);
}
```

Both entry points call `_record` **before** the token movement. That is checks-effects-interactions: the `AlreadyPaid` flag and the `Paid` event are written before any external call, so a reentrant token cannot double-record an order (**verified in code**). Replay is tested at `Checkout.t.sol:127-134` (**verified by running**, passed).

`isPaid` tests `_payments[orderId].payer != address(0)` (line 93) — so "paid" is really "has a recorded payer".

### What the contract deliberately does not do

| Not done | Evidence |
|---|---|
| **No price check.** The contract never learns what an order costs. `amount` is whatever the caller passes. | `Checkout.sol:29` doc comment: "The contract never decides the price. Your app must check that `amount` matches the order." The app-side price lives at `web/src/lib/order.ts:20-22` (`priceOf`). **verified in code** |
| **No payer restriction.** Anyone may pay anyone's order. | `pay` records `msg.sender`; `payWithAuthorization` records the `from` of a valid signature. No access control exists in the file. **verified in code** |
| **No access control at all.** No owner, no pause, no upgrade. | No `Ownable`, no modifiers in the file. **verified in code** |
| **No refunds, no withdraw.** Tokens sent directly to the contract are unrecoverable. | No `transfer` out except the forward inside the two pay paths. `README.md:191` states it. **verified in code** |
| **No merchant change.** Fixed at deploy. | `merchant` is `immutable` (line 40). **verified in code** |
| **No receipt-amount validation.** `isPaid` returns true for a 1-unit payment. | `isPaid` only checks `payer != address(0)` (line 93). **verified in code** |

### Security properties

| Property | Why it holds |
|---|---|
| One payment per `orderId`, ever | `_record` reverts `AlreadyPaid` on a non-zero `payer` (line 98). **verified by running** |
| Signature cannot be replayed | Two independent locks: `AlreadyPaid` in Checkout, and `authorizationState[from][nonce]` in the token (`MockUSD8.sol:93,97`). **verified in code / by running** |
| Signature cannot be retargeted to another order or amount | Nonce derived on chain + `value` in the signed struct. **verified by running** |
| Signature cannot be diverted into a plain transfer | `receiveWithAuthorization` requires `to == msg.sender` (`MockUSD8.sol:72`). **verified in code** |
| Expiry is enforced by the token | `block.timestamp >= validBefore` → `AuthorizationExpired` (`MockUSD8.sol:92`); tested at `Checkout.t.sol:118-125`. **verified by running** |
| Zero-amount payments impossible | `ZeroAmount` (line 97); tested `Checkout.t.sol:56-60`. **verified by running** |
| Non-standard ERC-20 return values handled | `SafeERC20` for both `safeTransferFrom` and `safeTransfer` (lines 31, 59, 80). **verified in code** |
| Reentrancy-safe ordering | State and event precede the external calls. **verified in code** |
| The contract never custodies funds | Pull-and-forward in one transaction (lines 77-80). **verified in code** |

### Known limits of this example contract

Straight from `README.md:187-191` and `web/src/app/docs/page.tsx:303-309` (**docs only** for the attack narrative, **verified in code** for the mechanism):

1. **Anyone can pay any order with any amount.** `pay(orderId, 1)` marks an order paid for 0.000001 tUSD8, and can front-run the real buyer, whose transaction then reverts `AlreadyPaid`. This is a griefing and a false-settlement vector.
   - Mitigation the kit ships: never trust `isPaid` alone. `web/src/app/receipts/[orderId]/page.tsx:54-55` computes `expected = parseUnits(priceOf(orderId), token.decimals)` and shows "Wrong amount" unless `p.amount === expected` (**verified in code**).
   - Mitigation the kit recommends for production: key payments by `keccak256(payer, orderId)`, or have the merchant sign each quote (`README.md:189`).
2. **Order ids must be unguessable.** Sequential invoice numbers can be claimed in advance. The app uses 32 random bytes: `crypto.getRandomValues(new Uint8Array(32))` then `keccak256` (`web/src/lib/order.ts:24-27`) (**verified in code**).
3. **Fixed merchant; stray tokens are stuck** (`README.md:191`).

**Gap worth knowing:** `README.md:196` and `docs/page.tsx:311-317` claim `Checkout.t.sol` has "every rule above as a test". It does not test the "anyone can pay any order, any amount" front-run — there is no test that a third party pays someone else's order, and no test of the amount mismatch (**verified in code**: the 11 test names in `Checkout.t.sol` cover approve/pay, double-pay, zero amount, missing approval, relayer submit, order binding, amount binding, expiry, replay, constructor, fuzz). The amount check is only exercised in the UI, untested. Write that test for Shaida.

### Measured gas (Foundry `--gas-report`, **verified by running**)

| Item | Gas | Against |
|---|---|---|
| `Checkout` deployment | 444,278 (deployed size 2,135 bytes) | — |
| `pay` | min 22,032 / avg 101,600 / max 107,328 (261 calls) | MockUSD8 |
| `payWithAuthorization` | min 26,324 / avg 90,092 / max 138,419 (6 calls) | MockUSD8 |
| `payWithAuthorization` | **161,354** gas, tx `type 0`, status 1 | **real tUSD8** on the fork |
| `authorizationNonce` | 443 | — |
| `paymentOf` | 4,853 | — |
| `isPaid` | 2,534 | — |
| Deploy script total (forge estimate) | 577,561 gas | fork |

At 1 gwei that puts a real gasless payment at ~0.00016 tQDAY and a deployment at ~0.00058 tQDAY, which is consistent with `README.md:94` ("well under 0.01 tQDAY") (**verified by running** for the gas, arithmetic mine).

---

## 4. The gasless relayer — `web/src/app/api/relay/route.ts`

208 lines. `export const runtime = "nodejs"` (line 35) — not Edge, because it needs `viem/accounts` (**verified in code**).

### Constants

| Constant | Value | Line | Overridable |
|---|---|---|---|
| `MAX_WINDOW_SECONDS` | `3600n` | 37 | no |
| `PER_IP_PER_MINUTE` | `10` | 38 | no |
| `PER_PAYER_PER_MINUTE` | `3` | 39 | no |
| `DAILY_TX_LIMIT` | `Number(process.env.RELAYER_DAILY_TX_LIMIT ?? 500)` | 40 | yes, env |
| `IN_FLIGHT_MS` | `120_000` | 41 | no |
| `LOCAL_CHAINS` | `{ 31337, 440050 }` | 42 | no |
| `isDev` | `process.env.NODE_ENV !== "production"` | 43 | — |

All **verified in code**.

### `GET /api/relay?chainId=…`

`route.ts:119-123`. Returns `{ enabled, relayer }`. `enabled` is `Boolean(account && net?.checkout)` — both a usable key and a configured Checkout are needed. No `chainId` means the default network (`networkFor`, line 113-116).

**verified by running:**

```
GET /api/relay?chainId=440050 -> {"enabled":true,"relayer":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}
GET /api/relay?chainId=44005  -> {"enabled":false,"relayer":null}
```

(44005 was false because `NEXT_PUBLIC_NETWORKS=fork` only.) The checkout page polls this and forces Standard mode when it is false (`web/src/app/checkout/page.tsx:52-59`, **verified in code**).

### `POST /api/relay` — the rails, in execution order

| # | Line | Check | Failure |
|---|---|---|---|
| 1 | 126 | per-IP rate limit, before anything else (including JSON parsing) | `429 Too many requests. Wait a minute.` |
| 2 | 128-133 | `req.json()` | `400 Invalid JSON.` |
| 3 | 136-137 | `networkFor(body.chainId)` — must be a network in `NEXT_PUBLIC_NETWORKS` | `400 This network isn't enabled in the app.` |
| 4 | 138-148 | a usable relayer key **and** a configured Checkout for that network | `503`. In dev the message names the missing env vars; in production it is the generic "Gasless mode isn't available right now." (`isDev` branch, line 142-146) |
| 5 | 150-158 | field shapes: `orderId` hex of length 66, `from` a valid address, `amount`/`validAfter`/`validBefore` matching `/^\d{1,78}$/` (`isUint`, line 109), `signature` hex | `400 Malformed payment request.` |
| 6 | 159 | `BigInt(amount) === parseUnits(priceOf(orderId), TUSD8_DECIMALS)` | `400 The amount doesn't match this order's price.` |
| 7 | 161 | `BigInt(validBefore) <= now + 3600` | `400 Signature window is too long (max 1 hour).` |
| 8 | 162 | per-payer rate limit (`payer:${from.toLowerCase()}`) | `429 Too many payments from this address. Wait a minute.` |
| 9 | 164-169 | `parseSignature(signature)` | `400 Invalid signature.` |
| 10 | 176-177 | `claimInFlight(`${chainId}:${orderId}`)` | `409 This order is already being submitted.` |
| 11 | 179-182 | on-chain `isPaid(orderId)` | `409 This order is already paid. Start a new order.` |
| 12 | 183-186 | `overDailyLimit()` | `503 The relayer reached its daily limit. Use Standard mode.` |
| 13 | 195 | `client.simulateContract(call)` | falls into the catch → `400 explain(e)` |
| 14 | 196 | `wallet.writeContract({ ...call, type: "legacy" })` | catch |

All **verified in code**. Every rail below **verified by running** (fork, chain 440050, `priceOf` = `1.05`):

| Request | Response |
|---|---|
| valid, 1.05 tUSD8 | `200 {"hash":"0xdb82d9c5…"}` |
| same order again, immediately | `409 {"error":"This order is already being submitted."}` |
| amount 0.000001 (dust) | `400 {"error":"The amount doesn't match this order's price."}` |
| `validBefore = now + 7200` | `400 {"error":"Signature window is too long (max 1 hour)."}` |
| `orderId: "0x1234"` | `400 {"error":"Malformed payment request."}` |
| `chainId: 44005` (not enabled) | `400 {"error":"This network isn't enabled in the app."}` |
| well-formed, signature from another order | `400 {"error":"The signature doesn't match this order or amount. Sign again."}` |
| 4th accepted payment from the same payer within a minute | `429 {"error":"Too many payments from this address. Wait a minute."}` |
| 11th POST from the same IP within a minute | `429 {"error":"Too many requests. Wait a minute."}` |

The "signature from another order" case is particularly worth noting: it is caught by `simulateContract` at line 195, which means a bad signature costs the relayer nothing on chain, and `explain()` turns the token's revert into one sentence (`web/src/lib/errors.ts:17`). **verified by running.**

### Validation detail: what is and is not checked

- The relayer **does not** verify the signature itself in JS. It relies on `simulateContract` (line 195) and the token's `ECDSA.recover`. So the recovered signer is never compared with `from` off-chain; if they differ, the simulation reverts (**verified in code**, **verified by running**).
- `validAfter` is accepted as any uint and forwarded unchecked (lines 154, 193). A caller could send `validAfter` far in the future; the simulation would revert with `AuthorizationNotYetValid` (**verified in code**).
- `amount` is compared against `priceOf(orderId)`, which in the kit is a constant `"1.05"` for every order (`web/src/lib/order.ts:20-22`). The comparison uses the hardcoded `TUSD8_DECIMALS` (6) rather than the token's live `decimals()` (line 159) (**verified in code**).
- There is no per-order signature deduplication beyond rails 10 and 11.

### Rate limiting and `TRUSTED_IP_HEADER`

`limited(bucket, max)` (`route.ts:65-74`): a `Map<string, number[]>` of timestamps, filtered to the last 60,000 ms on every call, so it is a true sliding window, not a fixed bucket. When the map exceeds 10,000 keys it prunes entries whose timestamps are all stale (line 70-72). It pushes the current timestamp **before** comparing, so the Nth call where N > max is the one rejected (**verified in code**; the IP limit tripping on the 11th POST — **verified by running**).

`overDailyLimit()` (`route.ts:78-85`): `sentToday` resets when `new Date().toISOString().slice(0, 10)` changes, i.e. on the **UTC** date boundary, not the host's local date (**verified in code**).

`claimInFlight(key)` (`route.ts:88-94`): sweeps entries older than 120 s, then refuses if the key is present. **It is only deleted on a failure path** — lines 180, 184, 200. On success the key stays for the full 120 s (**verified in code**). That is deliberate: a client that retries after a successful submit but before the transaction is mined gets a 409 instead of a second transaction.

`clientIp(req)` (`route.ts:101-107`), **verified in code**:

```ts
const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
if (trusted) return req.headers.get(trusted)?.split(",")[0]?.trim() || "unknown";
const xff = req.headers.get("x-forwarded-for");
if (xff) return xff.split(",").at(-1)?.trim() || "unknown";
return req.headers.get("x-real-ip")?.trim() || "unknown";
```

- With `TRUSTED_IP_HEADER` set: the **first** entry of that header. Correct, because the host sets the header and clients cannot prepend to it.
- Without it: the **last** entry of `X-Forwarded-For`. Correct for a single trusted reverse proxy that appends the peer address; a client-supplied `X-Forwarded-For` lands earlier in the list and is ignored.
- Falls back to `"unknown"` — i.e. one shared bucket for every unidentifiable caller, which fails closed into stricter limiting rather than looser.
- Recommended values: `x-vercel-forwarded-for` on Vercel, `cf-connecting-ip` behind Cloudflare (`route.ts:98-99`, `web/.env.example:38`).

### How it submits

```ts
const transport = http();                                      // line 172 — no URL
const client = createPublicClient({ chain: net.chain, transport });
const wallet = createWalletClient({ account, chain: net.chain, transport });
…
await client.simulateContract(call);                            // 195
const hash = await wallet.writeContract({ ...call, type: "legacy" });   // 196
sentToday++;                                                    // 197
return NextResponse.json({ hash });                             // 198
```

**verified in code.** Four things follow:

- `http()` with no argument uses `chain.rpcUrls.default.http[0]`, so the relayer always talks to the RPC baked into the chain definition (`packages/aevum/src/chain.ts:17` for Aevum, `:51` for the fork). There is no env var to point it elsewhere.
- `type: "legacy"` is hardcoded — type-0 transactions, matching `README.md:212`.
- No `gas`, `gasPrice` or `nonce` is set. viem estimates gas and fetches the gas price per call.
- **It returns as soon as the node accepts the transaction.** It never waits for a receipt. The browser does the waiting (`web/src/app/checkout/page.tsx:154`) (**verified in code**).

Nonce management: the account is created once per process and cached in a module-level variable with viem's `nonceManager` attached (`route.ts:47-54`):

```ts
cachedAccount = raw && isHex(key) && key.length === 66
  ? privateKeyToAccount(key, { nonceManager })
  : null;
```

The comment at `route.ts:45-46` explains why: one account per process lets the nonce manager hand out nonces to concurrent requests without two transactions colliding (**verified in code**).

### Errors, retries and unknown outcomes

`route.ts:199-207`, **verified in code**:

```ts
} catch (e) {
  inFlight.delete(flightKey);
  if (e instanceof BaseError && /insufficient funds/i.test(e.message)) {
    console.error("[relay] relayer is out of gas", account.address);
    return fail("The relayer is out of gas. Use Standard mode for now.", 503);
  }
  return fail(explain(e));
}
```

- **Retries: there are none.** `grep -rn "retry"` across the kit's own `*.ts/*.tsx/*.sol/*.mjs` returns nothing (**verified in code**). No resubmission, no gas bump, no backoff, no queue.
- **"Relayer out of gas" is disambiguated** from "buyer out of funds" — the comment at `route.ts:201` makes the point, and the 503 steers the user to Standard mode.
- **Unknown outcomes are not handled.** If `writeContract` resolves and then the transaction is dropped or reverts, the route has already returned `200 {hash}` and incremented `sentToday`. Nothing reconciles it. If `writeContract` throws *after* the node accepted the transaction (a socket error on the response), the catch deletes the in-flight key and returns a 400 while the transaction may still land. The client's `waitForTransactionReceipt` is the only thing that would notice, and only for the success case.
- `sentToday++` is after the await (line 197), so transactions that fail to submit do not consume the daily budget.
- The in-flight key being held for 120 s on success is the only idempotency guard. After 120 s, a duplicate submit is stopped by rail 11 (`isPaid`) if the first transaction has been mined, and by the simulation's `AlreadyPaid` revert otherwise.

### Key handling for `RELAYER_PRIVATE_KEY`

| Behaviour | Line | Label |
|---|---|---|
| Read from `process.env.RELAYER_PRIVATE_KEY`, trimmed; `0x` prefix added if absent | 50-51 | **verified in code** |
| Validated as `isHex` and exactly 66 characters | 52 | **verified in code** |
| Parsed once, cached in `cachedAccount`; `null` is cached for "absent or invalid", so a bad key is not re-parsed on every request | 47-53 | **verified in code** |
| Never logged. The only log line prints the relayer's **address**, not the key (line 203) | 203 | **verified in code** |
| Never returned to the browser except as an address, via `GET` (line 122) | 122 | **verified in code** |
| anvil's ten public default accounts are refused on any non-local chain | 57-61, using `isAnvilAccount` from `packages/aevum/src/anvil.ts:20-22` and the address list at `anvil.ts:7-18` | **verified in code** |
| Server-only: no `NEXT_PUBLIC_` prefix, so Next.js never inlines it into the bundle | `web/.env.example:27-33` | **verified in code** |
| Every `.env*` except `*.env.example` is gitignored | `.gitignore:7-9` | **verified in code** |

Note the asymmetry: an **anvil key** is refused on Aevum, but an anvil key is accepted on the fork and on local anvil (`LOCAL_CHAINS`, line 42). The deploy script applies the mirror-image rule to the **merchant**: `require(local || !isAnvilAccount(merchant))` (`contracts/script/Deploy.s.sol:30`) (**verified in code**).

### For Shaida: what to copy, and what to harden

Your relayer submits ZK-proof transactions of roughly 250k–1.8M gas each, against a shielded pool. That is 2–11× the 161k gas a tUSD8 gasless payment costs here (**verified by running**), and a verification failure is not detectable from a signature check.

**Copy as-is (the shape is right):**

| Element | Why |
|---|---|
| One route, one function, one contract. `route.ts:188-194` builds a single `call` object; the route can never forward an arbitrary transaction. | This is the single most important property. Keep it for every ZK entrypoint: one route per `deposit` / `transact` / `withdraw`, never a generic "submit this calldata". |
| `usable()` refusing public test keys off local chains (`route.ts:57-61`). | Cheap, catches a real mistake. |
| The in-flight claim keyed by a chain-scoped identifier (`route.ts:176`). | Adapt the key to the proof's nullifier or commitment, not an order id. |
| Simulate before send (`route.ts:195`). | For a ZK verifier this is the only cheap way to find out that a proof is invalid. Keep it, and treat a simulation failure as "reject, charge nothing". |
| `type: "legacy"` (`route.ts:196`). | Aevum-specific; keep it. |
| `isDev` gating of configuration details in error messages (`route.ts:141-146`). | Keep. Do not leak which env var is missing in production. |
| Returning `{hash}` and letting the client wait. | Fine for a UI, but see below. |
| Server-only env var, never `NEXT_PUBLIC_`. | Keep. |

**Harden before you rely on it:**

1. **Replace the transaction-count budget with a gas budget.** `DAILY_TX_LIMIT` counts transactions (`route.ts:40,84,197`). With 250k–1.8M gas per call, 500 transactions is a 7.2× spread in cost (125M–900M gas). Track cumulative `gasUsed` or tQDAY spent, and cap on that. Read the relayer's balance on a schedule and refuse below a floor.
2. **Set an explicit gas limit and reject proofs above it.** The route never passes `gas` (`route.ts:188-196`), so viem estimates per call. An attacker who can make `estimateGas` return a huge number gets you to sign a huge transaction. Pass `gas` explicitly, computed as `min(estimate * 1.2, YOUR_CEILING)`, and fail the request when the estimate exceeds the ceiling.
3. **Move the limits out of process memory.** `hits`, `day`/`sentToday` and `inFlight` are module-level maps (`route.ts:64, 76-77, 87`). The file says so at `route.ts:31-33`, and `README.md:150` repeats it for Vercel: each serverless instance has its own copy and loses it on a cold start. With 1.8M-gas transactions a bypassed daily cap is expensive fast. Use Redis (or your database) with an atomic increment, and make the in-flight claim a lock with a TTL.
4. **Make the simulation cost part of the rate limit.** Simulating a 1.8M-gas proof is real RPC work. `PER_IP_PER_MINUTE = 10` permits 18M gas of simulation per IP per minute at zero cost to the attacker. Either rate-limit before the simulation (the kit does: rail 1 precedes rail 13) *and* lower the limit, or require a cheap proof-of-work / session token first.
5. **Do not price-check with a hardcoded constant.** `priceOf` returns a fixed string (`web/src/lib/order.ts:20-22`) and the comparison hardcodes 6 decimals (`route.ts:159`). For a shielded pool the equivalent check is: do the proof's **public inputs** match what you are willing to pay gas for — this pool, this merkle root, this nullifier not yet spent, this recipient. Verify the public inputs server-side against your own state before you simulate.
6. **Add nonce and resubmission handling.** `nonceManager` (`route.ts:52`) serialises nonces within one process, which is correct, but there is no resubmission if a transaction is dropped. With 1.8M-gas transactions and a ~1.01 s block time (**verified by running**), a stuck nonce blocks every later submission. Add: wait for the receipt in a background job, resubmit the same nonce with a higher gas price after N blocks, and expose the state to the client. Consider a pool of relayer keys with a dispatcher so one stuck transaction does not halt the queue.
7. **Close the unknown-outcome hole.** Persist `(request id, nonce, hash, status)` before returning. On a submit error, check `eth_getTransactionCount` and the mempool before declaring failure, otherwise you will double-submit a proof whose first submission landed.
8. **Add an allowlist or authentication if your proofs are expensive.** The route is deliberately open ("Anyone on the internet can call this route, and every transaction it sends costs YOUR gas", `route.ts:23`). At 1.8M gas, open access is a funding drain. Gate on a signed session, a deposit, or a payer allowlist.
9. **Split the relayer key from everything else.** `README.md:143` and `web/.env.example:30-32` say: a fresh wallet holding only a little tQDAY. Keep that, and keep the sweeper's key separate from the relayer's.
10. **Log the hash, nonce and gas, not just errors.** The route logs only the out-of-gas case (`route.ts:203`). You will need an audit trail; the challenge's judging criteria name "audit trails" and "verifiable receipts" explicitly (`web/src/app/docs/page.tsx:454`).

---

## 5. Reading chain data

### `getLogsChunked` — `packages/aevum/src/logs.ts`

The only read helper in `packages/aevum`. Signature (`logs.ts:4-23`, **verified in code**):

```ts
export interface ChunkedLogsArgs<E extends AbiEvent> {
  address: Address;
  event: E;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock?: bigint;
  step?: bigint;                                      // default MAX_LOG_RANGE = 1000n
  onProgress?: (done: bigint, total: bigint) => void;
}
export async function getLogsChunked<E extends AbiEvent>(
  client: PublicClient, { address, event, args, fromBlock, toBlock, step = MAX_LOG_RANGE, onProgress }: ChunkedLogsArgs<E>,
): Promise<GetLogsReturnType<E>>
```

| Aspect | Behaviour | Line | Label |
|---|---|---|---|
| **Chunk size** | `step`, default `MAX_LOG_RANGE = 1000n` (`chain.ts:56`). Validated: `step < 1n \|\| step > 1000n` throws `step must be between 1 and 1000` | 22, 24 | **verified in code** |
| **Chunk bounds** | `[start, min(start + step - 1, end)]` — inclusive on both ends, so a full chunk spans 1,000 blocks and `toBlock - fromBlock` is **999** | 28-29 | **verified in code** |
| **Block pinning** | `const end = toBlock ?? await client.getBlockNumber()` — the head is resolved **once**, before the loop, so a chain advancing mid-scan cannot extend the range | 25 | **verified in code** |
| **Ordering** | Chunks are iterated low → high and results appended in order (`out.push(...logs)`). Within a chunk, viem returns the node's order. **No sort is applied.** So the result is ascending by block, assuming the RPC returns each chunk in order | 28-32 | **verified in code** |
| **Sequential, not parallel** | A plain `for` loop with `await` inside. The comment at `logs.ts:18-19` gives the reason: "Requests run one after another to stay friendly with the public RPC" | 28-31 | **verified in code** |
| **Retries** | **None.** No `try`/`catch`, no backoff. One failed chunk rejects the whole call and discards every chunk already fetched | 20-35 | **verified in code** |
| **Progress** | `onProgress(stop - fromBlock + 1n, total)` after each chunk, where `total = end - fromBlock + 1n` (or `0n` if `end < fromBlock`) | 26, 33 | **verified in code** |
| **Memory** | Everything accumulates in one array. No streaming, no cursor | 27, 32, 35 | **verified in code** |

### Is the kit consistent with your 2026-11-20 measurements?

**Your measurement 1: `eth_getLogs` over 1,000 blocks is rejected with "block range too large, max range: 1000".**

Confirmed, and I pinned the exact boundary (**verified by running**, head 3,626,196, with and without an `address` filter):

| `fromBlock`..`toBlock` | Blocks inclusive | `toBlock - fromBlock` | Result |
|---|---|---|---|
| 3,625,197..3,626,196 | 1,000 | 999 | `{"result":[]}` |
| 3,625,196..3,626,196 | 1,001 | 1000 | `{"result":[]}` |
| 3,625,195..3,626,196 | 1,002 | 1001 | `{"error":{"code":-32000,"message":"block range too large, max range: 1000"}}` |
| 3,625,192..3,626,196 | 1,005 | 1004 | same error |

So the node's rule is **`toBlock - fromBlock <= 1000`**, i.e. at most 1,001 blocks inclusive. The error string matches yours verbatim, including the code `-32000`.

**The kit is consistent, and conservative by one block.** `getLogsChunked` with the default `step = 1000n` sends `toBlock = start + 999`, a difference of 999 — one inside the limit. It will never trip the error. The prose everywhere ("at most 1,000 blocks per call": `chain.ts:8`, `chain.ts:55`, `logs.ts:11`, `logs.ts:17`, `README.md:209`, `web/src/app/page.tsx:186`, `activity/page.tsx:61`) describes the limit as a count of blocks rather than as a difference, which is off by one against the node's actual rule but errs in the safe direction. Nothing needs changing. If you ever raise `step`, note that `logs.ts:24` caps it at 1000 anyway.

Verified end to end: `pnpm example read-payments` over 5,001 blocks printed `scanned 1000/5001 … 5001/5001` — six requests, the last one a single block — and found the payment (**verified by running**).

**Your measurement 2: blocks arrive about every 1.01 s.**

Confirmed from two independent sources (**verified by running**):

- Timestamp difference over 10,000 blocks: 10,645 s → **1.0645 s** average (blocks 3,616,196 → 3,626,196, measured 2026-11-20).
- The explorer's own statistic: `GET https://explorer-test.qday.info/api/v2/stats` → `"average_block_time": 1010.0` (milliseconds) → **1.010 s**.

The kit itself **never states a block time** anywhere (**verified in code**, exhaustive grep). That matters for Shaida: 1.01 s means ~85,700 blocks a day, so a 1,000-block chunk covers ~17 minutes and a full-day backfill is ~86 sequential requests. A month is ~2,570 requests at ~1 request per round trip, sequentially. Plan your indexer around that: persist a cursor, do not re-scan from a deploy block on every page load.

### Other read helpers and read patterns in the kit

| Where | What | Label |
|---|---|---|
| `web/src/app/activity/page.tsx:36-49` | Pins `head = await client.getBlockNumber()`, computes `from = head - windowSize + 1n`, clamps it up to `net.deployBlock` if set, passes `toBlock: head`, then **`[...result].reverse()`** so the UI shows newest first | **verified in code** |
| `web/src/app/activity/page.tsx:13-17` | Window choices are 1,000 / 5,000 / 20,000 blocks; default 5,000 (line 28) → 1, 5 and 20 requests | **verified in code** |
| `examples/src/read-payments.ts:14-15` | `head` pinned; `fromBlock = FROM_BLOCK ?? (head > 5000n ? head - 5000n : 0n)`. Note `head - 5000n` is **5,001 blocks** inclusive, not 5,000 | **verified in code** / **verified by running** |
| `web/src/components/useToken.ts:25-34` | `useReadContracts` for `decimals` + `symbol` — wagmi batches these through Multicall3 because `chain.ts:23` declares it. `localAnvil` (`chain.ts:29-35`) declares **no** multicall3, so on `local` the same hook issues separate calls | **verified in code** |
| `web/src/components/useToken.ts:17-24` | Token address is read from `Checkout.token()` rather than assumed, falling back to `TUSD8_ADDRESS` off `local` | **verified in code** |
| `web/src/app/page.tsx:43` | `useBytecode` to prove a Checkout exists at the configured address | **verified in code** |
| `web/src/app/receipts/[orderId]/page.tsx:31-39` | `paymentOf(orderId)` plus `useTransactionReceipt` for the optional `?tx=` | **verified in code** |
| `web/src/app/receipts/[orderId]/page.tsx:57-62` | `parseEventLogs` over the receipt's logs, then matches **both** the emitting address and the `orderId` before showing any transaction detail. A mismatched `?tx=` is silently ignored (line 132-134) | **verified in code** |
| `examples/src/env.ts:33-39` | `connect()` probes `getChainId()` and picks `aevumTestnet` / `aevumFork` / `{...localAnvil, id}` from the answer, so scripts adapt to whichever RPC you point them at | **verified in code** / **verified by running** (printed `Aevum fork (local) (chain 440050)`) |

### No WebSocket

The kit never imports viem's `webSocket` transport and never calls `watchContractEvent`: `grep` for both across `*.ts/*.tsx` finds only the docs prose at `web/src/app/docs/page.tsx:346` (**verified in code**). Every transport is `http()` — `wagmi.ts:31`, `route.ts:172`, `examples/src/env.ts:35,38`.

I attempted `wss://rpc-test.qday.info` with viem's `webSocket` transport: it failed with "An unknown RPC error occurred" (**verified by running**). I cannot distinguish a server with no WebSocket endpoint from this container's proxy refusing the upgrade, so the claim at `README.md:76,210` that there is no WebSocket RPC stays **docs only (unverified)** as far as my evidence goes. Either way, the kit's approach — poll over HTTPS — is what works.

---

## 6. Wallet and network switching in the web app

### Chains offered

`web/src/lib/env.ts:23-48` declares three fixed network records, keyed `aevum` / `fork` / `local`, each with a `chain`, an optional `checkout`, an optional `deployBlock` and a `hasExplorer` flag (**verified in code**):

| Key | Label | Chain | Checkout env var | Deploy-block env var | `hasExplorer` |
|---|---|---|---|---|---|
| `aevum` | Aevum testnet | `aevumTestnet` (44005) | `NEXT_PUBLIC_CHECKOUT_AEVUM` | `NEXT_PUBLIC_DEPLOY_BLOCK_AEVUM` | `true` |
| `fork` | Local fork | `aevumFork` (440050) | `NEXT_PUBLIC_CHECKOUT_FORK` | `NEXT_PUBLIC_DEPLOY_BLOCK_FORK` | `false` |
| `local` | Local anvil | `localAnvil` (31337) | `NEXT_PUBLIC_CHECKOUT_LOCAL` | — (hardcoded `undefined`, `env.ts:45`) | `false` |

Addresses are validated with `isAddress` before use and silently dropped if invalid (`env.ts:19`); deploy blocks must match `/^\d+$/` (`env.ts:20`) (**verified in code**).

### The `NEXT_PUBLIC_NETWORKS` toggle

`env.ts:50-62` (**verified in code**):

```ts
const requested = (process.env.NEXT_PUBLIC_NETWORKS ?? "aevum")
  .split(",").map((k) => k.trim())
  .filter((k): k is NetworkKey => k in all);

export const networks: [Network, ...Network[]] = (() => {
  const keys = [...new Set(requested)];
  const list = (keys.length ? keys : (["aevum"] as NetworkKey[])).map((k) => all[k]);
  return list as [Network, ...Network[]];
})();

export const defaultNetwork = networks[0];
```

- Comma-separated, whitespace tolerated, unknown keys dropped, duplicates removed.
- **Order matters: the first entry is the default network.**
- Empty or all-invalid falls back to `["aevum"]`.
- The switcher UI only renders when more than one network is configured: `networks.length > 1` (`web/src/components/Header.tsx:47`) (**verified in code**).
- **Production warning, from the kit:** keep it to `aevum` online. With `fork` or `local` listed, a visitor gets a "Local fork" button that points at *their own* `127.0.0.1` (`README.md:135`, `web/src/app/docs/page.tsx:234-237`) (**docs only**, but the mechanism is `chain.ts:51` — **verified in code**).

### wagmi / viem configuration

`web/src/lib/wagmi.ts:26-32` (**verified in code**):

```ts
const chains = networks.map((n) => n.chain) as [Chain, ...Chain[]];

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<number, Transport>,
  ssr: true,
});
```

- Chains come straight from `NEXT_PUBLIC_NETWORKS`; a chain not listed is not in the config at all, which is why `POST /api/relay` with an unlisted `chainId` is rejected (`route.ts:136-137`).
- One `http()` transport per chain, no URL → each chain's own `rpcUrls.default.http[0]`. No WebSocket (§5).
- `ssr: true`, required because this is the Next.js App Router.

Connectors (`wagmi.ts:16-24`, **verified in code**): RainbowKit's `connectorsForWallets`. With `NEXT_PUBLIC_WC_PROJECT_ID` set → a "Popular" group of `metaMaskWallet`, `rabbyWallet`, `walletConnectWallet` plus a "More" group with `injectedWallet`. Without it → `injectedWallet` only, and `projectId` is the placeholder string `"not-set"` (`wagmi.ts:23`).

Provider stack (`web/src/app/providers.tsx:23-33`, **verified in code**): `WagmiProvider` → `QueryClientProvider` → `NetworkProvider` → `RainbowKitProvider`. `RainbowKitProvider` receives `initialChain={net.chain}` from the network context (`providers.tsx:14-20`), so the connect dialog targets the network the header has selected rather than always the first one.

### How chain 44005 gets added to the wallet (EIP-3085)

**The kit does not call `wallet_addEthereumChain` itself.** `grep` for `addEthereumChain`, `addChain` and `3085` across the repo returns nothing (**verified in code**). It delegates to wagmi:

`web/src/lib/network.tsx:63-85` (**verified in code**):

```ts
const select = useCallback(async (next: NetworkKey) => {
  const target = networkByKey(next);
  if (!target) return;
  setSwitchError(null);
  if (!isConnected || chainId === target.chain.id) {        // no wallet, or already there
    setKey(target.key); remember(target.key); return;
  }
  setSwitchingTo(target);
  try {
    // Adds the network to the wallet first if it doesn't know it yet.
    await switchChainAsync({ chainId: target.chain.id });
  } catch (e) {
    console.error("[network] switch failed", target.chain.id, e);
    setSwitchError(`Couldn't switch to ${target.label}: ${explain(e)}`);
  } finally { setSwitchingTo(null); }
}, [chainId, isConnected, switchChainAsync]);
```

`switchChainAsync` comes from wagmi's `useSwitchChain` (`network.tsx:4,40`). wagmi/viem issue `wallet_switchEthereumChain` and, on the wallet's "unrecognized chain" error, follow up with `wallet_addEthereumChain` built from the viem `Chain` object — which is why `chain.ts:12-26` must carry a correct `name`, `nativeCurrency`, `rpcUrls` and `blockExplorers`: those four fields are the EIP-3085 payload. The comment at `network.tsx:75` states the intent. **The EIP-3085 request itself lives in wagmi, not in this repo** — so treat "the app adds chain 44005 via EIP-3085" as **verified in code only to the extent that the kit relies on `useSwitchChain`**; I did not drive a real wallet.

`aevumFork` deliberately sets `blockExplorers: undefined` (`chain.ts:52`) so no explorer is advertised for a local chain (**verified in code**).

### Which network the app considers current

`NetworkProvider` (`web/src/lib/network.tsx:38-91`, **verified in code**):

1. Initial state is `defaultNetwork.key` (line 41).
2. On mount, a saved key is read from `localStorage["aevum-kit:network"]` (`STORAGE_KEY`, line 8; read at 45-52; written by `remember()`, 23-29). Every access is wrapped in `try`/`catch` because storage can be blocked in private mode (comments at lines 27, 50).
3. **When a wallet is connected and on a configured chain, the app follows the wallet** (lines 54-61): it sets the key from `networkByChainId(chainId)`, remembers it, and clears any switch state. The wallet is the source of truth.
4. `select(key)` asks the wallet to switch and the app only moves once the wallet has actually switched (the effect in step 3 fires on the new `chainId`). The comment at `network.tsx:35-36` names the reason: the app must never read one chain while the wallet signs on another.
5. `net` falls back to `defaultNetwork` if the key does not resolve (line 87).
6. `useNetwork()` throws if used outside the provider (lines 93-97).

Header UI (`web/src/components/Header.tsx`, **verified in code**): a `role="radiogroup"` of networks (47-64), disabled while a switch is pending (55); an info banner while waiting for the wallet (69-78); an error banner with the explained failure (79-85); and a "wrong network" banner with a Switch button when `isConnected && chainId !== net.chain.id && !switchingTo` (22, 86-97).

**The MetaMask duplicate-RPC trap is handled explicitly.** `web/src/lib/errors.ts:7-8` matches `same RPC endpoint as existing network for chain \w+ \('([^']*)'\)` against a recursively flattened error message (`fullMessage`, `errors.ts:30-36`) and returns: *"Your wallet already has a network ("…") using the same RPC address. Edit or remove that network in your wallet, then try again."* This is why `make fork` runs on port **8555** and not 8545 — `chain.ts:49-50` and `Makefile:7-8` both say MetaMask refuses two networks with the same RPC URL (**verified in code**).

Token visibility: `web/src/app/page.tsx:47-55` uses wagmi's `useWatchAsset` (EIP-747) to offer "Add tUSD8 to wallet", because wallets do not list tokens on custom networks by themselves (comment at lines 45-46) (**verified in code**).

---

## 7. Foundry and Hardhat setup

### `contracts/foundry.toml` — the whole file

**verified in code**:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
# Aevum runs the Shanghai EVM: no MCOPY, TSTORE/TLOAD or blob opcodes.
# Never raise this to "cancun", or contracts that pass tests will fail on chain.
solc_version = "0.8.24"
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200
remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/",
]

[rpc_endpoints]
aevum = "https://rpc-test.qday.info"
local = "http://127.0.0.1:8545"

[fmt]
line_length = 110
```

The two settings that are not optional: `evm_version = "shanghai"` and a `solc_version` whose default EVM target you have overridden. There is **no `[profile.*]` variant that relaxes this**, and no `cancun` anywhere in the repo (**verified in code**).

Note `[rpc_endpoints]` has no entry for the 8555 fork; the Makefile passes `--rpc-url http://127.0.0.1:8555` explicitly (`Makefile:10,55-60`) (**verified in code**).

### Hardhat

The kit contains **no Hardhat config** (`find . -name "hardhat.config*"` outside `node_modules` matches only `contracts/lib/openzeppelin-contracts/hardhat.config.js`, which belongs to the submodule) (**verified by running**). The guidance is prose only: set `evmVersion: "shanghai"` in the Solidity compiler settings and `hardfork: "shanghai"` for the Hardhat network (`README.md:297`, `web/src/app/docs/page.tsx:467-468`) (**docs only (unverified)**). If you use Hardhat for Shaida you also lose `tools/check-shanghai.mjs`'s integration with `make build` — the script itself is Foundry-agnostic only in that it reads a directory of JSON artifacts whose `metadata.settings.compilationTarget` key starts with `src/` (`check-shanghai.mjs:37-38`), which is a Foundry artifact shape. You would need to adapt it.

### How fork tests get tUSD8 balances

**Two different mechanisms. Do not confuse them.**

**(a) Inside Solidity tests: forge-std's `deal` cheatcode.** `contracts/test/fork/AevumFork.t.sol:40` and `:66` call `deal(address(TUSD8), buyer, 10e6)`, which writes the balance slot directly in the fork's memory. No minter, no transaction, no `make deal` required. The comment at `AevumFork.t.sol:14-15` says so: "No funds needed: `deal` writes a balance into the fork only." (**verified in code**; **verified by running** — `make test-fork` passed with no prior funding.)

**(b) For a wallet on a running `make fork` node: the `make deal` target.** `Makefile:72-81` (**verified in code**, **verified by running**):

```make
deal:
	@test -n "$(TO)" || (echo "Usage: make deal TO=0x... [AMOUNT=100]" && exit 1)
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@cast rpc anvil_setBalance $(TO) 0x8ac7230489e80000 --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_impersonateAccount $(TUSD8_MM) --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_setBalance $(TUSD8_MM) 0x56BC75E2D63100000 --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "configureMinter(address,uint256)" $(TUSD8_MM) 1000000000000000 --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "mint(address,uint256)" $(TO) $$(cast parse-units $(AMOUNT) 6) --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@echo "tUSD8 balance of $(TO): $$(cast call $(TUSD8) 'balanceOf(address)(uint256)' $(TO) --rpc-url $(FORK_RPC))"
```

Step by step:

1. Refuses to run unless `cast chain-id` returns 440050 — so it can never touch the real testnet (**verified by running**: `make deal … FORK_PORT=8545` printed "This only works on 'make fork'." and exited 1).
2. Gives `TO` `0x8ac7230489e80000` wei = **10 tQDAY** for gas.
3. Impersonates tUSD8's `masterMinter`, `0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1` (`Makefile:13`) — the same address the live token reports from `masterMinter()` (**verified by running**).
4. Funds the master minter with `0x56BC75E2D63100000` wei = 100 tQDAY so it can pay for its own calls.
5. `configureMinter(masterMinter, 1e15)` — makes the master minter its own minter with a 1,000,000,000 tUSD8 allowance (1e15 at 6 decimals).
6. `mint(TO, AMOUNT * 1e6)`; `AMOUNT` defaults to `100` (`Makefile:16`).
7. Prints the resulting balance.

**It mints on top of whatever the fork copied from the real testnet; it does not set a balance.** Measured: after one `make deal TO=0x7099…` the balance printed `9126000000` (9,126 tUSD8) — that address already held ~9,026 tUSD8 on the real testnet (**verified by running**). Do not assume `make deal` gives you exactly `AMOUNT`.

### How deployment works

`contracts/script/Deploy.s.sol:25-47` (**verified in code**):

```solidity
function run() external returns (Checkout checkout, address token) {
    vm.startBroadcast();
    (, address deployer,) = vm.readCallers();
    address merchant = vm.envOr("MERCHANT", deployer);
    bool local = block.chainid == ANVIL_CHAIN || block.chainid == FORK_CHAIN;
    require(local || !isAnvilAccount(merchant), "MERCHANT is a public anvil account. Use your own address.");

    if (AEVUM_TUSD8.code.length > 0) { token = AEVUM_TUSD8; }
    else {
        require(block.chainid == ANVIL_CHAIN, "tUSD8 not found on this chain. Check the RPC (Aevum testnet is 44005).");
        MockUSD8 mock = new MockUSD8();
        mock.mint(deployer, 1_000e6);
        token = address(mock);
    }
    checkout = new Checkout(IERC20(token), merchant);
    vm.stopBroadcast();
    console.log("chainId  ", block.chainid);  console.log("token    ", token);
    console.log("merchant ", merchant);       console.log("Checkout ", address(checkout));
}
```

Guards worth keeping:

- **Token discovery by code presence, not by chain id** (line 32). If tUSD8's bytecode is at the known address, use it — true on 44005 and on any fork of it. Otherwise it insists on chain 31337 before deploying a token anyone can mint (line 35). So pointing the script at an unknown chain stops rather than silently deploying a fake stablecoin (**verified in code**).
- **The anvil-merchant guard** (line 30) using `isAnvilAccount` (lines 49-54), which derives all ten addresses from the public mnemonic `"test test test test test test test test test test test junk"` (line 23) with `vm.deriveKey` + `vm.addr`. Payments to a public-key account on a real network are anyone's to take (**verified in code**).
- `MockUSD8` mints 1,000 tUSD8 to the deployer on first deploy (line 37).

### `make deploy-aevum ACCOUNT=…` and keystore usage

`Makefile:62-64` (**verified in code**):

```make
deploy-aevum:
	@test -n "$(ACCOUNT)" || (echo "Set ACCOUNT=<name>. Create one with: cast wallet import <name> --interactive" && exit 1)
	cd contracts && forge script script/Deploy.s.sol --rpc-url $(AEVUM_RPC) --broadcast --legacy --account $(ACCOUNT)
```

- `ACCOUNT` is required; the target fails fast with the exact command to create one (**verified by running**: `make deploy-aevum` with no `ACCOUNT` printed the hint and exited 1).
- `--account <name>` reads Foundry's **encrypted keystore**, created with `cast wallet import aevum-deployer --interactive` (`README.md:103`). The private key is pasted once; a password is entered per use. No key in a file, no key in shell history, no `PRIVATE_KEY` env var anywhere in the kit (**verified in code** — the kit has no `PRIVATE_KEY` variable at all; `examples/.env.example:11-12` uses `BUYER_KEY`/`RELAYER_KEY` for scripts, not for deployment).
- Find the address with `cast wallet address --account aevum-deployer` (`README.md:104`), then fund it from the faucet.
- `--legacy` forces type-0 transactions (`README.md:212`).

### The `MERCHANT` parameter

| Context | Default merchant | Source | Label |
|---|---|---|---|
| `make deploy-aevum` / `make deploy-local` | the deployer | `Deploy.s.sol:28` — `vm.envOr("MERCHANT", deployer)` | **verified in code** |
| `make deploy-fork` | **anvil account 0**, `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, *not* the throwaway deployer | `Makefile:60` — `MERCHANT=$${MERCHANT:-$(ANVIL_0)} forge script …` | **verified by running** (deploy printed `merchant 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) |
| Any | override with `MERCHANT=0x… make deploy-…` | `README.md:107` | **verified in code** |

That difference is easy to miss: on the fork the merchant is a public test account you hold the key to, so you can see the money arrive; on Aevum it is you.

### `make deploy-fork` and the throwaway deployer

`Makefile:51-60` (**verified in code**, **verified by running**). It asserts chain 440050, then:

```make
@DEPLOYER=$$(cast to-check-sum-address 0x$$(openssl rand -hex 20)); \
  cast rpc anvil_setBalance $$DEPLOYER 0x8ac7230489e80000 … && \
  cast rpc anvil_impersonateAccount $$DEPLOYER … && \
  echo "Deploying from throwaway address $$DEPLOYER (no private key exists for it)" && \
  cd contracts && MERCHANT=$${MERCHANT:-$(ANVIL_0)} forge script … --unlocked --sender $$DEPLOYER
```

The reason, from the comment at `Makefile:51-53`: deploying from a *public* anvil account would put the fork's Checkout at an address that **anyone holding that public key could claim on the real testnet** (same deployer, same nonce → same CREATE address). Randomising the deployer makes the fork's addresses unclaimable. Output observed: `Deploying from throwaway address 0x98910E791Edf6E5bD16F2bB00c72E5C193381dB4 (no private key exists for it)` (**verified by running**).

### Where deployments are recorded

| Artifact | Path | Label |
|---|---|---|
| Broadcast log (addresses, tx hashes, receipts) | `contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json` plus a timestamped `run-<ms>.json` per run | **verified by running** (`contracts/broadcast/Deploy.s.sol/440050/run-latest.json` and two `run-*.json`) |
| Sensitive values from the run | `contracts/cache/Deploy.s.sol/<chainId>/run-latest.json` (forge prints this path) | **verified by running** |
| Gitignore policy | `.gitignore:12-15`: `contracts/out/`, `contracts/cache/`, `contracts/broadcast/` — with the note at line 14 *"deployment logs (keep local runs out; `git add -f` the Aevum 44005 one if you want it in your repo)"* | **verified in code** |

So **nothing records your Aevum deployment in git by default.** For a submission that needs addresses and a commit link, either `git add -f contracts/broadcast/Deploy.s.sol/44005/run-latest.json` or write the addresses into your README. The web app learns the address only from `NEXT_PUBLIC_CHECKOUT_AEVUM` (`web/src/lib/env.ts:28`); there is no deployments registry file in the kit (**verified in code**).

### Contract verification

`forge verify-contract` is documented as **not working yet** (`README.md:116-121`, `web/src/app/docs/page.tsx:243-245`). The command, for when it returns:

```bash
forge verify-contract <address> src/Checkout.sol:Checkout --chain-id 44005 \
  --verifier blockscout --verifier-url https://explorer-test.qday.info/api/
```

Status of my own checks (**verified by running**): `GET https://explorer-test.qday.info/api/` returns HTTP 400; `GET /api/v2/smart-contracts/verification/config` **does** answer, reporting `"is_rust_verifier_microservice_enabled": true` and a long `solidity_compiler_versions` list; and `GET /api?module=contract&action=getsourcecode&address=<tUSD8>` returns `{"message":"OK","result":[{"Address":"0x4565…3483"}],"status":"1"}` — i.e. no `SourceCode` or `ABI`, so **tUSD8 itself is not verified on this explorer**. I could not test `forge verify-contract` end to end because that needs a contract deployed to 44005 from a funded key, which I do not have. Treat "verification is broken" as **docs only (unverified)**, with the nuance that the verifier config endpoint is live. See Open questions.

---

## 8. Every make target and pnpm script

### Make targets (`Makefile`)

| Target | Line | What it does | When to use it |
|---|---|---|---|
| `make help` | 22-23 | Greps `## ` comments out of the Makefile and prints the target list. It is `.DEFAULT_GOAL` (line 3), so bare `make` prints help. | Any time. |
| `make install` | 25-27 | `git submodule update --init --recursive` then `pnpm install`. | Once after cloning. Again after a submodule bump. **verified by running** |
| `make build` | 29-31 | `cd contracts && forge build`, then `node tools/check-shanghai.mjs contracts/out`. | Before every deploy. The Shanghai gate is the point. **verified by running** |
| `make test` | 33-34 | `forge test --no-match-path 'test/fork/*' -vv`. No network. | The fast inner loop. 11 tests, ~27 ms. **verified by running** |
| `make test-fork` | 36-37 | `forge test --match-path 'test/fork/*' --fork-url https://rpc-test.qday.info -vv`. | To check your contract against the **real** tUSD8 without spending anything. Needs the RPC. **verified by running** |
| `make check` | 39-40 | `build test test-fork` then `pnpm -r typecheck`. | Before pushing. Note it **requires network** because of `test-fork`. CI additionally runs `pnpm build` (`.github/workflows/ci.yml:43`). **verified by running**, exit 0 |
| `make anvil` | 42-43 | `anvil --hardfork shanghai` — empty chain 31337 on port 8545. | When you want a blank chain and a mintable token. **verified by running** |
| `make fork` | 45-46 | `anvil --fork-url $(AEVUM_RPC) --hardfork shanghai --chain-id 440050 --port 8555`. | The main local workflow: real tUSD8, free balances, separate chain id. **verified by running** |
| `make deploy-local` | 48-49 | `forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender $(ANVIL_0)` — deploys `MockUSD8` + `Checkout`. | Against `make anvil` only. **verified by running** |
| `make deploy-fork` | 54-60 | Asserts chain 440050, mints a random throwaway deployer, impersonates it, deploys `Checkout` against the real tUSD8. `MERCHANT` defaults to anvil account 0. | Against `make fork` only. **verified by running** |
| `make deploy-aevum ACCOUNT=<name>` | 62-64 | `forge script … --rpc-url $(AEVUM_RPC) --broadcast --legacy --account $(ACCOUNT)`. Fails if `ACCOUNT` is empty. | The real deployment. `MERCHANT=0x…` optional. **verified by running** (the guard; not the deployment itself) |
| `make mint TO=… CHECKOUT=… [AMOUNT=100]` | 66-70 | Reads `Checkout.token()`, then `mint(TO, AMOUNT*1e6)` from anvil account 0. Both args required. | `make anvil` only — `MockUSD8` lets anyone mint. **verified by running** |
| `make deal TO=… [AMOUNT=100]` | 72-81 | 10 tQDAY + `AMOUNT` tUSD8 minted via the impersonated master minter. Refuses any chain but 440050. | `make fork` only. **verified by running** |
| `make dev` | 82-83 | `pnpm dev` → `pnpm --filter web dev` → `next dev` on `http://localhost:3000`. | Local app development. |

Makefile variables you can override: `AEVUM_RPC` (5), `LOCAL_RPC` (6), `FORK_PORT` (9), `FORK_RPC` (10), `AMOUNT` (16); and `TUSD8` (11), `TUSD8_MM` (13), `ANVIL_0` (15), `FORK_CHAIN` (18) are fixed with `:=` (**verified in code**).

### pnpm scripts

| Script | Where | Expands to | When to use it |
|---|---|---|---|
| `pnpm dev` | root `package.json:12` | `pnpm --filter web dev` | Run the web app in dev mode. |
| `pnpm build` | root `package.json:13` | `pnpm --filter web build` → `next build` | Production build; what CI and Vercel run. **verified by running** (see the Next.js advisory trap) |
| `pnpm typecheck` | root `package.json:14` | `pnpm -r typecheck` | Typecheck every workspace. **verified by running** |
| `pnpm example <name>` | root `package.json:15` | `pnpm --filter examples run <name>` | Run one of the three example scripts. |
| `pnpm check:shanghai` | root `package.json:16` | `node tools/check-shanghai.mjs contracts/out` | The opcode gate on its own, without rebuilding. |
| `pnpm example check-setup` | `examples/package.json:8` | `tsx --env-file-if-exists=.env src/check-setup.ts` | Print chain, head block, gas price, tQDAY and tUSD8 balances of `ADDRESS`. **verified by running** |
| `pnpm example pay-gasless` | `examples/package.json:9` | `tsx --env-file-if-exists=.env src/pay-gasless.ts` | `BUYER_KEY` signs, `RELAYER_KEY` submits. `AMOUNT` optional, default `"1"`. **verified by running** |
| `pnpm example read-payments` | `examples/package.json:10` | `tsx --env-file-if-exists=.env src/read-payments.ts` | Every `Paid` event in 1,000-block chunks. `FROM_BLOCK`, `ADDRESS` optional. **verified by running** |
| `pnpm --filter examples typecheck` | `examples/package.json:11` | `tsc --noEmit` | — |
| `pnpm --filter web dev` / `build` / `start` / `typecheck` | `web/package.json:8-11` | `next dev` / `next build` / `next start` / `tsc --noEmit` | `start` serves a built app; what you use to test the relayer locally. **verified by running** |

`--env-file-if-exists=.env` means the example scripts run without an `.env` and print `.env not found. Continuing without it.` twice (once per worker) (**verified by running**). Environment variables passed on the command line work the same way.

All **verified in code** unless marked otherwise.

---

## 9. Environment variables

Every variable the kit reads. All **verified in code** at the cited line.

### `web/` — browser-visible (`NEXT_PUBLIC_*`, inlined into the bundle at build time)

| Variable | Required | Default | Read at | Secret |
|---|---|---|---|---|
| `NEXT_PUBLIC_NETWORKS` | no | `"aevum"` (`env.ts:50`); also falls back to `["aevum"]` if nothing valid remains (`env.ts:58`) | `web/src/lib/env.ts:50` | no |
| `NEXT_PUBLIC_CHECKOUT_AEVUM` | for Aevum checkout/activity/receipts | none → gasless off and the Setup page flags it | `web/src/lib/env.ts:28` | no |
| `NEXT_PUBLIC_CHECKOUT_FORK` | for the fork | none | `web/src/lib/env.ts:36` | no |
| `NEXT_PUBLIC_CHECKOUT_LOCAL` | for local anvil | none | `web/src/lib/env.ts:44` | no |
| `NEXT_PUBLIC_DEPLOY_BLOCK_AEVUM` | no | none → Activity scans the chosen window from the head | `web/src/lib/env.ts:29` | no |
| `NEXT_PUBLIC_DEPLOY_BLOCK_FORK` | no | none | `web/src/lib/env.ts:37` | no |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | `undefined` → injected wallets only; `projectId` becomes `"not-set"` (`wagmi.ts:23`) | `web/src/lib/env.ts:72` | no (a public Reown project id) |
| `NEXT_PUBLIC_REPO_URL` | no | `"https://github.com/qday-io/aevum-starter-kit"`, with a trailing `.git` or `/` stripped | `web/src/lib/env.ts:75` | no |

Invalid values are dropped silently, not reported: a malformed address fails `isAddress` (`env.ts:19`) and a non-numeric block fails `/^\d+$/` (`env.ts:20`), both yielding `undefined` (**verified in code**).

### `web/` — server only (never sent to the browser)

| Variable | Required | Default | Read at | Secret |
|---|---|---|---|---|
| `RELAYER_PRIVATE_KEY` | only for gasless mode | none → `GET /api/relay` reports `enabled:false` and `POST` returns 503 | `web/src/app/api/relay/route.ts:50` | **YES — a private key.** Mark it Sensitive on your host. |
| `RELAYER_DAILY_TX_LIMIT` | no | `500` | `web/src/app/api/relay/route.ts:40` | no |
| `TRUSTED_IP_HEADER` | recommended behind a proxy | unset → last `X-Forwarded-For` entry, then `x-real-ip`, then `"unknown"` | `web/src/app/api/relay/route.ts:102` | no |
| `NODE_ENV` | set by Next.js | — | `web/src/app/api/relay/route.ts:43` (controls whether 503 messages name the missing config) | no |

### `examples/` (`examples/.env.example`, loaded by `tsx --env-file-if-exists=.env`)

| Variable | Required | Default | Read at | Secret |
|---|---|---|---|---|
| `RPC_URL` | no | `aevumTestnet.rpcUrls.default.http[0]` = `https://rpc-test.qday.info` | `examples/src/env.ts:34` | no |
| `CHECKOUT_ADDRESS` | yes for `pay-gasless` and `read-payments` | none → the script prints a message and `process.exit(1)` | `pay-gasless.ts:15`, `read-payments.ts:11` (via `requiredAddress`, `env.ts:13-20`) | no |
| `BUYER_KEY` | yes for `pay-gasless` | none → exit 1 | `pay-gasless.ts:16` (via `requiredKey`, `env.ts:22-30`) | **YES — a private key** |
| `RELAYER_KEY` | yes for `pay-gasless` | none → exit 1 | `pay-gasless.ts:17` | **YES — a private key** |
| `ADDRESS` | yes for `check-setup`; optional filter for `read-payments` | none → `check-setup` exits 1; `read-payments` shows all payers | `check-setup.ts:10`, `read-payments.ts:12` | no |
| `AMOUNT` | no | `"1"` | `pay-gasless.ts:21` | no |
| `FROM_BLOCK` | no | `head - 5000n` (or `0n` if the head is below 5000) | `read-payments.ts:15` | no |

`requiredKey` normalises a missing `0x` prefix and insists on exactly 66 characters (`examples/src/env.ts:24-29`) (**verified in code**).

### Makefile parameters (not environment variables in the usual sense)

`ACCOUNT` (required by `deploy-aevum`), `MERCHANT` (read by `Deploy.s.sol:28` through `vm.envOr`), `TO`, `CHECKOUT`, `AMOUNT`, and the overridable `AEVUM_RPC` / `LOCAL_RPC` / `FORK_PORT` / `FORK_RPC`. See §8.

### Secrets summary

Three secrets exist in the whole kit: `RELAYER_PRIVATE_KEY`, `BUYER_KEY`, `RELAYER_KEY`. All three are private keys, all three are documented as throwaway test wallets (`web/.env.example:29-32`, `examples/.env.example:9-10`), and none is ever committed: `.gitignore:7-9` ignores `.env*` and re-includes only `.env.example` and `**/.env.example` (**verified in code**). There are no API keys, no RPC keys and no database URLs.

---

## 10. Submission checklist mapping

What the kit says judges need, and how the kit itself demonstrates each. Sources: `README.md:267-287` and `web/src/app/docs/page.tsx:392-437`.

Challenge facts the kit states (all **docs only (unverified)** — the kit itself says the DoraHacks page wins over anything in it, `README.md:276`): Aevum Builder Challenge #1, solo or teams of 2-4, kickoff 16 Nov 2026 14:00 HKT, submission deadline **11 Dec 2026 16:00 HKT (08:00 UTC)**, judging 12-14 Dec, winners 15 Dec, prizes $1,500 USDT (800/500/200), submit at `https://dorahacks.io/hackathon/qday/detail`, help in the QDay Discord Mon-Fri 10:00-18:00 HKT (`docs/page.tsx:76-82`).

| Judges need | Where the kit says so | How the kit demonstrates it | Label |
|---|---|---|---|
| **Public repo, readable code** | `docs/page.tsx:395`; `:410` "The repo is public and opens in a logged-out browser" | The kit is itself a public MIT repo with a 309-line README, an in-app `/docs` page, and `AGENTS.md`-style comments at the top of every non-obvious file (e.g. `route.ts:19-34`, `Checkout.sol:22-29`, `chain.ts:3-11`) | **verified in code** |
| **Contract addresses on 44005, with explorer links** | `README.md:271`; `docs/page.tsx:402` | `links.explorer` + `txUrl()` + `addressUrl()` (`chain.ts:59-70`); the Setup page prints the chain, RPC, explorer and tUSD8 (`page.tsx:158-171`); the Receipt page links the payer and the tx (`receipts/[orderId]/page.tsx:116,128`); explorer links are suppressed on local chains via `hasExplorer` (`env.ts:16,38,46`) | **verified in code** |
| **A link to the exact commit you deployed** | `README.md:272`; `docs/page.tsx:403`; and the verification section tells you to do this *instead of* explorer verification (`README.md:116`) | `NEXT_PUBLIC_REPO_URL` + `repoUrl` feed the header's GitHub link (`Header.tsx:43`) and the Docs page's Source link and clone command (`docs/page.tsx:45-48, 118, 490`) | **verified in code** |
| **A few transaction hashes showing the app working** | `README.md:273`; `docs/page.tsx:404` | The Activity page lists every `Paid` event with a Receipt link and a Tx link (`activity/page.tsx:131-147`); the Receipt page shows block, gas used, submitter and hash (`receipts/[orderId]/page.tsx:119-129`); the checkout success banner links both (`checkout/page.tsx:277-294`) | **verified in code** |
| **A live demo that works without logging in** | `docs/page.tsx:414` "The demo link works without logging in"; `:397` accepts a working demo, a prototype interface, or a Docker image | Every page is a static or on-demand route with no auth: `/`, `/checkout`, `/activity`, `/docs` prerender statically and `/receipts/[orderId]` and `/api/relay` are server-rendered on demand (**verified by running**, from the `next build` route table). A wallet is needed to *pay*, not to *view*. The Receipt page reads the chain with no wallet connected (`receipts/[orderId]/page.tsx:31-39` uses `chainId` explicitly). A one-click Vercel deploy is wired up at `README.md:129` | **verified by running** / **verified in code** |
| **Documentation: problem, architecture, workflows, technologies** | `docs/page.tsx:398` | README + the in-app `/docs` page (11 sections, `docs/page.tsx:11-23`), plus "Code to read, in order" (`README.md:193-199`) | **verified in code** |
| **NOTICE / credits** | `README.md:278-287`; `docs/page.tsx:418-437` | `NOTICE.md` lists both Solidity submodules and all 7 direct JS dependencies with versions and licenses, and states that no third-party code is copied in (`NOTICE.md:3-5`). It ends with `pnpm licenses list` for the transitive set (`NOTICE.md:27`). `LICENSE` is MIT, © 2026 PQA Labs | **verified in code** |
| **No secrets in the repo or its history** | `docs/page.tsx:411` | `.gitignore:7-9` ignores every `.env*` except `*.env.example`; the two `.env.example` files contain only empty keys and comments; deployment uses an encrypted keystore rather than a key in a file (`Makefile:64`); `contracts/cache/` (which holds forge's "sensitive values") is gitignored (`.gitignore:13`). I confirmed `git status --porcelain` was empty after a full local run including a deploy, a relayer start and an `.env.local` — nothing leaked into the tree | **verified in code** / **verified by running** |
| **Contracts and payments on Aevum, not elsewhere** | `README.md:12`; repeated as a warning banner at `docs/page.tsx:50-53` and in the Setup page's gotchas (`page.tsx:190-192`) | The kit's deploy script refuses to deploy a mintable token off chain 31337 (`Deploy.s.sol:35`); the fork runs under its own chain id so fork activity can never be mistaken for testnet activity (`chain.ts:37-42`) | **verified in code** |
| **Submitted before the deadline; team members listed and registered** | `docs/page.tsx:408, 415` | Nothing in the kit; your job | **docs only (unverified)** |
| **A stranger can run it from your README** | `docs/page.tsx:412` | `make install && make check` is the first thing in the README (`README.md:36-41`), and both ran clean here from a bare clone | **verified by running** |
| **Top-5 projects present a 3-5 minute live walkthrough** | `docs/page.tsx:399` | — | **docs only (unverified)** |

Judging criteria the kit lists (`docs/page.tsx:448-454`, **docs only (unverified)**): Innovation, Technical quality, Real-world utility, User experience, Demo, Documentation, Safety and controls. Two are worth reading closely for Shaida: *Technical quality* names "tested code that handles retries, idempotency and async failures", and *Safety and controls* names "least-privilege sessions, budget caps, safe key storage, injection protection, audit trails, verifiable receipts, easy revoke". The kit's relayer has **no retries** (§4) — that is a gap you are expected to close, not a pattern to copy.

### Licence and credit rules the kit states

`README.md:280-287` and `docs/page.tsx:418-437` (**docs only (unverified)** for the organizers' confirmation, **verified in code** for the kit's own licence):

- Boilerplate, scaffolding and templates are allowed when the licence permits.
- Put a permissive licence (MIT or Apache 2.0) on your repo.
- If you start from this kit, keep its `LICENSE` or its copyright notice, and say so in your README — the kit suggests: *"Based on Aevum Starter Kit (MIT, PQA Labs)"*.
- Keep original copyright and licence headers in any copied file.
- Put a comment naming source repo, author and licence above any borrowed snippet.
- List third-party dependencies and their licences in your README or a `NOTICE` file.
- If you copy a whole directory or library, keep its `LICENSE` file in that folder.

---

## 11. Traps and gotchas

| Trap | Symptom | Fix | Source | Label |
|---|---|---|---|---|
| **Cancun bytecode on a Shanghai chain** | Deploy succeeds, then every call reverts with `invalid opcode` (e.g. `MCOPY`) | `evm_version = "shanghai"` in `foundry.toml`; run `tools/check-shanghai.mjs` in CI; avoid OpenZeppelin `*Transient` | `foundry.toml:5-8`; `README.md:207`; `check-shanghai.mjs:7` | **verified in code**; the revert itself **docs only (unverified)** |
| **Plain `anvil --fork-url` hides it** | Local tests pass on Cancun; the same bytecode fails on 44005 | Always `--hardfork shanghai`. Both Makefile targets do | `Makefile:43,46`; `README.md:208` | **verified in code** |
| **`eth_getLogs` range** | `{"code":-32000,"message":"block range too large, max range: 1000"}` | `getLogsChunked`; the real rule is `toBlock - fromBlock <= 1000` (≤1,001 blocks inclusive), and the kit's 1,000-block chunk has a diff of 999 | `logs.ts:20-36`; `chain.ts:56` | **verified by running** |
| **No WebSocket RPC** | `watchContractEvent` over `wss://` never connects | Poll over HTTPS; `http()` is viem's default and the kit uses nothing else | `README.md:76,210`; every transport is `http()` | **docs only (unverified)** — my WS attempt failed but I cannot rule out the proxy |
| **~1.01 s blocks** | Naive backfills are enormous: ~85,700 blocks/day, so a day is ~86 sequential `getLogs` calls | Persist a cursor and a deploy block; never re-scan from genesis per page load. Set `NEXT_PUBLIC_DEPLOY_BLOCK_*` | measured; the kit states no block time anywhere | **verified by running** |
| **`getLogsChunked` has no retries** | One flaky chunk throws away the whole scan, including chunks already fetched | Wrap it, or re-implement with per-chunk retry and backoff. There is no `retry` anywhere in the kit | `logs.ts:20-35` | **verified in code** |
| **`getLogsChunked` is sequential by design** | Large backfills are slow | Deliberate ("stay friendly with the public RPC"). Parallelise only with your own rate limiting | `logs.ts:18-19` | **verified in code** |
| **Contract verification on the explorer** | `forge verify-contract` fails | Publish addresses + a link to the exact commit instead | `README.md:116-121` | **docs only (unverified)**; nuance: `/api/v2/smart-contracts/verification/config` answers and reports the verifier enabled, yet tUSD8 has no source on the explorer (**verified by running**) |
| **Account abstraction is not supported** | No bundler or paymaster to point at | Use EIP-3009 + a relayer. Write budgets, limits, expiry and revoke into your own contract. Rolling your own ERC-4337 is allowed but unsupported | `README.md:295`; `docs/page.tsx:465-466`. **Changed on 2026-11-18** in commit `f7bc531`, which removed the earlier claim that "Aevum has an ERC-4337 bundler (EntryPoint v0.7) and Kernel v3.1 accounts" | **verified in code** (git history) |
| **…but the EntryPoint bytecode is on chain** | You may find v0.7 deployed and assume it is supported | Code **does** exist at the canonical v0.7 EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (16,035 bytes). That is not a supported bundler or paymaster, and the team says it will not debug it | — | **verified by running** (code presence only) |
| **No paymaster takes tUSD8** | You cannot pay gas in tUSD8 | Gasless checkout (a relayer pays tQDAY) is the only option today | `docs/page.tsx:476` | **docs only (unverified)** |
| **ERC-8004 registry is not available** | You build a Confirmation-of-Payee flow against a registry that is closed | Keep the name-to-address mapping in your own contract | `docs/page.tsx:98`. **Changed on 2026-11-20** in commit `e87bcff`, which removed the earlier line pointing at an "ERC-8004-style identity registry `0xF45E7f39Caba1d2055f613970575a7e7069636Be` (found on chain, not in QDay's docs yet)" and the mention of "ERC-8004 identities" as integration evidence | **verified in code** (git history) |
| **…and that address still has code** | You find 134 bytes at `0xF45E…36Be` and assume it is usable | Something is deployed there (134 bytes — proxy-sized), but the docs now say the registry is in internal testing and **not open for this challenge**. Do not build on it | — | **verified by running** (code presence only) |
| **Faucet: one claim per Discord account and per address** | `/faucet` refuses a second claim | Claim once, to the address you will actually build with. 1 tQDAY + 5 tUSD8. Ask in the help channel if you run out | `README.md:90`; `docs/page.tsx:209-215` | **docs only (unverified)** |
| **Web faucet eligibility** | `faucet.qday.info` says "address not eligible" | It only pays addresses holding a little ETH, USDT or USDC on Ethereum **mainnet**. Use the Discord faucet, which has no such check | `docs/page.tsx:484-485` | **docs only (unverified)** |
| **5 tUSD8 is not much** | You cannot test many payments on the real testnet | Do the volume work on `make fork` with `make deal`, and keep 44005 for the handful of transactions judges will look at | `README.md:92` | **verified in code** |
| **Legacy transactions** | Type-2 transactions may be rejected or behave oddly | `--legacy` in `forge script`, `type: "legacy"` in viem. Both are already set | `Makefile:64`; `route.ts:196`; `pay-gasless.ts:42` | **verified in code**; the fork tx I sent was `type 0` — **verified by running** |
| **MetaMask refuses two networks with the same RPC URL** | Adding the fork fails with "same RPC endpoint as existing network…" | The fork runs on **8555**, not 8545. `errors.ts:7-8` detects the error and tells the user to edit the conflicting network | `chain.ts:49-50`; `Makefile:7-8`; `errors.ts:7-8` | **verified in code** |
| **Fork balances look wrong (large)** | Your fork wallet shows thousands of tUSD8 you never received | The fork copies real testnet state. `make deal` **mints on top**, it does not set a balance. Measured: a single `make deal` left `9126000000` because the address already held ~9,026 tUSD8 | `Makefile:79`; `page.tsx:22-23` | **verified by running** |
| **`make deal` / `make deploy-fork` on the wrong chain** | "This only works on 'make fork'." and exit 1 | Intentional guard: `cast chain-id` must equal 440050 | `Makefile:55,74` | **verified by running** |
| **Fork merchant is not the deployer** | Payments on the fork go to anvil account 0, not to you | `Makefile:60` sets `MERCHANT` to `ANVIL_0` for `deploy-fork`; on Aevum it defaults to the deployer (`Deploy.s.sol:28`) | — | **verified by running** |
| **Shipping with `fork` or `local` in `NEXT_PUBLIC_NETWORKS`** | Visitors see a "Local fork" button pointing at **their own** 127.0.0.1 | Set `NEXT_PUBLIC_NETWORKS=aevum` in production | `README.md:135`; `docs/page.tsx:234-236` | **verified in code** |
| **`NEXT_PUBLIC_*` are build-time** | You change the Checkout address, redeploy the env var, and the browser still uses the old one | Rebuild and redeploy. `env.ts:22` says the values must be written out in full so Next.js can inline them. The relay route reads the same module at runtime on the server, so a stale build can disagree with the server | `web/src/lib/env.ts:22` | **verified in code** |
| **Relayer limits live in process memory** | On Vercel each instance has its own counters and loses them on a cold start; an attacker is slowed, not stopped | Move `hits`, `sentToday` and `inFlight` to Redis/Upstash/your DB. Keep only a little tQDAY in the relayer | `route.ts:31-33`; `README.md:150` | **verified in code** |
| **`TRUSTED_IP_HEADER` unset behind a CDN** | Every caller shares one rate-limit bucket, or a client spoofs `X-Forwarded-For` | Set it to your host's own header: `x-vercel-forwarded-for`, `cf-connecting-ip`. Unset, the code takes the **last** XFF entry, which is the safe default for one trusted proxy | `route.ts:97-107`; `web/.env.example:37-39` | **verified in code** |
| **Daily cap resets on the UTC date** | Your "daily" budget rolls over at an unexpected local hour | `new Date().toISOString().slice(0,10)` | `route.ts:80` | **verified in code** |
| **anvil keys refused on Aevum** | Gasless silently reports `enabled:false` on 44005 with a key that works on the fork | By design. Use a fresh key off local chains | `route.ts:56-61`; `anvil.ts:7-22` | **verified in code** |
| **Relay amount check hardcodes 6 decimals** | A token with other decimals makes every gasless request fail the price check | `route.ts:159` uses the constant `TUSD8_DECIMALS`, while the UI reads live `decimals()` (`useToken.ts:35`). Read decimals from the token if you change it | `route.ts:159` | **verified in code** |
| **`priceOf` is a constant** | Every order costs 1.05 regardless of its contents | `order.ts:20-22` returns `demoOrder.total`. Replace it with a real lookup before the relayer means anything | `web/src/lib/order.ts:20-22` | **verified in code** |
| **`isPaid` proves nothing** | An order shows "paid" for 0.000001 tUSD8, possibly front-running the real buyer | Compare the **amount** (and the payer if it matters). The Receipt page does: "Wrong amount" unless `p.amount === expected` | `receipts/[orderId]/page.tsx:52-55`; `README.md:189` | **verified in code** |
| **Sequential order ids** | Someone claims your invoice numbers in advance | 32 random bytes. `newOrderId()` does it | `order.ts:24-27`; `README.md:190` | **verified in code** |
| **`next build` aborts once with a security advisory** | `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability` and exit 1, **after** the routes have compiled | Re-run the same command; the second run continues with a warning. The kit pins `next 16.4.3` (`web/package.json:17`, `NOTICE.md:18`). If you fork the kit, plan a Next upgrade — CI (`ci.yml:43`) and Vercel both run `pnpm build` and will hit this | — | **verified by running** |
| **`pnpm audit` high advisories in `zod` and `decode-uri-component`** | Audit fails in your pipeline | Both arrive through WalletConnect; browser-only, reached only when `NEXT_PUBLIC_WC_PROJECT_ID` is set, and not loaded by the relay route. The kit deliberately does not force overrides | `README.md:305` | **docs only (unverified)** |
| **`make check` needs the network** | `make check` fails offline because `test-fork` needs `rpc-test.qday.info` | Use `make build && make test` offline. CI marks the fork job `continue-on-error: true` for exactly this reason | `Makefile:39`; `ci.yml:28-30` | **verified in code** |
| **Git submodules** | `forge build` cannot find `forge-std` or OpenZeppelin | Clone with `--recursive`, or run `make install` (which runs `git submodule update --init --recursive`) | `README.md:37`; `Makefile:26` | **verified by running** |
| **`contracts/broadcast/` is gitignored** | Your deployment record is not in the repo judges read | `git add -f contracts/broadcast/Deploy.s.sol/44005/run-latest.json`, or write the addresses into your README | `.gitignore:14-15` | **verified in code** |
| **`localAnvil` declares no Multicall3** | On `local`, batched reads become individual calls | `chain.ts:29-35` has no `contracts.multicall3`, unlike `aevumTestnet` (`chain.ts:22-24`) and `aevumFork` (which inherits it via the spread at `chain.ts:46`) | `chain.ts:29-35` | **verified in code** |
| **`read-payments` default window is 5,001 blocks** | Six requests where you expected five | `head - 5000n` with an inclusive `toBlock` | `read-payments.ts:15` | **verified by running** |
| **The in-flight lock holds for 120 s after success** | A legitimate retry of a *different* attempt at the same order gets 409 for two minutes | Intentional. `inFlight` is deleted only on failure paths | `route.ts:176-200` | **verified by running** |
| **The relayer never waits for a receipt** | A dropped transaction is never resubmitted and the client is told it succeeded | Add receipt polling, persistence and resubmission (§4) | `route.ts:196-198` | **verified in code** |
| **`forge lint` notes in `make build`** | Noise about `screaming-snake-case-immutable`, `asm-keccak256`, `unsafe-cheatcode` | Advisory only; they do not fail the build in Foundry 1.5.1 | — | **verified by running** |
| **Explorer confusion** | You look up a transaction and find nothing | `explorer-test.qday.info` is testnet; `explorer.qday.io` is **mainnet** | `docs/page.tsx:478` | **docs only (unverified)** |
| **Faucet URL mismatch in the kit** | — | `README.md:91` says `https://faucet.qday.info`; `chain.ts:60` uses `https://faucet.qday.info/en`. Both presumably work; the code is the one the app links to | `chain.ts:60` vs `README.md:91` | **verified in code** |
| **Settling on another chain does not count** | Your submission is discounted | Contracts, payments and transfers must happen on Aevum testnet. x402 on Base does not count | `README.md:12`; `docs/page.tsx:50-53` | **docs only (unverified)** |

---

## 12. What is reusable for Shaida

The kit is **MIT, © 2026 PQA Labs** (`LICENSE:1-3`, **verified in code**). MIT permits use, copying, modification and redistribution with one condition: *"The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software"* (`LICENSE:12-13`, **verified in code**).

`NOTICE.md:3-5` states that **no third-party code is copied into the kit** — the Solidity libraries are git submodules that keep their own LICENSE files, and the JS packages come from npm (**verified in code**). So when you copy from the kit you take on exactly one attribution obligation: PQA Labs' MIT notice. You do not inherit any OpenZeppelin or forge-std copying obligation unless you also copy their files.

**Three things to do once, up front:**

1. Keep the kit's `LICENSE` in your repo (or reproduce its copyright + permission notice in your own `LICENSE`/`NOTICE`), and say in your README: *"Based on Aevum Starter Kit (MIT, PQA Labs) — https://github.com/qday-io/aevum-starter-kit"*. This is both the MIT condition and what the challenge asks (`README.md:283`).
2. Keep the `// SPDX-License-Identifier: MIT` header on any Solidity file you copy (`Checkout.sol:1`), and add a comment naming the source above any borrowed snippet (`README.md:285`).
3. Write a `NOTICE.md` for Shaida listing your own dependency set, including **circom, snarkjs and the Gloam SDK/contracts under their own licences** — the kit's `NOTICE.md` is the template (`NOTICE.md:7-27`). Check Gloam's licence yourself; it is not MIT by assumption, and the kit says nothing about it.

| Kit file | What to do | Why / what it gives Shaida | Licence note |
|---|---|---|---|
| `packages/aevum/src/chain.ts` | **Copy** | `aevumTestnet`, `aevumFork`, `localAnvil`, `AEVUM_FORK_CHAIN_ID`, `MAX_LOG_RANGE`, `links`, `txUrl`, `addressUrl`. Every network fact in one 70-line file, and the EIP-3085 payload wallets need. Nothing here is Checkout-specific. | MIT notice |
| `packages/aevum/src/contracts.ts` | **Copy the tUSD8 parts; drop `checkoutAbi`** | `TUSD8_ADDRESS`, `TUSD8_DECIMALS`, `tusd8Domain`, `erc20Abi`, `eip3009Abi`. The domain function is **verified by running** to reproduce the live `DOMAIN_SEPARATOR`. Replace `checkoutAbi` with your depositor/registry/verifier ABIs in the same `parseAbi` style, including the `error` entries so viem can decode your custom errors. | MIT notice |
| `packages/aevum/src/eip3009.ts` | **Copy** | This is the heart of your gasless depositor. `receiveWithAuthorizationTypes`, `checkoutTypedData`, `authorizationWindow`. Rename `checkoutTypedData` → e.g. `depositorTypedData` and keep `to` = your depositor contract. Keep `validAfter = 0n`. | MIT notice |
| `packages/aevum/src/logs.ts` | **Adapt** | `getLogsChunked` is correct for the 1,000-block limit (**verified by running**) but has **no retries** and no cursor. For Shaida's indexer API, add per-chunk retry with backoff, a persisted cursor, and reorg handling. Keep the one-shot head pinning (`logs.ts:25`) and the sequential loop. | MIT notice |
| `packages/aevum/src/anvil.ts` | **Copy** | `ANVIL_ACCOUNTS` + `isAnvilAccount`, used to refuse public test keys on a real chain. 20 lines, zero maintenance. | MIT notice |
| `web/src/app/api/relay/route.ts` | **Adapt — this is the single most valuable file for you** | The rail ordering, the in-flight claim, simulate-before-send, the IP/payer/daily limits, the `clientIp` logic, the cached `nonceManager` account, and the out-of-gas disambiguation. Then apply all ten hardenings in §4 before it carries 1.8M-gas proofs. | MIT notice |
| `web/src/lib/env.ts` | **Copy the pattern** | Network records keyed by a short name, validated addresses, `NEXT_PUBLIC_NETWORKS` with "first is default", `networkByChainId` / `networkByKey`. Extend the `Network` interface with your own addresses: `payerRegistry`, `depositor`, `pool`, `incomeProofVerifier`, `deployBlock`. | MIT notice |
| `web/src/lib/network.tsx` | **Copy** | `NetworkProvider`: follow the wallet when connected, `localStorage` memory, switch-pending and switch-error state, storage access wrapped in try/catch. Solves the "app reads one chain while the wallet signs on another" bug for free. | MIT notice |
| `web/src/lib/wagmi.ts` | **Copy** | `createConfig` with chains from env, one `http()` per chain, `ssr: true`, and the RainbowKit connector split for with/without a WalletConnect id. | MIT notice |
| `web/src/lib/errors.ts` | **Copy and extend** | `explain()` turns viem/wallet/revert errors into one actionable sentence, and `fullMessage()` digs through nested `cause`/`data.cause`. The duplicate-RPC-URL message alone saves a support thread. Extend the revert-name map with your contracts' errors (`NullifierAlreadySpent`, `InvalidProof`, `UnknownRoot`, …) exactly as it maps `AlreadyPaid`. | MIT notice |
| `web/src/components/useToken.ts` | **Copy** | Reads the token address from the contract rather than trusting config, then batches `decimals`+`symbol` through Multicall3, with sane fallbacks. | MIT notice |
| `web/src/app/page.tsx` (Setup check) | **Adapt** | A pre-flight page that scores wallet / network / gas / token balance / contract-is-deployed and tells the user exactly what to fix, with a "Switch network" and an "Add token to wallet" button. For Shaida add: is the Gloam pool deployed, is the payer registered, is there a usable merkle root. This page is cheap judge-facing evidence that the app is on Aevum. | MIT notice |
| `web/src/app/receipts/[orderId]/page.tsx` | **Adapt — read this before you build income proofs** | It is a worked example of *verifying a claim against the chain instead of trusting a link*: it checks the amount against the expected price, it matches the `?tx=` receipt's logs against both the emitting address **and** the id before showing anything, it ignores unmatched URL input (line 26-27 comment: "a receipt must not display text from the URL"), and it explains the relayer-submitted case (line 135-137). That is exactly the discipline an income-proof verifier page needs. | MIT notice |
| `web/src/app/activity/page.tsx` | **Adapt** | Chunked log reading with a progress bar, window selector, "only mine" filter, and `[...result].reverse()` for newest-first. The shape of your indexer's UI. | MIT notice |
| `web/src/app/checkout/page.tsx` | **Reference only** | Read it for the two-mode flow, the step machine, `assertUnpaid` before spending a signature or gas, exact-amount approval, and simulate-before-write. Shaida's flow (register → authorize → deposit → prove) differs enough that copying the file is not useful. | MIT notice if you lift code |
| `contracts/src/Checkout.sol` | **Reference only — do not ship it** | Read it for the nonce-binding trick and the CEI ordering. Then apply the lesson, not the file: key your records by something the payer cannot grief (`keccak256(payer, id)`), and never expose an `isPaid`-style boolean that a dust payment can set. Its documented limits (§3) are disqualifying for a payments product. | MIT notice if you lift code |
| `contracts/src/Checkout.sol:9-19` (`IERC3009`) | **Copy** | A minimal `receiveWithAuthorization` interface. Exactly what your gasless depositor needs to call tUSD8. | MIT notice |
| `contracts/src/Checkout.sol:84-86` (`authorizationNonce`) | **Copy the idea** | `keccak256(abi.encode(address(this), id))`. For Shaida, bind it to whatever must not be substitutable — the deposit commitment, or `(payer, periodId)`. Use `abi.encode`, not `encodePacked`. | MIT notice |
| `contracts/test/Signing.sol` | **Copy** | EIP-3009 `ReceiveWithAuthorization` signing inside Foundry tests, including the raw `\x19\x01` digest. Needed to test your depositor without a JS harness. | MIT notice |
| `contracts/test/fork/AevumFork.t.sol` | **Copy the pattern** | The `assertEq(block.chainid, 44005)` guard, the independently-recomputed `DOMAIN_SEPARATOR` assertion, and `deal(address(TUSD8), buyer, …)` for free balances. Running your own contracts against the **real** tUSD8 on a fork is the cheapest high-value test you can write, and it is the test most likely to catch a tUSD8-specific surprise. | MIT notice |
| `contracts/script/Deploy.s.sol` | **Adapt** | The token-by-code-presence discovery (`:32-39`), the chain-id guard against deploying a mintable token (`:35`), the anvil-merchant guard (`:30`, `:49-54`), and `vm.envOr` parameters. Shaida deploys more contracts, in order, with addresses wired between them — extend `run()` and log every address with `console.log` as this one does. | MIT notice |
| `contracts/src/mocks/MockUSD8.sol` | **Copy** | A local tUSD8 stand-in with the same 6 decimals, the same EIP-712 domain (`"tUSD8"`, `"2"`) and the same EIP-3009 functions, mintable by anyone. Lets your unit tests run offline in milliseconds. Keep the `FOR LOCAL TESTING ONLY` comment (`MockUSD8.sol:10`) and never deploy it off chain 31337. | MIT notice |
| `contracts/foundry.toml` | **Copy** | `solc_version = "0.8.24"`, `evm_version = "shanghai"`, optimizer 200, remappings, `[rpc_endpoints]`. Note: circom/Groth16 verifiers generated by snarkjs are plain Solidity with heavy `assembly` and `mulmod`/`addmod`; they do not use Cancun opcodes, so Shanghai is fine — but run `check-shanghai.mjs` over your generated verifier anyway, because you did not write that bytecode. | MIT notice |
| `tools/check-shanghai.mjs` | **Copy** | 57 lines, no dependencies, correctly skips PUSH immediates and CBOR metadata. Point it at your artifacts. This is your guard against a generated verifier or a future library pulling in a Cancun opcode. | MIT notice |
| `Makefile` | **Adapt** | Steal wholesale: the fork-chain-id assertions before any mutating target, the throwaway-deployer trick for `deploy-fork`, the master-minter impersonation in `deal`, `--legacy` + `--account` for `deploy-aevum`, and the `## ` self-documenting help target. Add your circom build, your trusted-setup/ptau steps, and a `make verifier` target. | MIT notice |
| `.github/workflows/ci.yml` | **Copy** | Two jobs; `submodules: recursive` on checkout; `continue-on-error: true` on the fork job so a flaky public RPC does not block a PR (`:28-30`). Add your circuit compilation and proof-generation tests. | MIT notice |
| `examples/src/env.ts` | **Copy** | `connect()` probing `getChainId()` to choose the chain, and the `required` / `requiredAddress` / `requiredKey` validators that exit with a useful message. | MIT notice |
| `examples/src/pay-gasless.ts` | **Copy as your script template** | ~45 lines: read nonce → sign typed data → `parseSignature` → `simulateContract` → `writeContract({type:"legacy"})` → `waitForTransactionReceipt`. This is also the kit's answer to the "Native AI Assistants" track (`docs/page.tsx:101`): a payment with no browser. | MIT notice |
| `examples/src/read-payments.ts` | **Reference** | A 30-line CLI over `getLogsChunked` with a stderr progress line. Useful as a debugging tool for your indexer; fix the `head - 5000n` off-by-one if you care. | MIT notice |
| `web/.env.example`, `examples/.env.example`, `.gitignore` | **Copy** | The commented-env-file pattern, the explicit "Server only (no `NEXT_PUBLIC_` prefix)" divider (`web/.env.example:27`), and the `.env*` + `!**/.env.example` gitignore rule that keeps secrets out while committing the template. Directly satisfies the "no secrets in the repo" checklist item. | MIT notice |
| `NOTICE.md` | **Copy as a template** | The exact table shape judges want: project, version, licence, source/usage, plus the `pnpm licenses list` pointer. | MIT notice |
| `README.md` / `web/src/app/docs/page.tsx` | **Reference only** | Good models for a judge-facing README (network table, "code to read in order", a differences-from-Ethereum table). Do not copy the challenge facts — they are dated and the kit itself defers to the DoraHacks page (`README.md:276`). | Prose; attribute if you quote |
| `web/src/app/globals.css` | **Copy if you want a head start** | 276 lines holding every colour and font; `README.md:231` calls it the file to edit to rebrand. | MIT notice |

**What not to reuse:** `Checkout.sol` as a production contract (§3 limits), `priceOf` as anything but a stub, the in-memory relayer limits as-is, and the challenge dates and prize figures in the docs.

---

## 13. Open questions

Things I could not settle from the code, with where I looked.

1. **Is `forge verify-contract` actually broken on 44005?** `README.md:116` says the explorer's verifier "isn't working yet". But `GET https://explorer-test.qday.info/api/v2/smart-contracts/verification/config` answers with `"is_rust_verifier_microservice_enabled": true` and a full `solidity_compiler_versions` list (**verified by running**), which is what a working Blockscout verifier looks like. Against that: `GET /api/` returns 400, and `getsourcecode` for tUSD8 returns no source, so nothing on this chain appears to be verified. I could not run the command because it needs a contract deployed from a funded 44005 key. **Try it once after your first deploy** — if it works, verified contracts are a cheap judging win. Looked at: `README.md:116-121`, `web/src/app/docs/page.tsx:243-245`, the explorer's own API.

2. **Does the RPC genuinely lack a WebSocket endpoint?** My `wss://rpc-test.qday.info` attempt failed with "An unknown RPC error occurred" (**verified by running**), but this container's HTTPS proxy may be refusing the upgrade. The kit asserts no WebSocket in four places and uses `http()` everywhere, which is the safe behaviour either way. Unresolved: whether a non-proxied client could open a WS subscription. Looked at: `README.md:76,210`, `chain.ts:9`, `docs/page.tsx:344-346`, and every transport in the repo.

3. **Does `solc_version = "0.8.24"` interact with Shanghai in any way beyond `evm_version`?** 0.8.24's *default* target is Cancun, which is exactly why `evm_version` must be set explicitly, and `check-shanghai.mjs` proves the output is clean (**verified by running**). What I did not test: whether a newer solc (0.8.26+) with `evm_version = "shanghai"` also produces clean bytecode, which matters if a Gloam or snarkjs-generated verifier pins a different compiler. Looked at: `contracts/foundry.toml:7-8`, `tools/check-shanghai.mjs`.

4. **What is deployed at `0xF45E7f39Caba1d2055f613970575a7e7069636Be`?** 134 bytes of code exist there (**verified by running**) and until commit `e87bcff` (2026-11-20) the kit called it "an ERC-8004-style identity registry … found on chain, not in QDay's docs yet". The docs now say QDay's ERC-8004 registry "is still in internal testing and isn't open for this challenge". I did not probe its interface. Treat it as unavailable; keep your payer registry in your own contract. Looked at: `git show e87bcff`, `docs/page.tsx:98`.

5. **Is there any supported bundler or paymaster at all?** Code exists at the canonical ERC-4337 v0.7 EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (16,035 bytes, **verified by running**), and commit `f7bc531` (2026-11-18) removed the kit's earlier claim of "an ERC-4337 bundler (EntryPoint v0.7) and Kernel v3.1 accounts", replacing it with "no officially supported bundler or paymaster". An EntryPoint without a bundler is not usable for UserOperations. Unresolved: whether a public bundler RPC exists unofficially. Do not plan on it. Looked at: `git show f7bc531`, `README.md:295`, `docs/page.tsx:465-466`, `:476`.

6. **Faucet sufficiency for a ZK app.** 1 tQDAY + 5 tUSD8, once per Discord account and once per address (`docs/page.tsx:209-211`, **docs only**). At 1 gwei, 1 tQDAY is ~1,000,000,000 gas, so even 1.8M-gas proofs are ~550 transactions — gas is not your constraint. **5 tUSD8 is**, if Shaida's demo needs meaningful deposit amounts across several payers. The kit's answer is "ask in the help channel" (`docs/page.tsx:211`). Unresolved: whether the team grants larger or repeat allocations for a shielded-pool demo. Ask early.

7. **Are there per-IP or per-method rate limits on the public RPC?** `logs.ts:18-19` says requests are sequential "to stay friendly with the public RPC", which implies limits exist, but no number is documented anywhere in the kit, and I did not probe for one. This matters for an indexer doing ~86 `getLogs` calls per day of backfill plus per-request reads. Looked at: `logs.ts:17-19`, `chain.ts:3-11`, `README.md:203-213`.

8. **Reorg depth / finality.** Nothing in the kit mentions confirmations, finality or reorg handling, and no read path waits for more than one confirmation (`waitForTransactionReceipt` with no `confirmations` argument: `checkout/page.tsx:131,154`, `pay-gasless.ts:43`) (**verified in code**). For income proofs you will want a confirmation policy. Unresolved: Aevum's consensus and reorg behaviour. The head block I read had `difficulty: 0x0` and a `withdrawalsRoot`, i.e. post-merge-shaped, but that says nothing about finality guarantees. Looked at: every `waitForTransactionReceipt` call, `chain.ts`.

9. **Does tUSD8 have a blocklist, a pause, or fees?** It is described as USDC-style FiatTokenV2 (`contracts.ts:3`) and it answers `masterMinter()` (**verified by running**), so it very likely has `blacklist`/`pause` functions inherited from Centre's implementation. The kit never probes them and no ABI entry exists for them. A blacklisted payer or a paused token would break a shielded pool's accounting mid-flight. Unresolved: the exact admin surface. The contract is unverified on the explorer, so you would have to probe selectors or ask. Looked at: `contracts.ts:1-27`, `AevumFork.t.sol:9-12`, the live token.

10. **Where is the kit's own live demo?** `README.md:129` ships a "Deploy with Vercel" button and `docs/page.tsx:397` requires a live deployment, but no canonical hosted URL for the kit appears anywhere in the repo (**verified in code**, grep for `vercel.app` and for any deployed host). So I have no reference deployment to compare behaviour against. Looked at: `README.md:125-151`, `web/.env.example`, `web/src/lib/env.ts:75`.

11. **Whether `make check`'s dependency on the network is intentional for contributors.** `Makefile:39` makes `check` depend on `test-fork`, while CI deliberately tolerates a failing fork job (`ci.yml:28-30`). The two disagree about how important the fork test is. Not a problem, just inconsistent. Looked at: `Makefile:39`, `.github/workflows/ci.yml:26-30`.
