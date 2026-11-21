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
time. `vouchedPay` costs one more storage write and one pool read: measured 2026-11-20 (evidence/fork-gas.md, fork,
commit b0d094b) 2,767,881 gas per tx, up 23,374 from 2,744,507; ledger overhead 927,828.
Rejected (copied sweep): a repair function for a missing S leaf. The ledger cannot tell which note a nullifier spent
(the pool stores no nullifier→commitment link, S5), so anyone could write S = Poseidon(2, N, Cs) for a payment that was
never swept, or for one the payer clawed back. That breaks R1 (only swept payments count, X08). A note whose sweep was
copied stays uncounted; the recipient's funds are safe (the copied proof sends them to the recipient's own sweep note).
Tests: contracts/test/ShaidaLedgerLateVouch.t.sol (9).
Where: contracts/src/ShaidaLedger.sol, PRD §3, LIMITS.md

## D10: Three closed codes for building an income proof
Context: PRD §4 had `NotEnoughSlots` and `UnknownRoot` for the witness builder but no code for "nothing to count",
"not enough", or malformed input, and the builder must return a named refusal, never a fake witness.
Decision: add `NoSweptPayments` (no vouched, swept payment in the period), `BelowThreshold` (the counted payments add
up to less than the asked threshold) and `InputRejected` (the strict schema refused the input). All say "Nothing was
built". The builder counts every payment it can prove and lists the others with a reason (`notVouched`, `notSwept`,
`outOfRange`, `duplicate`); those reasons are statuses for the UI, not error codes.
Rejected: refusing the whole build when one inbox payment is unswept or unvouched (one stray payment would block every
proof); per-payment error codes (they are not failures of the request).
Where: PRD §4, packages/shaida-proofs/src/errors.ts, src/witness.ts

## D11: income.circom v1, as built (what the PRD left open)
Context: PRD §3 fixes the formulas, 8 slots, depth 20 and the public signals; these details were not fixed.
Decision:
- **Compile with `--O2`.** Measured 2026-11-20, circom 2.2.3: `--O2` gives 89,231 non-linear + 0 linear constraints
  (89,239 with public inputs, fits the 2^17 ptau); `--O1` gives 90,363 + 100,908 = 191,271 (would need 2^18).
  `--O2` substitutes linear relations (e.g. `used[7] = count − Σ others`, `used[0] = 1`); the constraint system is
  equivalent, and the count/gap/zero tests exercise exactly those.
- **Bounded public inputs.** `fromIndex`, `toIndex` < 2^20 and `threshold` < 2^68 (Num2Bits). circomlib comparators
  are only sound on inputs within their bit width; a threshold like p − 1 would otherwise read as "≥ −1".
  8 × (2^64 − 1) < 2^68, so every real sum and threshold fits.
- **`context` bound by a dummy square** (`contextSquare <== context * context`). A public input in no constraint
  has a zero verifier term, so the proof would verify under any context (any reader, any expiry).
- **Leaf index from the path bits** (`Σ pathIndices[i]·2^i`), as in spike S4. Merkle template adapted from Gloam's
  `merkle_poseidon.circom` with the root as an output, so it is only required for used slots.
- **Gating.** Every per-slot check is multiplied by `used[i]` except the 64-bit amount range check and the hashes,
  which unused slots satisfy with zeros. `count ≥ 1` is `used[0] = 1` (used slots come first).
- **No double count needs D9.** Strictly increasing V indices stop reuse of one V leaf; D9 guarantees one V leaf per
  commitment, and an S leaf is fixed by its payment note, so one payment cannot fill two slots.
- **JS Poseidon is poseidon-lite (MIT, sync, no wasm),** not circomlibjs, in the pure core. Equality with the on-chain
  circomlibjs bytecode is tested: contracts/test/IncomeVectors.t.sol replays the vectors the circuit proves over.
Rejected: `--O1` with a 2^18 ptau (2× the setup and key size for the same constraints); unbounded comparators.
Consequence: r1cs sha256 `4f4af7bd587cfc68b69e43dbb7fd431d6f70e4c52a3010eebbda25f0925af81e` is the v1 candidate for
the phase-2 ceremony (step 3). Any change to income.circom or its includes changes it and needs a new ceremony.
Measured 2026-11-20 (evidence/income-circuit.md, throwaway key, Node, Intel i3 M 370, 4 threads): zkey 50.6 MiB;
`fullProve` median 49.8 s for 8 used slots, 43.5 s for 1 (run at commit 6509216, 10:59 UTC); re-run on a clean tree
at commit 2472f27 (11:10 UTC): 31.2 s and 30.1 s. Same key, circuit and machine; it is a shared desktop (browser and
other processes running, 15-min load ~5), so we take ~30–50 s as the range, cause of the spread not identified. The
circuit always evaluates all 8 slots. S7 estimated ~7 s on another machine. EVAL C5 (≤ 30 s in a mid-range browser) is open until S8 runs on a mid-range laptop.
Superseded in part by D12 (4 slots per proof; new r1cs). The bounds, `--O2`, context binding and gating above still hold.
Where: packages/shaida-proofs/circuits/, evidence/income-circuit.md

## D12: 4 slots per proof, with bundles
Context: slot count had to be final before phase 2. Spike S8 measured the same `Income` template at 8 and 4 slots
(throwaway keys; evidence/s8-browser.md). Real periods hold more than 8 payments, so bundling is needed either way.
Numbers (total = witness + prove + verify):
- Builder's phone (reported by the builder, cold run 1): 8 slots 38.87 s, 4 slots 19.43 s, both verified; the 8-slot
  second run stalled on the phone (likely memory) and never finished.
- Builder's laptop, headless Chromium 153, Intel i3 M 370 (4 logical CPUs, 7.5 GiB): warm medians 8 slots 37.48 s,
  4 slots 21.43 s (4/8 = 0.57); cold runs 8 slots 34.83 / 40.82 / 51.97 s, 4 slots 20.16 / 20.41 / 30.58 s.
- Size: 8 slots 89,231 constraints, zkey 50.6 MiB; 4 slots 44,687 constraints, zkey 25.3 MiB.
- After the switch (evidence/income-circuit.md, clean commit ac177d2, Node `fullProve`, same laptop): median 17.61 s
  for 4 used slots, 17.43 s for 1; the throwaway verifier passes the Shanghai check.
Decision (the builder's): the production circuit is `Income(4, 20)`, same template, circom 2.2.3 `--O2`. Its r1cs
sha256 `d866695ca2473e70408d288feafaec7181983480a688acac30b42156d305d82a` is byte-identical to the 4-slot variant S8
measured, and replaces D11's `4f4af7bd…` as the phase-2 candidate. A period is proved by a bundle of 1–8 proofs:
- Verification (PRD §5, `src/verify/`): every proof has the same `context` (so reader and expiry) and `asset`; every
  root passes `isKnownRoot`; leaf ranges strictly disjoint; total = Σ thresholds, count = Σ counts. New codes
  `RangesOverlap` and `MixedContexts`. (Superseded by D13: one root per bundle.) Roots may differ (append-only tree: an index names the same leaf under every
  known root); the builder uses one root for all proofs.
- Builder (`buildIncomeBundle`, `src/split.ts`): payments in V-leaf order, ≤ 4 per proof; ranges tile the asked
  period with each boundary halfway between neighbouring proofs' V leaves; the threshold is split by water-filling
  (equal shares, capped at each proof's sum), which reveals a proof's exact sum only when it is below the share.
- Limit: 8 proofs (32 payments) per bundle, chosen by the agent to bound link length (~5 KB) and verification work;
  `NotEnoughSlots` now means more than 32 payments.
Rejected: 8 slots (about 2× the proving time per proof on both devices, and the stalled phone run); one proof per
period with more slots (cost grows with every slot, used or not); an even or proportional threshold split (even fails
when a proof's sum is below the share; proportional reveals every proof's share of the total).
Consequences: a bundle discloses each proof's sub-threshold, sub-count and sub-range, and the boundaries narrow where
payments sit (EVAL C3 rev. 3, LIMITS). Proving a period takes ⌈N/4⌉ proofs. The ceremony (step 3) keys the 4-slot r1cs.
Tests: test/verify.bundle.test.ts (9, Groth16 replaced by a witness-checked stand-in), income.honest.test.ts bundle
cases (5), property test over 1–13 payments, income.groth16.test.ts real 2-proof bundle (3, local).
Where: packages/shaida-proofs/{circuits/income.circom,src/split.ts,src/witness.ts,src/verify/}, PRD §3–§5, EVAL_DESIGN rev. 3

## D13: one root per bundle, shares in whole tUSD8, cap kept, circuit frozen
Context: D12 left three questions to the builder: whether a bundle may mix ledger roots, whether to keep the cap of
8 proofs, and how much a capped threshold share may reveal (the water-filling split showed a chunk's exact sum).
Decision (the builder's):
- **One ledger root per bundle.** Every proof of a bundle must have the same `ledgerRoot`, in addition to that root
  passing `isKnownRoot`. New closed code `MixedRoots` (not retryable, "ask for a new link"), checked as PRD §5 step 2b,
  before the range check (ranges are now 2c). Mixed roots were sound under D12 (append-only tree), but the builder
  never produces them, so a mixed bundle was joined from separate builds; refusing it is the narrower rule and
  makes step 6 one `isKnownRoot` read. Test X18 (EVAL rev. 4): two builds of the same period before and after one more
  leaf, both roots known, each build alone VALID, the joined bundle `INVALID(MixedRoots)`.
- **Cap kept at 8 proofs / 32 payments** (D12 unchanged).
- **Threshold shares rounded down to a step.** The builder's water-filling runs in whole steps: each share is a
  multiple of `shareStep`, at most its proof's sum rounded down to the step. Default step 1 tUSD8 (1,000,000 base
  units, `SHARE_STEP`); a request may set `shareStep` to any positive multiple of it. So a capped share shows a
  proof's sum only to the step, never to the base unit. Consequences: the asked threshold must be a multiple of the
  step (`InputRejected` otherwise; the UI asks for whole tUSD8), and a threshold the raw sums reach but the rounded
  sums do not is refused with `BelowThreshold` (the message gives the most the bundle can show). The verifier does
  not check the rounding: it is a privacy choice of the recipient's builder, not a soundness rule.
- **Circuit frozen for the ceremony.** `income.circom` = `Income(4, 20)`, r1cs sha256
  `d866695ca2473e70408d288feafaec7181983480a688acac30b42156d305d82a`. D13 changes only the pure core, not the circuit.
Rejected: allowing mixed roots (sound, but no honest use); a raised cap (longer links, more verification work, no
demand yet); unrounded water-filling (pins a capped proof's sum to the base unit); rounding the bundle total down
silently when the threshold is off-step (a silent change to what the user asked for).
Tests: verify.bundle.test.ts X18; split.property.test.ts "C3 no share ever equals an unrounded chunk sum" (5,000
random cases per run, steps 1–10 tUSD8) plus a refusal case; income.property.test.ts checks every proof's share is a
multiple of the step and never its unrounded sum; income.honest.test.ts coarser step (5 tUSD8), rounding
`BelowThreshold`, off-step `InputRejected`. Mutation check: dropping the root check fails X18; `SHARE_STEP = 1n`
fails both C3 property tests.
Where: packages/shaida-proofs/src/{split.ts,schema.ts,witness.ts,verify/verify.ts,errors.ts}, PRD §3–§5, LIMITS, EVAL rev. 4
