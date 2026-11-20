# Gloam SDK and contracts (our privacy engine)

Researched: 2026-11-20
Primary sources: github.com/gloamtrade/gloam (cloned, MIT, latest commit 2026-11-19). Read: `packages/sdk/src/{builders,constants,incoming,paymentNote}.ts`, `contracts/circuits/{receipt,payroll_total,solvency}/*.circom`, `contracts/foundry.toml`, `contracts/src/`, `DEPLOY-ELYSIUM.md`.
Canonical repo: gloamtrade/gloam, npm `@gloamtrade/sdk` (v0.8.0 in repo). Other GitHub repos named "gloam" (hey-research-lab, cryptoduke01, GOLDBERG8) are forks/mirrors. Pin to gloamtrade.

## What it actually is
A self-custodial ZK shielded pool. Notes are Poseidon(secret, amount, asset) in a depth-20 incremental Merkle tree. Proofs are circom + Groth16. The SDK builds intents, notes, witnesses and proofs; contracts verify and move tokens.

## Core concepts you need before building
- **Shield** is a public deposit (amount and asset visible). Later sends are unlinkable to it.
- **Private send** pays a receive address (`gloamr1.…`). The payer **creates the payment note secret** and seals it (`gloam2t.…`) to the payee's receive key. It's posted on a pay-memo board (`GloamPayMemo`) where deployed, otherwise handed over directly.
- **Until the payee sweeps** (`sweepReceivedNote` into a fresh note only they know), the payer can spend the note back. A payment "is not yours until you secure it" (sdk `incoming.ts`).
- **Existing proofs:**
  - `receipt`: one note ≥ minAmount, optional exact reveal, bound to a context (label, expiry, chain, pool)
  - `payroll_total`: payer proves total and count over ≤ 32 payments *sent*, linking each payment note to the spend nullifier that funded it
  - `solvency`: balance ≥ threshold over ≤ 4 unspent notes
- **No proof covers payments *received* over time or who paid.** That's Shaida's gap.

## Minimal working shape on an unknown chain (Aevum 44005)
- Builders take `chainId` and `poolAddress`. Without a pool: `Gloam has no pool on chain 44005. Pass poolAddress.`
- `ceremonyForChainId(44005)` → `"dev"` keys. Per a sdk comment, testnets use **single-party dev keys**, so whoever made them could forge proofs.
- `isPaymentsPoolChainId(44005)` → false, so the SDK uses the **plain `shield()` path** of `ShieldPoolPoseidon`, not the hardened `ShieldPoolPayments` (proof-bound deposits, limits, fee). Some features (swaps) refuse unknown chains.
- Artifacts (wasm/zkey) are fetched from `https://www.gloam.trade/circuits` by default; the base URL is a parameter of `circuitArtifactUrls`.

## Defaults and ordering that matter
- Contracts compile with `solc 0.8.24`, `evm_version = "shanghai"`, matching Aevum.
- Log sync defaults assume big ranges (the Elysium guide mentions 1,000,000 blocks per call, with an env override `*_LOG_RANGE`). Aevum needs ≤ 1,000.
- Payment counts only if its code opens the named commitment, and the note is in the vault and unspent, read at one pinned block.
- Deploy scripts exist per chain (`contracts/script/Deploy*.s.sol`, `MainnetDeploy.sol`, `DeployPoseidon.s.sol`, `DeployGloamPayMemo.s.sol`). There's none for Aevum, so we write ours, modelled on a testnet script.

## Known gotchas / traps
- Using dev keys on Aevum means a single-party setup. Either use the final ceremony keys with a `ShieldPoolPayments` deploy, or state the limit plainly.
- Payer-known secrets mean any "received" proof must count only swept notes (IDEA_CHECK R1).
- SDK hardcodes network tables; expect to pass explicit config everywhere and read SDK source, not docs, for behaviour.

## Verified by spike S2 (2026-11-20, local chain with Aevum rules)
- SDK 0.8.0 works on chain 44005 with explicit `chainId` + `poolAddress`.
- Proving keys are chosen by the caller: `artifactProver({ wasm, zkey })`. With `*VerifierFinal` contracts deployed, the **final ceremony keys** work on Aevum, so we don't need the single-party dev keys.
- Deposits must use `buildShieldBoundIntent` (pool with a shield verifier refuses plain `shield`).
- The sweep's `Transferred(nullifier, [c0, c1])` event links the payment note to the recipient's fresh note. After a sweep, a payer clawback reverts `AlreadySpent`.
- Gas: pool 5.04M; deposit 1.10M; private send/sweep 1.79M; unshield 0.32M.

## Unverified: confirm with a reality spike
- S2: `ShieldPoolPoseidon` + verifiers + Poseidon deploy cleanly on Aevum rules; Groth16 verify gas is acceptable.
- S2: can the SDK be pointed at final (ceremony) keys on an unknown chain, and a `ShieldPoolPayments` deploy?
- S3: tree sync with 1,000-block pages.
- S5: sweep links (payment nullifier → fresh note) are observable enough to build the R1 circuit constraint.

## Explicitly out of scope
Gloam's swaps, bridge, x402 cash-out, its hosted relay/API (we don't depend on Gloam's servers), and its existing pools on other chains.
