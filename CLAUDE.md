# CLAUDE.md: guide for the coding agent building Shaida

## Start of every session
1. Read `PRD.md`, the section for your task. Don't derive requirements from memory.
2. Read `BUILD_CONTRACT.md` and `DECISIONS.md`.
3. Read the briefing file for the area you touch:
   - chain/token: `briefing/AEVUM.md`, `briefing/AEVUM_INTEGRATION.md`
   - pool/SDK: `briefing/GLOAM_SDK.md`
   - anything external: `briefing/FAILURE_MODES.md`
   - tests and claims: `briefing/EVAL_DESIGN.md`
   - setup: `briefing/CEREMONY.md`
4. `briefing/REALITY_SPIKES.md` holds measured facts. Prefer them over docs and over your training data.

## Invariants (the code can't show these; never break them)
- All settlement happens on Aevum Testnet, chain 44005, with tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals). No other chain in production config.
- Gloam is a dependency, not our code. Never edit vendored Gloam files. Keep its LICENSE and headers. Credit per `briefing/EVENT.md`.
- Gloam verifiers on our deployment are the **final** ceremony ones (`*VerifierFinal`, `*_final.zkey`). Never the dev keys.
- `NEXT_PUBLIC_SHAIDA_INCOME_KEY` defaults to `"final"` when unset, on purpose: it is the safe default (the ceremony
  key), not a silent fallback. `"throwaway"` must be asked for, works on local chains only and is refused on 44005;
  any other value is `NotConfigured` (`packages/shaida-pay/src/config.ts`, test P01). Keep it that way.
- `NEXT_PUBLIC_NETWORKS` is required and has no default; a listed network without valid contracts stops the build
  and the server (`web/src/lib/web-config.ts`, tests W10–W15).
- Deposits go through `shieldBound` (the pool refuses plain `shield` once a shield verifier is set).
- Only `ShaidaLedger` writes V and S leaves. V requires an **active** registered payer. S is written only by `sweep`.
- The circuit, its zkey and `IncomeVerifier` change together. Any circuit change invalidates the ceremony: record it in DECISIONS.md and rerun phase 2.
- The relayer exposes one route per contract function and never forwards arbitrary calldata.
- Proof payloads live in the URL fragment. The server never receives or stores proofs, except the underwriting bot endpoint, where the server is itself the reader (D30): there the link is never logged or kept, and only a hash of recorded proofs is stored. The server never receives note secrets or receive keys.
- Recipient secrets stay in the browser (encrypted local storage + exportable backup). Never logged.

## Aevum and tooling gotchas (measured; newer than your training data)
- **EVM is Shanghai.** `evm_version = "shanghai"`, solc 0.8.24. No `TSTORE`/`TLOAD`/`MCOPY`/blob opcodes; no OpenZeppelin `*Transient`. Run `tools/check-shanghai.mjs` over all artifacts, generated verifiers included.
- **Local chains:** always `--hardfork shanghai`. `make fork` = chain 440050 on port 8555. Plain `anvil --fork-url` runs Cancun and hides bugs.
- **Legacy transactions only:** `--legacy` (forge), `type: "legacy"` (viem).
- **`eth_getLogs`:** the rule is `toBlock − fromBlock ≤ 1000`. Use chunked reads with retry, backoff and a persisted cursor. ~85,000 blocks/day (1.01 s blocks), so never rescan from the deploy block on page load.
- **No WebSocket.** Poll over HTTPS.
- **Gas price is 1 gwei.** Our txs (measured, evidence/fork-gas.md): gasless deposit 1.35M, vouchedPay 2.77M, sweep 2.70M (ledger adds ~0.93M to a 1.84M pool transfer); block gas limit 30M, unshield ~0.32M, Groth16 check ~258k.
- **Gloam zkeys:** use `app/public/circuits/final/*_final.zkey`. The same-named files in `app/public/circuits/` are a different key and fail on the `*VerifierFinal` contracts (measured).
- **snarkjs verifiers return `false` when short of gas** (they don't revert), so `eth_estimateGas` under-reports (~30k vs ~258k). Wrap with `require(verifier.verifyProof(...))` and set gas explicitly on verification txs.
- **snarkjs keeps Node alive after proving.** CLI scripts must `process.exit`.
- **Local Merkle tree** = rebuilt from chain events in order: `Shielded` (has leafIndex), then each `Transferred` inserts `newCommitments[0]` then `[1]`. A missing leaf gives `UnknownRoot`.
- **Pool setup:** `endSetup()` requires `turnOnDepositLimits()` + `setDepositLimit(asset, perTx, total)` first.
- **Gloam SDK on chain 44005:** always pass `chainId` + `poolAddress`, and `artifactProver({wasm, zkey})` with final keys.
- **`make deal` mints on top** of real fork balances (master minter impersonation). In Solidity fork tests use `deal(...)`.
- **tUSD8 is a FiatTokenV2 proxy:** possible blacklist/pause (spike S9). Handle a paused token as a named error.
- **Next.js:** pinned to 16.4.6 (D22). That is NOT the version in your training data: read `web/node_modules/next/dist/docs/` before using any Next feature. At 16.4.3 `next dev`/`next build` stopped once with a security advisory; at 16.4.6 `next build` passes on the first run (measured). Route handlers: Web `Request`/`Response`, `params` is a Promise, `export const runtime = "nodejs"`. Turbopack does not map `./x.js` imports to `.ts` (D18). A runtime path built from `process.cwd()` must carry `/*turbopackIgnore: true*/` or the whole repo is traced into the server bundle.
- **`NEXT_PUBLIC_*` values are build-time.** Rebuild after changing addresses. Production: `NEXT_PUBLIC_NETWORKS=aevum`.
- **Contract verification on the explorer** is documented as broken. Try `forge verify-contract --verifier blockscout` once (S10). Otherwise publish addresses + commit.
- `contracts/broadcast/` is gitignored; write `deployments/aevum.json` from the deploy script (addresses, block, git SHA).

## Honesty rules (from BUILD_CONTRACT.md)
- Never fabricate data, numbers, test counts or tx hashes. Show `—` until real.
- No silent fallbacks, no empty `catch`, no `|| default` on values that matter.
- `UNKNOWN` is never success and has no resend edge.
- Anything not built is listed as not built. New ideas go to `ROADMAP.md`.
- Failed runs stay on record.

## Conventions
- TypeScript strict, no `any`. Zod `.strict()` at every boundary. Money as BigInt base units. Chain IDs as literals.
- Pure core: `packages/shaida-proofs` (witness building, verification steps) has no network or framework imports; inject the RPC client and `now`.
- Closed error codes from PRD §4: `{code, message, retryable, nextAction}`. User messages say whether anything changed.
- Names over comments. Split files past ~180 lines. Check the UI at 390px wide.
- Tests named as behaviour, with acceptance or attack IDs in titles (`X04 refuses the same payment counted twice`).
- Never hide test failures (no `| tail` that drops the exit code).
- Commits: behavioural subject; body says what changed, how it was verified, and the test count. Never rewrite history.
- Licence headers: keep SPDX and copyright on copied files. Put a source comment (repo, author, licence) above borrowed snippets. Update NOTICE.md in the same commit.

## Commands (target shape; make them real as you build)
- `make install` (submodules + pnpm)
- `make build` (forge build + Shanghai check + circuit compile)
- `make test` (unit + circuit)
- `make test-fork` (real tUSD8 via https://rpc-test.qday.info)
- `make fork`, `make deploy-fork`, `make deal TO=…`
- `make deploy-aevum ACCOUNT=<keystore>`: legacy txs, writes deployments/aevum.json
- `make gate`: clean-clone gate (build, typecheck, lint, all tests, Shanghai check, claims check)
