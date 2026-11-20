# Aevum Testnet and tUSD8

Researched: 2026-11-20
Primary sources: aevum-starter-kit.vercel.app/docs; github.com/qday-io/aevum-starter-kit (cloned; `contracts/src/Checkout.sol`, commit log to 2026-11-20); qday.io and qday.io/about (WebFetch); qday.io/builder-challenge FAQ.

## What it actually is
QDay's testnet, run by PQA Labs (Hong Kong), live since 2026-09-04. It's an EVM chain on the modular Polygon CDK. Post-quantum accounts are **not live**: QDay's roadmap puts the PQ testnet in 2027 Q2 and PQ mainnet in 2027 Q4. Today wallets are ordinary ECDSA.

## Core facts
| Item | Value |
|---|---|
| Chain ID | 44005 |
| RPC | https://rpc-test.qday.info (HTTPS only, **no WebSocket**) |
| Explorer | https://explorer-test.qday.info (explorer.qday.io is mainnet) |
| Gas token | tQDAY, 18 decimals, ~1 gwei |
| EVM version | **Shanghai**. No Cancun opcodes, so no transient storage (`tstore`) and no `mcopy`. |
| Multicall3 | 0xcA11bde05977b3631167028862bE2a173976CA11 |
| Kit local fork | chain ID 440050 at 127.0.0.1:8555 (`make fork`) |
| Block time | **~1.01 s** (measured 2026-11-20: blocks 3,619,732 → 3,620,732 spanned 1,012 s). QDay's Oct 22 post said ~3.02 s, so it has changed. ≈ 85,000 blocks/day. |
| Log reads | **Hard limit: block range ≤ 1,000** (`block range too large, max range: 1000`; spike S3, 2026-11-20) |

## tUSD8
| Item | Value |
|---|---|
| Address | 0x456569838f1d43009A91ebA4263147Afd7233483 |
| Decimals | 6 |
| Standards | EIP-2612 `permit`, EIP-3009 `transferWithAuthorization` / `receiveWithAuthorization` |
| EIP-712 domain | name "tUSD8", version "2" |
| Mint | Not possible for us. A competitor reports a USDC-style FiatToken reverting "caller is not a minter" (secondary source, unverified). |

The kit's `Checkout.payWithAuthorization` pattern, worth copying for gasless deposits: the EIP-3009 nonce = `keccak256(abi.encode(address(this), orderId))`, and the token is pulled with `receiveWithAuthorization` to `address(this)`. That stops a relayer reusing the signature.

## Faucets (scarce)
- Discord `/faucet` after verifying: 1 tQDAY + 5 tUSD8, once per account and once per address.
- Web faucet faucet.qday.info/en: the kit says it only pays addresses holding ETH/USDT/USDC on Ethereum mainnet; the FAQ says nothing is needed. **Conflict, spike S1.**
- Fork: `make deal TO=<addr>` gives unlimited test balances.

## Not available (as of 2026-11-20)
- ERC-4337: "not officially supported", no supported bundler or paymaster (kit commit 2026-11-18). The qday.io site claims AA, an x402 facilitator and a stablecoin paymaster are live. **Conflict**: don't depend on them.
- ERC-8004 identity registry: "still in internal testing and isn't open for this challenge" (kit commit 2026-11-20).
- Explorer contract verification: doesn't work yet.
- QDay SDKs/APIs: "coming soon".

## Defaults and ordering that matter
- Compile with `evm_version = "shanghai"`; OZ `ReentrancyGuardTransient` is unusable.
- Poll for confirmations (no WebSocket subscriptions).
- Any log sync (Gloam's Merkle tree) must page at ≤ 1,000 blocks.

## Added from AEVUM_INTEGRATION.md (starter-kit analysis, kit commit e87bcff, run against the live chain 2026-11-20)
Full detail, with file and line citations, is in AEVUM_INTEGRATION.md. Facts that change how we build:
- **Log range rule is `toBlock − fromBlock ≤ 1000`** (1,001 blocks inclusive). The kit's `getLogsChunked` uses a 999 difference (safe). It has **no retries and no cursor**, so our indexer adds both.
- **Gas price is exactly 1 gwei** (`eth_gasPrice`). Block time 1.01–1.06 s (explorer stat 1,010 ms).
- **Send legacy (type 0) transactions:** `--legacy` in forge, `type: "legacy"` in viem. Our S2 spike didn't, so it is a build rule now.
- **Fork workflow:** `make fork` = chain ID 440050 on port 8555 with `--hardfork shanghai`. Plain `anvil --fork-url` runs Cancun and hides opcode problems. `make deal` **mints on top** of real balances via the impersonated master minter (`0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1`).
- **tUSD8 is a FiatTokenV2 proxy** with a master minter, so it very likely has `blacklist` and `pause`. If the pool or a user were blacklisted, or the token paused, deposits and withdrawals would fail. Probe it in a fork test.
- **Contract verification may work after all:** Blockscout's verifier config endpoint is live. Try `forge verify-contract … --verifier blockscout --verifier-url https://explorer-test.qday.info/api/` after the first deploy.
- **EntryPoint v0.7 bytecode and a 134-byte contract at the old ERC-8004 address exist on chain, but both are officially unsupported.** Don't use them.
- **Relayer:** the kit's `/api/relay` is the template (rails in order, simulate before send, in-flight claim, anvil-key refusal). Its ten hardening items (gas budget not tx count, explicit gas cap, limits in a store not memory, receipt tracking and resubmission, logging) apply to us because our transactions are 0.3–1.8M gas.
- `next build` aborts once with a Next.js security advisory, then passes on re-run. Plan a Next upgrade.
- `contracts/broadcast/` is gitignored; force-add the 44005 run or record addresses in `deployments/aevum.json`.

## Unverified: confirm with a reality spike
- The actual `eth_getLogs` range limit (1,000 is the kit's choice, not a stated RPC limit). S3.
- Whether the bn254 pairing precompiles (0x06–0x08) work with normal gas costs. S2.
- tUSD8 behaviour on `receiveWithAuthorization` called by a pool contract. S6.

## Out of scope
AA/session keys, ERC-8004, the bridge, mainnet.
