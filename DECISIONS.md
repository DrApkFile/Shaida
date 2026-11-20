# DECISIONS

## D1: Gloam as the private-payment engine
Context: building a shielded pool from scratch in 3 weeks solo is infeasible. Gloam (MIT) works on Aevum rules (S2).
Decision: reuse Gloam contracts and SDK as a pinned dependency with licences kept; Shaida's work is the income-proof layer.
Rejected: own pool (time, risk); no privacy (no differentiation).
Consequence: credit per organiser rules (EVENT.md); the judging story centres on what is new.
Where: contracts/lib/gloam, NOTICE.md

## D2: Gloam final ceremony keys, not dev keys
Context: SDK defaults unknown chains to single-party dev keys (GLOAM_SDK.md).
Decision: deploy `*VerifierFinal` and prove with `*_final.zkey` (works, S2).
Rejected: dev keys (forgeable by their creator).
Where: deploy script, prover config

## D3: Vouch and sweep leaves in a Shaida ledger tree, checked in-circuit
Context: payer signatures checked outside the circuit would reveal commitments to the reader and add work. Sweep links exist only in event logs (S5).
Decision: `ShaidaLedger` wraps `pool.transfer` and inserts V = Poseidon(1, payerId, Cp) on vouched pays (active payer only) and S = Poseidon(2, N, Cs) on sweeps. The circuit proves membership of both.
Rejected: off-circuit EIP-712 checks (leaks commitments, more verifier code); event-log links revealed to the reader (leaks timing per payment).
Consequence: one extra Poseidon insert per pay and sweep (~0.7M gas est., to measure). Revocation applies to future payments only.
Measured 2026-11-20 (evidence/fork-gas.md, fork): the ledger adds 904,454 gas per vouched pay (vouchedPay tx 2,744,507 vs
the same proof sent to the pool 1,840,053); sweep tx 2,697,238. Higher than the estimate; still ~2.7M of a 30M block,
≈ 0.0027 tQDAY at 1 gwei. `vouchedPayFor` takes `payer` and `deadline` besides the transfer and signature (EIP-712
`Vouch` over root, nullifier, both new commitments and deadline).
Where: contracts/src/ShaidaLedger.sol, circuits/income.circom

## D4: Groth16 with a multi-party phase 2, not PLONK
Context: S7: PLONK proved in 28.8 s with a 163 MB zkey; Groth16 in 3.4 s with 20 MB, at similar gas.
Decision: Groth16; Hermez phase 1 (b2sum verified) + ≥ 2 contributors + public beacon.
Rejected: PLONK (browser UX); single-party setup (forgeable).
Where: CEREMONY.md

## D5: Proof links carry data in the URL fragment
Context: avoid storing proofs or personal data server-side.
Decision: `/v#<payload>`; verification happens client-side, plus an optional on-chain view or attest call.
Rejected: server-stored proofs (privacy, storage).

## D6: Licence mix
Decision: MIT for Shaida code. GPL-3.0 headers kept on snarkjs-generated verifiers and circuits that include circomlib; listed per file in NOTICE.md (EVENT.md).

## D7: Named refusals for tUSD8 pause and blacklist
Context: S9 (2026-11-20) measured tUSD8 as FiatTokenV2_2: one EOA can pause the token and blacklist any address,
and a blacklisted account can still `approve`, so failures show up only at the pull, as a generic revert.
Decision: add `TokenPaused`, `PayerBlacklisted` and `RecipientBlacklisted` to the closed codes (PRD §4). The app reads
`paused()` and `isBlacklisted(address)` before deposit, pay and withdraw and refuses before any signature.
`ShaidaDepositor` checks `paused()` and the payer's blacklist status on chain and reverts with the same names.
Rejected: relying on `approve` or the pull to fail (approve succeeds; the pull's revert string is not a closed code).
Consequence: the issuer's powers stay a trust assumption (LIMITS.md, PRD §8 "Not defended"); we only make them legible.
Where: PRD §4, contracts/src/ShaidaDepositor.sol, LIMITS.md

## D8: Gloam pool variant and deposit limits
Context: Gloam ships `ShieldPoolPoseidon` (testnet pool; sealed swaps possible but off when unset) and
`ShieldPoolPayments` (mainnet payments-only pool). Gloam requires deposit limits before `endSetup()`; after it,
limits can be lowered at once but raised only through a 3-day timelock.
Decision: keep `ShieldPoolPoseidon` with `sealedSwapVerifier` left unset (checked by the deploy script), as tested in S2.
tUSD8 limits: 100 tUSD8 per deposit (100000000 base units), 10,000 tUSD8 in total (10000000000), set in the Makefile.
Rejected: `ShieldPoolPayments` (smaller surface, but not what S2 exercised end to end with the SDK on 44005; switching
would need a new spike). Higher limits (the demo moves single-digit tUSD8; faucet gives 5 tUSD8 per address).
Consequence: more than 10,000 tUSD8 in total needs a timelocked raise or a new pool.
Where: contracts/script/DeployStack.s.sol, Makefile

## D9: Front-running repairs: lateVouch yes, sweep repair no
Context: Gloam's pool accepts `transfer` from any sender. A `vouchedPay` or `sweep` copied from the mempool and sent to
the pool first spends the note with no leaf in `ShaidaLedger` (LIMITS.md). Whether Aevum's RPC shows pending
transactions is recorded in LIMITS.md (probed 2026-11-20; inconclusive, so we assume it can).
Decision (copied vouchedPay): `ShaidaLedger.lateVouch(paymentCommitment)` and `lateVouchFor(paymentCommitment, payer,
deadline, sig)` (EIP-712 `LateVouch(bytes32 paymentCommitment,uint256 deadline)`). Only an active registered payer
(`activeIdOf`, so `PayerNotRegistered` / `PayerRevoked`). It inserts V = Poseidon(1, payerId, Cp) and emits the same
`Vouched` event. The ledger now writes **at most one V leaf per commitment** (`vouched[Cp]`, `AlreadyVouched`), on
both `vouchedPay` and `lateVouch`, and `lateVouch` needs a commitment the pool has seen (`UnknownCommitment`).
Why it is safe: a V leaf counts in an income proof only with an S leaf for the same note, and S leaves come only from
a real `sweep` of that note through the ledger, which needs the note's secret. So `lateVouch` adds nothing a
registered payer could not already do with `vouchedPay` (paying a colluding recipient is "Not defended", PRD §8).
Why one V per commitment: two V leaves for one Cp would let the circuit count one payment twice (two increasing V
indices, one shared S leaf). Before D9 the pool's `commitmentSeen` already prevented that for `vouchedPay`;
`lateVouch` would have reopened it.
Consequence: a late-vouched payment's V index (and so its date in a proof) is the `lateVouch` time, not the payment
time. `vouchedPay` costs one more storage write and one pool read (re-measured in evidence/fork-gas.md).
Rejected (copied sweep): a repair function for a missing S leaf. The ledger cannot tell which note a nullifier spent
(the pool stores no nullifier→commitment link, S5), so anyone could write S = Poseidon(2, N, Cs) for a payment that was
never swept, or for one the payer clawed back. That breaks R1 (only swept payments count, X08). A note whose sweep was
copied stays uncounted; the recipient's funds are safe (the copied proof sends them to the recipient's own sweep note).
Tests: contracts/test/ShaidaLedgerLateVouch.t.sol (9).
Where: contracts/src/ShaidaLedger.sol, PRD §3, LIMITS.md
