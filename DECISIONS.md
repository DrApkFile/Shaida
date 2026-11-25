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

## D14: IncomeVerifier checks more than the pairing; ceremony tooling
Context: PRD §3 asked for a snarkjs verifier wrapped with `require`, explicit gas guidance and an optional attest
event. A Groth16 proof is valid over any Merkle root its prover chose, so an on-chain "proof checked" is only
meaningful if the root is ShaidaLedger's. Step 3 also needed scripts for the phase-2 ceremony.
Decision:
- `IncomeVerifier.check(proof, signals)` (view) requires asset = tUSD8 (`AssetMismatch`), `ledger.isKnownRoot(root)`
  (`UnknownRoot`), at least `MIN_VERIFY_GAS` = 320,000 gas left before the pairing call (`InsufficientGas`, so a short
  gas limit is never reported as `ProofInvalid`), then the generated verifier's `true` (`ProofInvalid`). It never
  returns false. `attest` = `check` + `IncomeProofChecked(context, threshold, count)`. Callers set gas explicitly:
  400k for `check`, 420k for `attest`. Measured 2026-11-21 (forge, throwaway key): `verifyProof` 262,573 gas with
  the 7 public signals; the test asserts 1.1 × that < 63/64 × MIN_VERIFY_GAS. One proof per call; on-chain bundles
  are on ROADMAP.md. The generated verifier is reached through `IIncomeGroth16Verifier` (its `verifyProof`
  signature); unit tests use a placeholder and two THROWAWAY verifiers (`contracts/test/fixtures/income/`, made by
  `scripts/gen-verifier-fixtures.ts`). `DeployStack` does not deploy IncomeVerifier yet: the real verifier comes from
  `ceremony/finalize.ts`.
- Ceremony scripts in `ceremony/` (TypeScript, snarkjs 0.7.6 as a library so contribution hashes and the verify
  result are return values, not scraped output, except contribution names and hashes read from the `zkey verify`
  log, which the parser checks completely). `record.json` (strict schema) is the single record, extended by each
  step and rendered to TRANSCRIPT.md. The contributor list is taken from the verified zkey itself, and a contributor's
  reported hash is compared with it (`--expect`). Entropy is read at a hidden prompt, ≥ 32 characters, never stored.
  The beacon block (head + 7,115 blocks ≈ 2 h at 1.012 s) is announced in record.json, must be in a commit in
  origin/master dated before the block, and is used only after 64 confirmations, with the hash read twice. A
  DRY RUN mode (`CEREMONY_DIR`) rehearses every step outside the repo.
Rejected: a bare `require(verifyProof(...))` (accepts proofs over any root; a short gas limit reads as invalid);
shelling out to the snarkjs CLI and parsing its stdout for hashes (the prompt and the output share stdout);
entropy on the command line (stays in shell history).
Tests: contracts/test/IncomeVerifier.t.sol (13: AssetMismatch, UnknownRoot, ProofInvalid, InsufficientGas, attest
event and no event on refusal, zero addresses, key A accepts its proof, key B refuses it, X12 raised threshold, bare
verifier returns false short of gas, gas fit). ceremony/test/ceremony.test.ts (8).
Where: contracts/src/IncomeVerifier.sol, ceremony/, briefing/CEREMONY.md

## D15: superseding a verified contribution, never deleting it
Context: contribution #1 (commit `e7b116e`, zkey sha256 `18f2ec26…`) was made under the placeholder name "Your Real
Name". The name is stored inside the zkey for good, and the record had no way to drop a contribution.
Decision (the builder's): `ceremony/supersede.ts` (`make ceremony-supersede SHA256=… REASON=…`) marks the latest
active verified zkey `superseded: {reason, movedTo, at}` in record.json, keeps the entry and its verify log, moves
the file to `work/superseded/`, and shows it as SUPERSEDED with the reason in TRANSCRIPT.md. Every "latest zkey"
rule (contribute, verify's chain check, beacon announce, finalize) uses active entries only, so the redo starts from
`income_0000.zkey` and nothing can build on the superseded key. Refused for any zkey but the latest active one and
once the beacon is announced. Records written before this field read it as null (schema default), so the committed
record and the announcement-commit lookup still parse.
Applied 2026-11-21 to contribution #1 above; the builder redoes it under their real name.
Found on the way: option names with digits were refused by the argument parser (so `contribute --in-sha256` never
worked), and Makefile targets broke on a double quote in NAME/REASON/EXPECT. Both fixed; free text now reaches the
scripts as environment variables.
Rejected: deleting the entry or rewriting the commit (history stays); restarting the record (loses the setup
record and the log).
Tests: ceremony/test/supersede.test.ts (5), parseArgs digits case. Rehearsed on a dry copy of the real record:
short reason, double supersede and a contribution to the superseded zkey refused; redo from income_0000 contributed
and verified.
Where: ceremony/supersede.ts, ceremony/src/{record.ts,supersede-rules.ts}, briefing/CEREMONY.md

## D16: ledger and depositor write and emit before the external call; deadline timestamps accepted
Context: `forge lint` (1.10.0) flagged `reentrancy-events` in ShaidaDepositor (both `Deposited` emits) and
ShaidaLedger (`Swept`, `Vouched`), `block-timestamp` on the two signature deadlines, and
`environment-read-across-mutation` in two deadline tests.
Decision:
- **Depositor:** `Deposited` is emitted right after the paused/blacklist checks, before the token pull and the
  pool call. Every field is a call argument, so nothing needs the calls' results; a revert undoes the event.
- **Ledger, checks-effects-interactions:** `sweep` and `vouchedPay`/`vouchedPayFor` now insert the leaf and emit
  before `pool.transfer`. The leaf index comes from our own tree (`_tree.insert`), not from the pool, so no event
  needs a value known only after the external call; none kept the old order. Gloam's `transfer` reverts
  `DuplicateCommitment` on a seen commitment (`ShieldPoolCore.sol:434`), so a V leaf written first survives only
  for a fresh payment note, and the `commitmentSeen` read after the transfer is no longer needed on this path.
  `lateVouch` keeps both checks (`AlreadyVouched`, then `UnknownCommitment`, a view call) before writing.
- **Revert order kept:** on `vouchedPay` the `AlreadyVouched` flag is read before the pool call and acted on after
  it, so a replayed relayed pay still reverts with the pool's `AlreadySpent`, as before (the X02 test is unchanged).
- **`block.timestamp > deadline` accepted.** Signature windows are hours long (the app uses 1 h), and a validator
  can move a timestamp by seconds; the worst case is a signature accepted or refused a few seconds off its edge.
  The two warnings stay.
- Tests use `vm.getBlockTimestamp()` for deadlines that are later `vm.warp`ed past.
Gas (evidence/fork-gas.md, fork, re-run after the change): vouchedPay tx 2,766,976 (−905, the dropped
`commitmentSeen` call), depositWithAuthorization 1,346,538 (+44), sweep 2,697,283 (+38); ledger overhead per
vouched pay 926,923 (was 927,828). The +44/+38 come from the reordered code, with the same calls and storage writes.
Tests: forge unit 52/52, fork 12/12 with unchanged expectations.
Where: contracts/src/{ShaidaLedger,ShaidaDepositor}.sol, contracts/test/{ShaidaLedger,ShaidaLedgerLateVouch}.t.sol

## D17: closed codes for the relayer, pay and inbox flows
Context: PRD §4 had no code for a spent note (the exit check refuses a clawback with `AlreadySpent`), a duplicate
vouch, a bad payer signature, rate limits, an unusable relayer, a simulation revert, or a network with no Shaida
contracts. Every refusal must be a closed code (BUILD_CONTRACT "No silent fallback").
Decision: add `AlreadySpent`, `AlreadyVouched`, `SignatureInvalid`, `RateLimited`, `RelayerUnavailable`, `TxRejected`
and `NotConfigured` to PRD §4 and `packages/shaida-proofs/src/errors.ts`. The names of the first two match the
contracts' own errors (Gloam `AlreadySpent`, ShaidaLedger `AlreadyVouched`). `TxRejected` is only for a revert that
no other code names; the relayer decodes known custom errors first. An explicit per-function gas cap that the
estimate exceeds is `RelayerBudgetExceeded` (same next action: pay the gas yourself).
Rejected: HTTP statuses alone (the UI and bot need the same names); one generic `RelayFailed` (says nothing about
whether anything changed).
Where: PRD §4, packages/shaida-proofs/src/errors.ts

## D18: the indexer serves one whole snapshot and starts over on any gap
Context: PRD §3 asks for leaf snapshots with chunked reads, retry and a persisted cursor; FAILURE_MODES asks for
the tree to be marked incomplete on any partial result.
Decision (`packages/shaida-index`, served by `GET /api/index?chainId=`):
- Pages of `toBlock − fromBlock ≤ 999`, one `eth_getLogs` per page for the pool, the ledger and the memo board
  together, read in order; each page is retried with exponential backoff (5 tries, 0.5 s doubling to 8 s). A page
  that keeps failing stops the sync; the cursor stays at the last good page.
- The snapshot is the cursor: it is saved (atomic file write, `web/.data/index-<chainId>.json`) after every page.
  At most 10,000 blocks are read per request, so a cold start on 44005 takes several polls, never one long call.
- After reading, both leaf counts are compared with `nextIndex()` of the pool and the ledger, read **at the cursor
  block**. A leaf index that is not its position, or a count mismatch, is recorded in `problems`; such a snapshot is
  incomplete, the client refuses it (`UnknownRoot`), and the next sync rescans from the deploy block (the only case
  that does).
- The memo board's `PaymentMemo` events ride in the same snapshot (no tree; the recipient checks each one).
- Client check (`checkSnapshot`): schema, chain id, complete, every ledger leaf recomputed from its event fields,
  both roots rebuilt and `isKnownRoot` on both contracts at the snapshot block. Any failure → `UnknownRoot`.
Rejected: incremental "rewind to the last good block" on a mismatch (needs per-block history; a gap should be rare);
browser-side log sync from the deploy block (S3: ~85 pages a day of chain).
Consequences: the file store is per process and per disk. On serverless hosts it is lost on a cold start, which
costs a rescan, not correctness (ROADMAP: KV store). No reorg handling beyond the count check; `confirmations` can
keep the index behind the head.
Tests: packages/shaida-index/test/index.test.ts (11: I01 page boundary, I02 cursor resume and redeploy, I03 retry
and a page that keeps failing, I04 gap → incomplete → UnknownRoot → full resync, I05 honest snapshot, altered pool
leaf, altered ledger fields, wrong chain, extra field, I06 memos).
Also: relative imports in the TypeScript packages are now extensionless (`./x`, not `./x.js`): Next 16's Turbopack
does not map `.js` to `.ts`; tsc (`moduleResolution: bundler`), tsx and esbuild resolve both.
Where: packages/shaida-index, web/src/server/{indexer,chain,json-file}.ts, web/src/app/api/index/route.ts

## D19: the relayer: five routes, rails before simulation, a gas budget, records before the send
Context: PRD §3/§8 A5 and AEVUM_INTEGRATION §4 (the kit's relay route plus ten hardening items).
Decision (`packages/shaida-relay`, routes `web/src/app/api/relay/<fn>/route.ts`):
- **One route per contract function:** `deposit` → `ShaidaDepositor.depositWithAuthorization`, `vouched-pay` →
  `ShaidaLedger.vouchedPayFor`, `late-vouch` → `lateVouchFor`, `sweep` → `sweep`, `memo` → `GloamPayMemo.postMemo`.
  Each encodes its single call from a strict body; no route takes calldata or a target. `memo` is a fifth route the
  task list did not name: the recipient's inbox reads the memo board, and a payer on the gasless path has no gas to
  post it. It only posts for a commitment the ledger has vouched, at most once per commitment, ≤ 2,048 bytes.
- **Rails, in order:** per-IP limit (20/min) before the body is read; strict schema; network configured and a
  usable key (anvil keys only on 31337/440050); one live record per key (nullifier or commitment, chain-scoped: a
  repeat returns the existing record); per-payer limit (6/min); off-chain checks (signature windows ≤ 1 h and ≥ 1 min
  left, EIP-712 signer recovered locally); chain checks at **one pinned block** (tUSD8 `paused`, payer
  `isBlacklisted` on deposit and pay (D7), `activeIdOf` = registered and active payers only (hardening item 8), note
  unspent, pool root known, output notes unseen, not already vouched); budget; balance floor (0.01 tQDAY);
  simulation (revert decoded to a closed code, D17); `estimateGas` ≤ the function's explicit cap; gas limit =
  min(estimate × 1.3, cap). Caps from evidence/fork-gas.md: deposit 1.6M, vouchedPay 3.2M, lateVouch 1.2M, sweep 3.1M,
  memo 0.25M.
- **Gas budget, not a tx count:** per UTC day, every in-flight record holds its gas limit and every mined one its
  gasUsed (default 150M gas/day, `RELAYER_DAILY_GAS_BUDGET`); dropped ones hold nothing.
- **Records before the send:** the legacy tx is signed locally (nonce = the relayer's pending count; one submission
  per chain at a time), its hash is computed and the record persisted as `accepted`; then `sendRawTransaction`.
  Node answered with an error → `dropped` (budget released); no answer or an unclear HTTP failure → `unknown`
  (`TxOutcomeUnknown`). `unknown` never resends: `GET /api/relay/status?id=` settles it by its receipt (→ `mined`,
  reverted or not) or by the relayer's latest nonce passing it with no receipt (→ `dropped`, the nonce went to another
  tx, so this one can never land). Only a dropped key may be submitted again. No code path re-broadcasts.
- State (records, key index, rate windows) is one JSON file under `web/.data`, written atomically and checked with a
  strict schema when read. Each state change logs request id, function, state, hash, nonce, gas, never bodies.
Rejected: the kit's in-memory maps (lost on restart; hardening item 3 asks for a store; a shared KV is on ROADMAP);
a viem nonce manager (a process-local counter drifts from the chain after an unknown send; the pending count from
the node does not); resubmitting with a higher gas price (a dropped-and-resent proof could double-submit; on Aevum's
fixed 1 gwei it buys nothing).
Consequences: one relayer key per process and one submission per chain at a time (enough for the demo; a key pool is
on ROADMAP). A stuck pending tx blocks the next ones on the same nonce until it lands or the node drops it.
Tests: packages/shaida-relay/test (22: R01 IP limit before parsing, R02 schema/unknown field/not JSON/unknown chain,
R03 payer limit, R04 TokenPaused/PayerBlacklisted before simulation with reads pinned to one block, R05 X02
unregistered/revoked payer, R06 foreign signer/long window/redirected payment, R07 AlreadySpent clawback, unknown
root, seen output, AlreadyVouched, memo for an unvouched payment, R08 revert mapping, R09 gas cap, R10 budget
reserve/settle/balance floor, R11 legacy tx with explicit gas, R12 unknown → same record, no second send → mined by
hash, R13 nonce used by another → dropped → resubmit allowed, node refusal releases the budget, R14 mined-reverted,
log lines carry no body, R15 each function calls only its contract function, R16 anvil keys). Mutation check:
removing the one-live-record guard fails R12.
Where: packages/shaida-relay, web/src/server/{relayer,relay-chain,relay-route}.ts, web/src/app/api/relay/

## D20: relayer corrections found by the first fork run of acts 2–3
Context: the first runs of `pnpm --filter @shaida/pay exit:acts-2-3` (evidence/acts-2-3-fork-FAILED-2026-11-21T16-*.md)
against the D19 relayer.
Found and fixed:
1. **A mined tx recorded as dropped.** `status` read the receipt (none yet), the block landed, then it read the
   relayer nonce (already past) and moved the record to `dropped` (tx 0xd826…8511, mined in block 3631935). Dropped is
   terminal, so the record stayed wrong. Now the nonce is read BEFORE the receipt: if the nonce had already moved
   past ours and a receipt read made after that finds nothing, the nonce went to another tx. Test R17 (fails on the
   old order).
2. **Someone else's record returned.** The one-live-record guard keyed on the nullifier answered Acme's clawback
   (a vouched pay spending payment 1) with Ada's mined sweep record of the same nullifier. Nothing was sent (and
   the chain would have reverted AlreadySpent), but the reply was another request's record. Records now carry
   `requestHash` = keccak256(function, parsed body); only an identical request gets the record back. A different
   request on a live key is refused with what the key protects (nullifier → `AlreadySpent` 409, vouch →
   `AlreadyVouched`, deposit commitment / memo → `InputRejected`). A mined-and-reverted record frees its key, as a
   dropped one does (a revert spent nothing). Tests R18 ×2.
3. A pay that spends a whole note has a zero-value change note; the flow's note schema refused amount "0". Test P06.
Consequences: relay-state files written before (2) fail the strict schema and are refused; the dev one was moved
aside. The failed runs stay in evidence/.

## D21: pay and inbox UI, browser proving, demo payer, memo route, kit pages removed
Context: PRD §3/§6/§11 acts 2–3, task 3 of the build plan.
Decision:
- `/pay` (payer) and `/inbox` (recipient) replace the kit's checkout, receipts, activity and docs pages and
  `examples/` (they taught the kit's Checkout contract, which Shaida does not deploy). Flows live in
  `packages/shaida-pay` (pure; prover, storage, RPC, clock injected) and are shared with the exit-check script.
- **Proving in the browser** with Gloam's shield/transfer circuits and FINAL ceremony keys, copied unchanged with
  Gloam's LICENSE into `web/public/gloam/` by `tools/copy-gloam-artifacts.mjs` (gitignored; run by `make install`,
  `predev`, `prebuild`). The browser re-checks each file's sha256 (`packages/shaida-pay/gloam-artifacts.json`) and
  proves from the checked bytes in memory. The same-named dev key is refused (test P07).
- **Vault:** every secret (payer notes, sent payment notes, the receive key, the inbox sweep notes) is sealed with
  AES-256-GCM under a PBKDF2-SHA256 (310,000 iterations) key from the user's passphrase and kept in localStorage per
  chain; the passphrase is held in memory for the tab only. The sealed blob is the exportable backup. Each note is
  saved BEFORE the signature or send that could make it the only copy of money.
- **Memo route:** the sealed memo (`gloam2t.` ticket, the payment note sealed to the recipient's `gloamr1.` tag) is
  posted by the relayer after the vouched pay (D19). The PRD names four relayed functions; this is the fifth.
- **Inbox states** follow PRD §6: seen → sweeping → swept | unknown. Swept is set only when the checked ledger tree
  holds the S leaf for this nullifier with the recipient's own fresh commitment. `unknown` has no resend edge;
  "Check again" reads the record and the chain only. A payment spent by someone else shows as taken back.
- **Demo payer (fork only):** `/pay` can create a payer key kept in the vault, labelled "Acme Studio (demo)", and only
  for chain 440050. `make register-payer TO=…` registers it with the fork's attestor. The inbox shows "Ada (demo)" on
  the fork; the home page says the personas are not real.
- **Income-proof key switch:** `NEXT_PUBLIC_SHAIDA_INCOME_KEY` = `final` (default) | `throwaway`; `incomeKeyFor`
  refuses `throwaway` on 44005 (test P01). The home page shows which key is set. No income-proof UI is built yet.
Verified: `node tools/ui-flow-fork.mjs` drives both pages in headless Chromium at 390 px with two isolated
profiles (deposit, vouched pay + memo, sweep), checks for horizontal overflow, writes evidence/ui-fork/.
Rejected: a server-side inbox scan (the receive key would leave the browser); a viem nonce manager in the UI (the
payer never sends).

## D22: Next.js 16.4.3 → 16.4.6 (security)
Context: `next dev` at 16.4.3 stopped with a security advisory. `pnpm audit` (2026-11-21) lists seven moderate Next
advisories for `<=16.4.4`, all patched in `>=16.4.5`: GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8 (`use cache` root
params), GHSA-7qx7-33qx-rqx2 (image optimizer SVG), GHSA-f3mh-rxg3-f5g2 (HttpOnly cookie on Edge routes),
GHSA-pc58-hwjq-p385 (self-hosted response forwarding), GHSA-rhh4-g77r-r9qj and GHSA-vvgp-ww4w-46vf (cache).
Decision: pin `next` 16.4.6 (latest 16.4 patch, released 2026-11-09).
API differences found (diff of `node_modules/next/dist/docs` 16.4.3 vs 16.4.6): documentation only for the APIs this
app uses. The upgrade guide now lists `experimental.viewTransition` and `experimental.appNewScrollHandler` as removed
(we set neither); `use cache`, Proxy, image and navigation guides were reworded. Route handlers, `params`,
`transpilePackages`, `next/font` and `next/link` are unchanged.
Also fixed: `next build` warned that `dataDir()` (`process.cwd()` + `.data`) traces the whole project into the server
output; it now carries `/*turbopackIgnore: true*/`. The build has no warnings.
Verified on branch chore/next-upgrade (own worktree): make build, make test (forge 52, circuit 46, indexer 11,
relayer 25, pay 9, ceremony 14), make test-fork 12, web typecheck, `next build` (first run, no
advisory stop), and PRD §11 acts 2–3 against `next start` (production): evidence/next-upgrade/acts-2-3-fork.md and
evidence/next-upgrade/ui-fork/ (390 px, 0 px overflow). One UI run failed because Chromium's debugging port took
longer than the tool's 10 s wait (kept); the wait is now 60 s.

## D23: `make gate`, the lint it runs, and CLAIMS.md
Context: BUILD_CONTRACT "Gate" (seven steps) and "README claims ⊆ PROVEN".
Decision:
- `tools/gate.sh` (`make gate`) clones HEAD into a temp dir (committed work only; submodules from .gitmodules) and
  runs: 1 `pnpm install --frozen-lockfile` + Gloam artifacts sha256-pinned; 2 forge build + Shanghai check; 3 circuit
  compile + `tools/check-artifacts.mjs` (income.r1cs = the r1cs the ceremony is bound to in ceremony/record.json;
  after finalize, vkey, verifier, the deployed verifier copy and, if present, the final zkey); 4 `pnpm -r typecheck` +
  `tools/lint.mjs`; 5 every unit suite; 6 fork tests against real tUSD8 when `eth_chainId` on the Aevum RPC is 0xabe5,
  otherwise INCONCLUSIVE (exit 3; never a pass, and printed in the summary); 7 `tools/check-claims.mjs`. The first
  failing step stops the gate. CI runs it in place (`GATE_IN_PLACE=1`) and reports INCONCLUSIVE as a warning.
- Lint: the repo has no ESLint. `tools/lint.mjs` runs `forge lint` and fails on any finding not in
  `tools/lint-allow.json` (matched by lint id, file and exact source line, with a count; today only D16's two
  `block-timestamp` deadline checks, plus four `inconsistent-type-names` (`uint`) findings in the generated income
  verifier, which is hash-pinned ceremony output and never edited: D24), and enforces the CLAUDE.md rules tsc cannot: no `any`, no empty `catch`. It found
  three in kit code, now fixed: an `as any` in `packages/aevum/src/logs.ts` (now viem's own parameter type) and two empty
  catches in `web/src/lib/network.tsx` (now say what they fall back to).
- CLAIMS.md lists every README claim (CL01–CL24, PROVEN with paths or test IDs that the checker resolves; `absent:`
  for "not deployed") and four claims a reader might assume but that are NOT PROVEN (CL30–CL33). README statements
  carry `<!-- CLnn -->` markers; the intro now states the product as an aim. The checker fails on an unmarked
  statement, a cited NOT PROVEN claim, missing evidence, or a `make` target README lists that does not exist.
- To prove the vault backup claim (CL23), `tools/ui-flow-fork.mjs` now exports Ada's backup after the sweep and
  restores it in a third, fresh browser profile: a wrong passphrase is refused, the right one restores the same
  receive address and the swept payment (evidence/ui-fork/08-restored-from-backup.png).
Rejected: adding ESLint now (a new toolchain and config for two rules); `forge lint` with `block-timestamp` excluded
globally (would hide a new misuse). Mutation-checked: an added `any`, an empty catch, a README line citing CL31, and
an unmarked README line each fail the gate.

## D24: the ceremony's income verifier in the deploy
Context: the ceremony finalized (e370842): final zkey sha256 cbcb06fe…, verifier
`contracts/src/generated/IncomeGroth16Verifier.sol` (96db550b…). DeployStack had no IncomeVerifier ("not built yet").
Decision:
- DeployStack deploys `IncomeGroth16Verifier` (imported from `src/generated/`, the finalize output, never copied) and
  `IncomeVerifier(groth16, ShaidaLedger, tUSD8)`. `DeployChecks.requireIncomeKey` then refuses the deploy unless the
  verifier accepts `contracts/script/fixtures/income-final-proof.json` (an honest proof made with the final zkey by
  `packages/shaida-proofs/scripts/gen-final-fixture.ts`, which checks the zkey and vkey hashes against
  ceremony/record.json first) and rejects `test/fixtures/income/throwaway-proof.json`, a throwaway-key proof of the
  same seven public signals, and unless IncomeVerifier points at that verifier, the ledger and tUSD8. Same shape as
  Gloam's final-accept/dev-reject check (D2).
- `tools/write-deployment.mjs` expects both creates, drops `notBuiltYet: ["IncomeVerifier"]`, and records
  `incomeKey` (zkey sha256 and verifier file from ceremony/record.json); it refuses when the ceremony has no final key.
- The throwaway-key switch (`NEXT_PUBLIC_SHAIDA_INCOME_KEY`) is read only by the browser flows (web/src/lib/flows.ts),
  where `incomeKeyFor` refuses it on 44005 (P01). No deploy target, script or recorder reads it, and the throwaway
  Solidity verifiers exist only under contracts/test/fixtures/.
Verified: forge tests K01–K05 (contracts/test/IncomeFinalKey.t.sol), including K04: the deploy check refuses a
throwaway verifier. `make deploy-fork` on `make fork` passed every check; on the fork node, `cast call verifyProof`
returned true for the final-key proof and false for the throwaway one; deployed runtime 1,909 bytes; `make test-fork`
12 passed.

## D25: Muuve's visual style, Shaida's name and mark
Context: the builder asked for the UI to use the visual style of their Muuve project (`../Muuve`) and for a written
design system. Muuve's own guide (`docs/muuve-frontend-guide.md` §7, v0.2) describes a dark aurora-glass theme; its
shipped code (`apps/web`, commit `49ba25e`) is a light cream/ink theme with four pastel hues and Inter Tight.
Decision:
- Follow Muuve's **shipped code**, written down in DESIGN.md with a source path per token and rule. Light only (Muuve
  has no dark mode). Plain CSS (Shaida has no Tailwind): one tokens file, `web/src/app/tokens.css`; `tools/lint.mjs`
  fails on a hex, `rgb()`, `hsl()` or `oklch()` colour in any other file under `web/src` (mutation-checked).
- **Nothing is copied from Muuve.** Its repo has no licence (no LICENSE file, no `license` field), and its hero icons
  and footer video (commit `5670e1d`, another author) record no source or licence, so they are not reused. Its
  `glass.css` and `how-it-works.tsx` read like community registry components with no source line, so only their look
  is followed, in new code. Inter Tight (SIL OFL 1.1) is loaded the way Muuve loads it (`next/font/google`, self-hosted
  at build). Values (colours, sizes, radii, shadows, easing) are taken as values.
- Muuve's branding stays Muuve's: no name, dot logo, verbs or copy. Shaida's mark is new: a ring, half filled ("shows
  half, hides half"), with the lowercase name in Inter Tight 600 (`web/public/brand/`, `BrandMark`).
- Shaida additions to the system: JetBrains Mono (SIL OFL 1.1) for hashes and addresses; a verdict style
  (VALID / INVALID / INCONCLUSIVE always in words, never colour alone); done steps stay readable (Muuve strikes them
  through; ours are evidence).
Rejected: copying Muuve's components or assets (no licence to copy them); adding Tailwind to match Muuve's source
(a new toolchain for the same values); Lucide as a dependency (ISC, but a dozen hand-drawn icons in its weight suffice).
Where: DESIGN.md, web/src/app/{tokens,globals}.css, web/src/components/Icons.tsx, web/public/brand/, tools/lint.mjs

## D26: a landing page and a dashboard
Context: the builder asked for a public landing page and one dashboard for the connected user (PRD §3 "Web pages",
§11). Until now `/` was a status checklist and `/pay`, `/inbox` were separate pages.
Decision:
- `/` is the landing page (public, no wallet): hook, how it works in 3 steps, who it is for, the trust story read from
  `ceremony/record.json` (contributors, beacon block and hash, final key hash) plus the repo link and LIMITS.md, and two
  CTAs: the dashboard and a live verify example. The example is a real link made by the acts 4–6 run on the configured
  network, given to the build as `NEXT_PUBLIC_SHAIDA_EXAMPLE_LINK` and labelled demo; without one, the CTA says that no
  example exists on this network yet (never a made-up link).
- `/app` is the dashboard: an overview (status checks of the old home page, and one card per section with counts read
  from the vault and the checked trees, `—` until read) and the sections `/app/pay`, `/app/inbox`, `/app/prove`,
  `/app/shared`. The pay and inbox screens move there unchanged in behaviour; `/pay` and `/inbox` redirect
  (`next.config.ts`), so old links and the acts 2–3 UI flow still work.
- `repoUrl` defaults to this repo (github.com/DrApkFile/Shaida), not the starter kit.
Rejected: one long `/app` page with all four sections (the pay and prove forms each need a full screen at 390 px);
a separate verifier app (the reader needs no wallet, and `/v` is already a public route).
Where: PRD §3, §11; web/src/app/{page.tsx,app/,v/}, web/next.config.ts

## D27: the income-proof screens (prove, share, verify)
Context: PRD §3, §5 and §7 acts 4–6. Several details were not fixed: how a reader's name becomes `readerIdHash`, how
dates map to leaf ranges, which keys the browser may use, and where shared links are kept.
Decision:
- **Final key only.** The prove and verify screens use only the ceremony's final key: the zkey is a local copy of the
  `ceremony-v1` release asset (`tools/fetch-income-key.mjs`, sha256 checked against `ceremony/record.json`), the wasm is
  `build/income_js/income.wasm` from the ceremony-bound r1cs compile, the vkey is the committed
  `keys/income_final_vkey.json`. `tools/copy-income-artifacts.mjs` copies the zkey and wasm to
  `web/public/circuits/income/` (gitignored) after checking both pins (`packages/shaida-pay/income-artifacts.json`), and
  the browser checks them again before proving. No throwaway file is ever served. The prove screen refuses to run unless
  `incomeKeyFor` says `final` (the throwaway switch stays refused on 44005, P01, and is now also refused by these screens
  on every network).
- **Reader id** (`readerIdHashOf`, `packages/shaida-proofs/src/reader.ts`): the name is normalized (Unicode NFC, trimmed,
  inner whitespace collapsed to one space, lower case), must be 1–96 UTF-8 bytes, is packed big-endian into four 31-byte
  field elements, and hashed as Poseidon(3, byteLength, c0, c1, c2, c3) (tag 3, next to the ledger's tags 1 and 2). A
  name is not authentication: anyone who knows the reader's name can open the link as that reader (LIMITS.md). It stops
  a link being shown as made for someone else.
- **Period → leaf range** (`leafRangeForPeriod`): the period is two calendar dates in the browser's time zone, from 00:00
  of the first to 23:59:59 of the last; `fromIndex` is the first ledger leaf whose block time is at or after the start,
  `toIndex` the last at or before the end. Block times come from `eth_getBlockByNumber` for the leaves' blocks (from the
  checked index snapshot). No leaf in the period → `NoSweptPayments`.
- **Dates for the reader** (PRD §5 step 8, `datesForRange`): `fromDate` is the block time of the first V leaf at index ≥
  `fromIndex`, `toDate` of the last V leaf at index ≤ `toIndex`; none inside the range → `RangeUnresolvable`. The reader
  sees calendar dates only.
- **Threshold**: whole multiples of the share step (1 tUSD8 by default, 5 or 10 if the recipient picks a coarser step,
  D13). An off-step amount is not refused silently: the screen offers the nearest multiples below and above
  (`nearestValidThresholds`). `BelowThreshold` shows the most the bundle can show.
- **Expiry**: a date, end of that day in the browser's time zone; 30 days by default; must be in the future and at most
  365 days away.
- **Proving**: the witness bundle is built on the page (pure, milliseconds), then each proof runs in a fresh Web
  Worker (terminated after its proof), with a progress bar by stage (artifacts checked, witness, proof k of n, link
  checked as the reader will). The worker verifies its proof with the final vkey, and the page runs the reader's full
  `verifyIncomeLink` on the finished link, before it is shown. Note secrets go to the worker and nowhere else.
- **Shared links** are kept in the vault (encrypted, field `shared`, default empty so older vault blobs still open),
  with the reader name, expiry, threshold, count and period. The link itself is the only copy the reader gets.
- **Record check on the fork**: no wallet is assumed in the demo, so on chain 440050 only, "Record check" is sent by a
  one-off key made in the tab and funded with `anvil_setBalance`, labelled demo (like D21's demo payer). On 44005 it
  needs the reader's connected wallet.
- **Verify `/v`** (no wallet): the reader types their name; the page runs `verifyIncomeLink` with `isKnownRoot` read at
  one pinned block, Groth16 verify in the browser with the pinned vkey, and dates from the checked index snapshot. It
  shows VALID (threshold, payment count, period as dates, expiry) or the named refusal in plain words; nothing else.
  "Check on-chain" calls `IncomeVerifier.check` for each proof with gas 400,000 (D14); "Record check" sends `attest`
  from a connected wallet (legacy tx, gas 420,000) and links the tx on the explorer on 44005 (hash only on the fork).
- **The link names no chain** (schema v1 is frozen with the tests): `/v` verifies against the app's configured network.
Rejected: a hash of the raw name (two spellings of one name would be two readers); sha256 for the reader id
(Poseidon keeps the core synchronous and in one hash family); fetching the zkey from GitHub at page load (a third-party
request per proof, and the pin would be checked on bytes we do not serve); sending proofs to the server to verify (D5).
Where: packages/shaida-proofs/src/{reader,period}.ts, packages/shaida-pay/src/income.ts, web/src/app/{app/prove,app/shared,v}/,
web/src/workers/, tools/copy-income-artifacts.mjs, LIMITS.md

## D28: withdrawals (unshield) through the relayer, never automatic
Context: the Aevum budget (evidence/budget.md) needs the swept tUSD8 back, but Gloam's `unshield` is public: the
amount, the recipient and the time are on chain. Nothing in the app could withdraw before this.
Decision:
- **One relayer route, `unshield`** (`/api/relay/unshield`), calling only `pool.unshield`. The proof binds the asset, recipient
  and amount, so the relayer cannot redirect it and only decides whether to pay the gas. Rails before simulation:
  tUSD8 only, amount > 0, the recipient is not zero or one of the app's contracts, tUSD8 not paused, the recipient not
  blacklisted, the nullifier unspent, the root known (R20–R22). Gas cap 500,000 (measured 326,598–343,698 on the fork).
- **A whole note at a time**: Gloam's unshield spends one note in full, so a batch is one transaction per swept note.
- **`/app/withdraw`** lists the vault's swept notes (`sweptNotes`), and the recipient picks notes and an address. It warns
  that withdrawals are public and reveal their amounts. A sent withdrawal is kept in the vault (`withdrawals`, read
  as empty in older vaults) and settled by the note's nullifier; it is never resent.
- **Policy on 44005**: never right after a demo run. Withdraw only when the deployer's tUSD8 would otherwise fall below 2,
  in one batch at a quiet time, to a fresh address we control, which forwards the tUSD8 (LIMITS.md, evidence/budget.md).
- The unshield proof uses Gloam's final key, pinned by sha256 like shield and transfer (P09).
Rejected: withdrawing automatically after each run (it would publish each run's amounts beside its time); a server-side
withdrawal from an exported vault (the notes' secrets would leave the browser); merging notes first (Gloam's transfer
takes one input note, so a merge would cost a full transfer per note and still end in one unshield per note).
Where: packages/shaida-relay/src/{functions,schemas,abi}.ts, packages/shaida-pay/src/withdraw.ts,
web/src/app/app/withdraw/, web/src/app/api/relay/unshield/, LIMITS.md, evidence/withdraw-fork.md, evidence/ui-withdraw/

## D29: public hosting on Render free, server state in Upstash Redis
Context: Part 1 of the hosting task (2026-11-22). The app needs a public URL that works logged-out, on free tiers.
Decision:
- **Host:** a Render free web service (512 MB RAM, 0.1 CPU, spins down after 15 min idle; builds on the Starter
  pipeline, 2 CPU / 8 GB, 500 min a month), kept awake by an UptimeRobot monitor on `/api/health` every 5 minutes.
  Render's free filesystem is wiped on every deploy, restart and spin-down, so it keeps **no state**.
- **State:** an Upstash Redis database on the free tier (created at upstash.com, not through Render), over REST with
  `@upstash/redis` 1.41.0 (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). It holds the relayer's request
  records, rate windows and gas budget, the submission lock, and the index cursor and snapshot.
- **Store interface** (`RelayStore`, packages/shaida-relay/src/types.ts) is now per operation (hit, record, holder,
  claim, put, gasCommitted, withChainLock) instead of "load the whole state, change it, save it".
  - Redis (`kvRelayStore`): one key per record. A new record is written by `claim`, a Lua compare-and-set on its key's
    pointer (nullifier, vouch, deposit commitment, memo): it writes only while the pointer still names the holder that
    was read, so two processes can never both persist an `accepted` record for one key. Scripts answer the same when
    the HTTP client retries them (a claim whose id already holds the key returns 1). `put` never creates a record.
    The per-chain submission lock (nonce + budget) is `SET NX PX` with a 120 s lease and a token-checked release; a
    process that waits 45 s for it refuses with `RelayerUnavailable`, nothing sent. Rate windows are sorted sets.
  - State file (`stateStore`, the former D19 store): kept for `next dev` and tests, behind the same interface.
  - Index (`kvSnapshotStore`): this process's copy serves every load; Redis is written at most once a minute (and at
    once on the first save), so a 10-page sync costs one write, not ten. A restart re-reads at most a minute of
    blocks from the last persisted cursor; it never rescans from the deploy block.
- **Choice is explicit** (`chooseStore`, packages/shaida-kv/src/choice.ts): `SHAIDA_STORE` = `redis` | `file`; unset
  means redis under production and file in dev. Production without both Upstash variables, or `file` on Render
  (`RENDER` set), is the named startup refusal `StoreNotConfigured`, and the process exits (78) from
  `instrumentation.ts`. Measured on this build: a throw in `register()` alone left `next start` up and answering 500
  on every route, which a host counts as a live deploy. A local `next start` (the fork flows) needs `SHAIDA_STORE=file`.
  Plain `http://` to Upstash is accepted only to 127.0.0.1/localhost (a local Redis for measuring), never remote.
- **Restarts never resend:** the record is persisted (claimed) before `sendRawTransaction`, as in D19. A restart after
  the claim and before the send leaves an `accepted` record: the same request again gets it back (nothing sent), and
  status settles it by hash or by the nonce passing it (R23). A restart after the send leaves it `accepted` with the
  tx on chain: the retry gets the record and the receipt settles it (R24). The vault settles the recipient's side by
  nullifier (D21).
- **`/api/health`:** commit (Render's `RENDER_GIT_COMMIT`, else git, inlined at build), networks, store kind, time.
  No RPC call, no Redis command, nothing written.
- **Build** (`tools/render-build.sh`, also the CI `web` job): pinned circom 2.2.3 binary, pnpm from `packageManager`,
  the income circuit compiled and checked, then `next build` with `NEXT_PUBLIC_NETWORKS=aevum` exactly. The prebuild
  copies Gloam's final keys from the submodule and the income final key from release ceremony-v1, each refused unless
  its sha256 matches the pins. Served from `public/` with the pin as `x-shaida-sha256` and a one-day cache; the
  browser still hashes every byte before proving. Node 24.19.0 (the version every local measurement used).
- **Client IP:** `TRUSTED_IP_HEADER=cf-connecting-ip` on Render (Cloudflare overwrites it; the last X-Forwarded-For hop
  is Render's proxy, which would put every visitor in one rate-limit bucket).
Rejected: Render's persistent disk (paid); Render Key Value (its free instance keeps no data across restarts);
Vercel (serverless functions: no long sync, and the relayer's one-submission-per-chain lock would need Redis anyway);
`WATCH`/`MULTI` for the claim (Upstash REST has no WATCH); keeping a whole-state JSON in one Redis key (every request
would rewrite all records; two processes would overwrite each other).
Consequences: the submission lock's lease (120 s) is longer than any one submission; if a process stalls past it, a
second process could take the same pending nonce, and the node keeps one of the two txs (different payments; neither
is sent twice). Upstash free: 500K commands a month; a relayed request costs 8 (measured, R30), a status poll 1 or 2, an index
poll 0 or 1 (one GET per process start, then at most one SET a minute).
Tests: kv 6 (KV01–KV05), relayer +16 (R23–R29 restarts, two processes, claim; R30 command count; RS01–RS05 store conformance, also run
against Redis 7.4.1 through serverless-redis-http: evidence/kv-redis.md) and the 28 existing relayer tests rerun on
the Redis store; index +2 (I07, I08).
Measured (local rehearsal of Render free, evidence/render-rehearsal.md): a fresh clone built by tools/render-build.sh
with Render's env only, peak 2.09 GB (Render's Starter build has 8 GB), the income zkey downloaded from the release and
matched; `next start` in a 512 MB / 10%-CPU scope with Redis behind serverless-redis-http and the real 44005 chain:
ready in 37 s, peak 173 MB, no OOM kill, index synced to the head in 7 requests (43.9 s), every proving file served
with header hash = body hash; without Upstash env it exits 78 in 20 s. An earlier run's ready time (37,103 s) was a
machine suspend; that report is kept (evidence/render-rehearsal-2026-11-22-machine-suspended.md).
Where: packages/shaida-kv, packages/shaida-relay/src/{store,store-kv,lock}.ts, packages/shaida-index/src/kv-store.ts,
web/src/server/state-store.ts, web/src/instrumentation.ts, web/src/app/api/health/, tools/render-build.sh,
DEPLOY_RENDER.md.

## D30: the underwriting bot (PRD P1): deterministic policies over a verified proof link
Context: PRD P1 asks for a bot that a landlord or lender can point at proof links: no LLM, a published rule, an API,
and optionally an on-chain record. Built 2026-11-23 on branch feat/underwriting.
Decision:
- **Package** `@shaida/underwrite` (pure engine, browser-safe) plus `@shaida/underwrite/node` (snarkjs Groth16 with the
  ceremony's final vkey, chain reads pinned to a checked index snapshot). Served as `POST /api/underwrite`, the page
  `/underwrite`, and a CLI (`pnpm --filter @shaida/underwrite decide --preset … --link …`, exit 0/2/3 for
  APPROVE/DECLINE/INCONCLUSIVE, 1 on error), all on the same engine and the same policy file.
- **Policies** live in `config/underwrite-policies.json` (schema `shaida-underwrite-policies/1`), parsed with a strict
  zod schema when the module loads: a bad file stops the server at startup (exit 78, like D29) and fails the tests. A
  policy has `id`, `version`, `title`, `audience`, `readerName`, `minThreshold` (tUSD8 base units), `minPayments`,
  `minPeriodDays`, `maxPeriodDays`, `maxProofAgeDays`, `minDaysLeft`. Its `hash` (sha256 of the canonical JSON) is shown
  with every decision, so a changed limit is visible even if someone forgets to bump the version. Presets:
  - `rent-check@1` (landlord): ≥ 1 tUSD8, ≥ 2 payments, period 1–92 days, ledger state ≤ 30 days old, ≥ 7 days left.
  - `revenue-credit@1` (lender): ≥ 10 tUSD8, ≥ 6 payments, period 28–184 days, ≤ 14 days old, ≥ 14 days left.
  - Both are made out to one reader name, **"Shaida underwriting bot (demo)"**: one bot, so one link can be put to
    either policy (the live check shows the same link approved by one and declined by the other). The task's example
    name ("Acme Lending (demo bot)") would have been a second reader; the schema allows a name per policy.
- **Order** (fixed): PRD §5 verification for the bot's own reader id (Groth16 with the final vkey, roots on chain,
  bundle checks, expiry). A refusal is a DECLINE with that one code (WrongReader, ProofExpired, ProofInvalid, …). Then
  the six rules, in this order, and the DECLINE lists **every** failing rule, not the first: BelowMinThreshold,
  TooFewPayments, PeriodTooShort, PeriodTooLong, ProofTooOld, ExpiresTooSoon.
- **What the rules measure:**
  - period = UTC calendar days from the first to the last vouch leaf of the proven range, inclusive (the dates /v
    shows). It says the proof covers that much of the ledger, not that payments were spread across it (LIMITS.md).
  - proof age = now − the block time of the ledger leaf whose insertion produced the proof's root. Gloam's tree keeps
    every root it ever had as known, so `isKnownRoot` says nothing about age; the bot rebuilds the ledger's prefix roots
    from its checked snapshot to find when the root was current. It bounds how old the ledger state is, not when the
    holder pressed Prove (a proof made today on a month-old root counts as a month old, which is the safe side).
  - days left = expiry − now.
- **INCONCLUSIVE is never an approval:** an RPC or index that cannot be read is `ChainUnreachable`, a root unknown on
  chain is `UnknownRoot`, a ledger that does not reach the root yet is `RangeUnresolvable`. A bug in a dependency throws
  (HTTP 500), it is not turned into a decision (U12c).
- **Idempotent:** `decisionId` = sha256 of (proof id, policy id@version, policy hash, outcome, codes); `proofId` = sha256
  of the link's canonical JSON. The decision is a pure function of the link, the policy, the chain and the clock: the
  same link and policy version give the same decision; as time passes, only the age and expiry rules can change it, and
  only from APPROVE to DECLINE.
- **The endpoint receives the link.** CLAUDE.md says the server never receives proofs; that holds for every other
  route. The bot is a reader the holder chooses to send the link to, and it cannot decide without it. Scoped exception:
  the link is used for one decision and never logged (U19c logs ids and codes only) or stored; a recorded proof is kept
  as a hash (`proofKey`); the rate limit keeps request times per IP for two minutes. The page says this before its
  button, unlike /v, which checks in the browser. CLAUDE.md's invariant now names this exception (amended by the
  builder's decision, 2026-11-24). In real use a lender runs the bot itself (CLI or own deployment).
- **Rails:** 10 decisions a minute per IP in the relayer's store (checked before the body is read), a 16 KiB body cap
  (413), a strict body `{link, preset, record?}`, links up to 12,000 characters. Groth16 on the server runs on a
  single-threaded bn128 curve: measured 2026-11-23 on this laptop (4 CPUs), 44 ms and 89 MB RSS for a first verify,
  against 731 ms and 146 MB with snarkjs's default worker per CPU (Render free has 0.1 CPU and 512 MB).
- **Recording** (`record: true`) calls `IncomeVerifier.attest` for each proof of an **approved** link, from the bot's
  own key. Least privilege:
  - off unless `UNDERWRITE_RECORD=on`; then `UNDERWRITE_BOT_PRIVATE_KEY` is required and must not be the relayer's key
    (startup refusal otherwise, U24b). The key signs only legacy txs to the deployment's IncomeVerifier with the
    `attest` selector and 420,000 gas (U21c).
  - a daily cap per UTC day on count (`UNDERWRITE_DAILY_RECORDS`, default 3) and on reserved gas
    (`UNDERWRITE_DAILY_GAS`, default 1,260,000), claimed atomically in KV (Lua) before anything is signed; a bundle
    that would cross a cap is refused whole (U15, U15b).
  - one record per proof, ever: keyed by the proof's hash. The same proof again, under any preset or version, returns
    the first record and sends nothing (U14). `IncomeVerifier.check` runs first; a balance short of the gas is
    `RecorderUnavailable` before claiming.
  - the record (hash, nonce) is persisted before `sendRawTransaction`; a send with no answer is `TxOutcomeUnknown`, and
    one the node refuses is `dropped`: neither is ever sent again (U22, U22b). One recording at a time: an in-process
    queue plus a KV lease lock with a token-checked release (U25).
- **For agents:** `/llms.txt` and `/.well-known/agent.json` (a rewrite to `/api/agent-card`) are built from the same
  constants as the handler: request schema, presets with their limits and hashes, decision and error codes, the rate
  limit, whether recording is on and the bot's address (U19d, U19e). They state that the bot is deterministic and sees
  only the link it is sent.
- **Every rule is load-bearing:** U17 removes each rule in turn and its DECLINE case turns into APPROVE; U16 runs 2,000
  random policies and proofs and recomputes the expected reasons independently of `rules.ts`, so a wrong comparison
  shows up as a mismatch.
Consequences: a new decision surface with its own key; THREAT_MODEL.md lists its threats. The bot trusts the reader
name binding, which is intent, not identity (LIMITS.md).

## D31: proof templates for merchants and grantees (presentation only)
Context: PRD P1 "merchant and grantee verifier templates". The proof, the circuit and the link schema stay as they are.
Decision:
- Three templates in `web/src/lib/templates.ts`: **income** (for a landlord; the old wording), **merchant** ("Revenue
  proof, for a lender": payments are "customer payments"; suggests the bot's reader name and, after VALID on /v, points
  a lender at `/underwrite?preset=revenue-credit`), **grantee** ("Disbursements, for a donor or sponsor").
- Chosen on `/app/prove` (also preselected by `/app/prove?for=merchant|grantee`, linked from the landing page's "Who it
  is for"); it sets labels, the reader placeholder and a suggested reader. Saved with the shared link in the vault
  (`template`, optional in the vault schema so older vaults still load).
- The reader's URL carries it as a query, `/v?for=merchant#…`, outside the fragment. Link schema v1 is unchanged and
  strict, so old links and old verifiers are unaffected. `/v` shows the template's title, lede and payment word; the
  VALID facts are exactly the same. An unknown `for=` shows the plain income wording.
- Nothing about a template is proven: anyone can change `?for=` (LIMITS.md).

## D32 (PROPOSAL; F3, F4, F5, F8, F9 ACCEPTED 2026-11-25, the rest not applied): fixes for the leaks the privacy audit measured
Context: evidence/privacy-audit.md measured what an observer and a reader learn on 44005 and on a fork fixture
(LIMITS.md, "What the chain and a proof link show"). As proposed, nothing below was built; what was applied since is under Status. Costs use measured gas (evidence/fork-gas.md:
vouchedPay 2.77M, sweep 2.70M, attest 267k, Groth16 check ~258k; 1 gwei). "Ceremony" means a new phase 2 (CLAUDE.md).

| # | Leak | Fix | Needs | Cost | What it buys |
|---|---|---|---|---|---|
| F1 | Payer id in `Vouched` | Drop `payerId` from the event; the recipient gets it from the sealed memo | Ledger redeploy (new tree: every existing link's root becomes unknown), app + indexer change | ~−400 gas/pay; a day of work | **Nothing alone**: the `vouchedPayFor` calldata still names the payer, and its signature recovers to the payer's address. Not worth doing by itself. |
| F2 | Payer address in calldata and signature | The payer proves "I am an active registered payer" in zero knowledge (registry as a Merkle tree; V computed in the circuit from a private payer id), the relayer sends no address | New vouch circuit + its own ceremony; new registry and ledger (redeploy); income circuit can stay if V keeps its formula | +~260k gas/pay for the proof, + a registry tree insert per register; revocation by root, so slower; ~1–2 weeks + a ceremony | Hides the payer **among registered payers**: today that set has 1 member, so it hides nothing until there are many payers. Deposits stay public and still name the payer. |
| F3 | `attest` puts threshold, count and range on chain (pinned totals: 4 tUSD8 exactly) | App: no attest by default; the reader page and the bot warn, before the button, that a record publishes the proof's numbers to everyone. `check` (eth_call) leaves no trace on chain | App only | none | Removes the observer's main lever on totals (A4). The reader still has the link. |
| F4 | Withdrawal amount = payment amount | App: sweep into two notes (a round part and the rest; `amountS` is free in income.circom, the transfer keeps value), withdraw in round amounts, never right after a run (D28 already) | App only (circuit unchanged; **to verify on the fork first**: an income proof over a split sweep) | one more note per payment; withdrawals in more txs (~0.33M gas each) | Withdrawals stop naming payment amounts (A1). |
| F5 | Withdrawal forwarded to the payer's funder | Operational: forward to an address with no link to the deployer (D28 policy) | Nothing | none | Breaks the one-hop link (A6). |
| F6 | Sweep timing (6/6 FIFO) | Relayer: hold sweeps and memos in a queue, send in batches at random times within a window (e.g. 1–6 h), shuffled across users | Relayer + app (UI says "sweep queued") | hours of delay per sweep; no gas change | Helps only with other users in the same window: at today's volume (one user) it hides nothing. |
| F7 | Range shows the holder's vouch leaves (payers, times) | App: widen the default range to whole UTC calendar weeks or months; never shrink to the first and last payment | App only | none | Helps only when other people's vouches fall in the range (on the fork, interleaved payers kept the total from being pinned). Today it adds nothing. |
| F8 | Expiry and period in the browser's time zone | App: end-of-day in UTC for the expiry (and period edges) | App only (old links stay valid) | none | Stops the time-zone leak. |
| F9 | Suggested threshold = the most the period can show | App: suggest a rounder value (for example the most rounded down to 5 or 10 tUSD8), say what the maximum reveals | App only | none | The threshold stops being a 1 tUSD8 window on the total. |
| F10 | Deposits bound what a payer paid | Operational: payers keep a balance (deposit more than they pay) | Nothing | idle funds | Loosens the budget bound; deposits stay public by design. |

Not proposed: hiding deposits and withdrawals (public by Gloam's design, D28); changing the income circuit to hide
`count` or the range (a new ceremony, and /v needs the range to date the payments).
Order if the builder wants the most for the least: F3, F5, F8, F9 (app or operational, a few hours), then F4 after a
fork check, then F6/F7 once there is volume, and F2 only with many registered payers. F1 is not worth doing alone.

Status (the builder accepted the quick fixes on 2026-11-25; applied on branch fix/privacy-quick, app only, no
contract, circuit or ceremony change; measured in evidence/privacy-audit.md "Fixes applied"):
- **F3 ACCEPTED 2026-11-25.** "Record check" on /v and the bot's "Record on chain" stay off until the person ticks a
  box under a plain warning that recording publishes threshold, count and range and can reveal totals
  (`web/src/components/PublicRecordConsent.tsx`). The bot's server already recorded only on an explicit request
  (D30); recording stays switched off on the live site. Records made before (3 on 44005) stay public.
- **F4 ACCEPTED 2026-11-25, as an option, off by default.** Fork check first (evidence/split-sweep-fork.md): a
  payment swept into two notes (part + rest) still proves at its full amount ("≥ 2 from one payment" with a 1 tUSD8
  sweep note: snarkjs and IncomeVerifier.check both true). Gas: a split sweep 2,644,453 and 2,644,780 against whole
  sweeps of 2,644,453 and 2,644,744 at the same tree positions (no real difference); the cost is one more withdrawal
  per payment (343,686 and 326,598 gas for the two notes). The inbox has a "Split each sweep" box; the part is the
  largest whole tUSD8 below the payment (1 tUSD8 or less is swept whole). It helps only if the two notes are
  withdrawn at different times.
- **F5 ACCEPTED 2026-11-25.** Rule in evidence/budget.md and checklist B: withdrawals go only to an address unlinked
  to the payer or its funder; the withdraw page says so.
- **F8 ACCEPTED 2026-11-25.** New links expire at 23:59:59 UTC of the chosen day; the app shows that moment in the
  viewer's time zone. Links made before keep their expiry (the bot link still names UTC+1).
- **F9 ACCEPTED 2026-11-25.** The prove form suggests the total rounded down to 1, 5 or 10 tUSD8 (by size, never
  finer than the chosen step) and never the exact total; the most stays allowed and the form says what it shows.
- F1, F2, F6, F7, F10: not applied.
