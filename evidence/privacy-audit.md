# Privacy audit: what an observer and a reader learn (CL30, CL32)

Read-only. No transaction was sent to Aevum 44005, and no contract or circuit was changed. Two roles:
- **Observer**: anyone with the explorer and an RPC. `tools/privacy-observer.mjs` reads every transaction and event
  touching the six contracts (pool, ledger, depositor, registry, memo board, IncomeVerifier) from the deploy block,
  plus tUSD8 one hop in and out of every address they name. It decodes all of it, classifies each public field, runs
  attacks A1–A6 and scores them against a ground truth.
- **Reader**: someone holding a proof link. `tools/privacy-reader.mjs` decodes the link, lists what it gives directly,
  then combines it with the observer's chain data, and scores the result the same way.

Personas are demo. Ground truth for 44005: [truth-44005.json](privacy-audit/truth-44005.json), taken from the run
evidence (live-44005-run1.md, live-44005-run2.md, underwrite-live-44005.md, budget.md). The run-2 sweep → payment
pairing is not read from a secret. It follows from the code (Sweep all walks the inbox oldest memo first), and the
truth file says so. The truth is read only by the scorer, after the guesses are made.

## Data
| | 44005 (live) | Fork fixture |
|---|---|---|
| Read | blocks 3810968–3961095, 2026-11-24 ([dump](privacy-audit/dump-44005.json)) | `make fork` + `packages/shaida-pay/scripts/privacy-fixture.ts` ([dump](../tools/privacy/fixtures/fork-dump.json), [truth](../tools/privacy/fixtures/fork-truth.json)) |
| Transactions | 37: 10 deploy/setup, 1 register, 2 deposits, 6 vouched pays, 6 memos, 6 sweeps, 3 withdrawals, 3 attests | see "Fork fixture" below |
| Completeness | RPC logs and the explorer's tx list agree, except 5 contract creations (no logs); 0 failed txs | RPC only |
| Who | 1 registered payer (Acme), 1 recipient (Ada), 2 readers (Bola's wallet, the bot) | 2 payers, 2 recipients, 2 readers |

Commands (offline from the committed dumps; `make privacy-audit-live` re-reads 44005, optional, needs the RPC):
```
node tools/privacy-observer.mjs analyse --dump evidence/privacy-audit/dump-44005.json --truth evidence/privacy-audit/truth-44005.json --out evidence/privacy-audit/observer-44005.json
node tools/privacy-reader.mjs --dump evidence/privacy-audit/dump-44005.json --truth evidence/privacy-audit/truth-44005.json --reader-name "Landlord Bola" --reader-name "Shaida underwriting bot (demo)" --reader-name "Tenant Chidi" --out evidence/privacy-audit/reader-44005.json
```
Output: [observer-44005.json](privacy-audit/observer-44005.json), [reader-44005.json](privacy-audit/reader-44005.json).

## Every public field, by class
`plain` = read as is; `opaque` = hash, commitment, nullifier, proof or ciphertext; `metadata` = what the transaction
itself shows. The tool refuses to run if a decoded field has no class (`FIELD_CLASSES` in `tools/privacy/src/decode.mjs`).

| Tx | Plain | Opaque | Metadata (all txs) |
|---|---|---|---|
| deposit (`depositWithAuthorization`) | **payer address**, **amount**, gasless flag, pool leaf index, tUSD8 transfer payer → depositor → pool, EIP-3009 signature (recovers to the payer) | note commitment, shield proof | sender (relayer `0xf494…`), block and time, tx index, relayer nonce, gas, calldata size |
| vouchedPay (`vouchedPayFor`) | **payer address** (argument), **payer id** (`Vouched`, indexed), **EIP-712 signature** (recovers to the payer; checked offline for all 6), signature deadline (≈ signing time + 1,800 s; on 44005 the tx mined 5–103 s after signing), ledger leaf index | proof, pool root, nullifier, payment commitment, change commitment, V leaf | same |
| lateVouch | payer address, payer id, deadline, leaf index | payment commitment, V leaf | same (none on 44005) |
| memo (`postMemo`) | padded length (852 bytes, all 6) | sealed ticket; payment commitment (equal to the pay's `newCommitments[0]`, so it names its payment) | same; posted 5–10 blocks after its pay |
| sweep | ledger leaf index | proof, pool root, nullifier, sweep commitment, change commitment, S leaf | same |
| unshield | **recipient address**, **amount**, asset, tUSD8 transfer pool → recipient | proof, root, nullifier | same |
| register | **payer address**, **payer id** | name hash = `keccak256(display name)`: confirmable by guessing | sender = attestor (deployer) |
| attest | **threshold**, **count**, **fromIndex**, **toIndex**, asset (calldata; threshold and count also in `IncomeProofChecked`) | ledger root (names a past ledger state), context, proof | **sender = the reader's wallet** (Bola `0xbed9…`, bot `0x5b14…`) |

## Observer: attacks A1–A6 on 44005
| Attack | Heuristic | Result on 44005 | Why |
|---|---|---|---|
| A1 each payment's amount | sound bounds: each payment ≥ 1 base unit; a payer's payments so far ≤ their deposits so far; an attested range's payments ≥ its threshold; then each withdrawal = one whole swept note, matched first-in-first-out | **partly: 3 of 6 exact, 0 wrong**. Run 1: 1.5, 1, 0.5 from withdrawals `0x379cab95…`, `0x4336f050…`, `0x30b85e2e…`. Run 2: each only in [0.000001, 0.999998] | Not hidden once withdrawn: a sweep and a withdrawal both move whole notes. Run 2 is hidden by the pool's commitments. |
| A2 who received each payment | sweeps closer than 300 blocks with no pay between = one recipient's session; then join sessions whose payments sit in attested ranges of the same holder (same reader wallet, or the same range) | **succeeds: 15 of 15 same-recipient pairs** (sessions alone: 6 of 15, because runs 1 and 2 were separate sessions). Run 1's recipient named by its withdrawal address `0xe317…`, which forwarded 3 tUSD8 to the deployer `0x5f80…` (tx `0x614f3801…`) | Receive address: hidden by the cryptography (sealed memos). Grouping: not hidden (attests by one reader wallet; sweep bursts). |
| A3 payment ↔ sweep | first in, first out by block order | **succeeds: 6 of 6**; anonymity sets 3, 2, 1 per run (random guess would expect 1.83 per run) | The nullifier hides the link cryptographically; only volume (here none) would hide the timing. |
| A4 Ada's total, and who paid her | A1's bounds on the union of payments in attested ranges, holders clustered as in A2 | **succeeds: exactly 4 tUSD8 (3 + 1), payer id 1 = Acme** | Not hidden: attests publish threshold, count and range; deposits cap the payer's spending (3 then 1). |
| A5 the payer of each payment | `Vouched.payerId`, `vouchedPayFor` payer argument, EIP-712 signer, registry | **succeeds: 6 of 6, all three sources agree** | Not hidden, by design of the vouch (D3). |
| A6 deposits and withdrawals | read `Deposited` / `Unshielded` and tUSD8 one hop | **succeeds: 5 of 5 exact**: in 3 + 1 tUSD8 from Acme (funded by the deployer: `0xe986ae47…`, `0x948664bc…`), out 1.5 + 1 + 0.5 to `0xe317…`, forwarded to the deployer | Public by design (D28). One hop shows both ends of the demo belong to one party. |

Gas carries no amount. Live run 1 against the fork run of acts 2–3 (evidence/acts-2-3-fork.md), at the same tree
positions with different amounts:

| Tx | 44005 amount | gas | Fork amount | gas | Difference |
|---|---:|---:|---:|---:|---:|
| pay 1 | 1.5 | 2,729,071 | 3 | 2,729,059 | 12 |
| pay 2 | 1 | 2,689,569 | 4 | 2,689,509 | 60 |
| pay 3 | 0.5 | 2,684,594 | 2 | 2,684,582 | 12 |
| sweep 1 | 1.5 | 2,644,417 | 3 | 2,644,453 | −36 |
| sweep 2 | 1 | 2,644,792 | 4 | 2,644,744 | 48 |
| sweep 3 | 0.5 | 2,639,490 | 2 | 2,639,478 | 12 |

Moving one tree position changes gas by ~40,000. The amount is not an input to any contract call (it is inside the
commitments), and the small differences match calldata zero bytes in the proofs.

Memos: 6 tickets, each 852 bytes, the longest common prefix is the 29-byte P-256 header every ticket has, and all 6
ephemeral keys and IVs differ. Nothing in them is constant per recipient.

## Reader: the three live links
| | run 1 (landing page example) | run 2 (Bola) | bot |
|---|---|---|---|
| Source | `web/src/app/example-links.json` | **not in the repo** (made in the builder's browser, never saved): rebuilt from R13's attest calldata, so reader hash, expiry and salt are missing | `underwrite-live-44005/run.json` |
| Signals | ≥ 3 tUSD8, count 3, leaves 0–5 | ≥ 1 tUSD8, count 3, leaves 6–11 | ≥ 1 tUSD8, count 3, leaves 6–11 |
| Reader name | "Landlord Bola" matches the hash; context = Poseidon(hash, expiry, salt) checks | — | "Shaida underwriting bot (demo)" matches; context checks |
| Dates of the range | 2026-11-22 10:49:58 → 10:51:49 UTC (each leaf's block time) | 2026-11-23 19:37:50 → 19:53:24 | same as run 2 |
| Vouch leaves in range | 3 (= count), payer id 1 | 3 (= count), payer id 1 | 3 (= count), payer id 1 |
| When it was made | root = ledger after leaf 6: after 10:51:49 Nov 22, before 19:37:50 Nov 23. Expiry 10:51:58 exactly: script, made at expiry − 30 days | root after leaf 12 (after 19:53:24 Nov 23) | root after leaf 12; expiry 22:59:59 UTC = 23:59:59 at **UTC+1**: the maker's browser time zone |
| Total with chain data | **[3, 3] exact** | **[1, 1] exact** | **[1, 1] exact** |
| Same, had nobody attested on chain | [3, 3] (the deposit alone caps it) | [1, 3.999997] | [1, 3.999997] |
| Single payments | bounds only: [0.000001, 2.999998] | [0.000001, 0.999998] | same |

Score against the truth (reader-44005.json): every range held exactly the holder's payments, the payers were named
right, every total was pinned to the true value, every bound held the truth, and 0 single payments were pinned.

D13 rounding is not exercised on 44005: every live link is one proof, so its threshold is the asked one. Both live
thresholds equal the exact sum (3 and 1), because the holder asked for the most the period could show (the UI
suggests it). The bundle case is in the fork fixture.

## Results by role
Evidence key: O = observer-44005.json, R = reader-44005.json, F = the fork fixture; tests in
`tools/privacy/test/audit.test.mjs` (titles O-…, R-…).

### Observer
| | What | Evidence | Why |
|---|---|---|---|
| **Learns** | which payer made each payment (address, id, signature) | O `a5`, test O-A5 | calldata + `Vouched` (D3) |
| | every deposit and withdrawal: amount, address, time; one hop around them | O `a6`, test O-A6 | public by Gloam's design (D28) |
| | the amount of each payment whose note was withdrawn | O `a1`: 3 of 3 | whole-note sweep + whole-note withdrawal |
| | a recipient's exact total from a payer, when attested | O `a4`: 4 tUSD8 | attest calldata + deposit budget |
| | when each payment, memo and sweep happened, and their order; when the payer signed | O `metadata` | block times, relayer nonce, signature deadline |
| | that a memo belongs to a given payment | memo commitment = payment commitment | by design (memo board) |
| **Does not learn** | the receive address paid | O `memo` | sealed tickets (P-256 ECDH, AES-GCM), padded |
| | the amount of a payment not withdrawn, beyond a bound | O `a1` run 2 | commitments |
| | any amount from gas | the gas table above | the amount is not a call input |
| **Learns only at today's volume** | which sweep is which payment (6 of 6 by timing) | O `a3`, F: fewer when sweeps are out of order | the nullifier hides it; timing gives it away when nobody else sweeps |
| | which payments went to one recipient | O `a2` | sweep bursts and attests; other users would blur bursts |
| | the exact total of an attested range | O `a4`, F: not pinned when others' vouches share the range | with other payers in the range and payers keeping balances, the bounds widen |

### Reader
| | What | Evidence | Why |
|---|---|---|---|
| **Learns** | the threshold, count, leaf range, root, asset, expiry, reader hash, salt | R, test R-direct | the link |
| | the payer id and block time of every payment and sweep in the range | R `vouchLeaves`, `sweepLeaves` | ledger events are public; the range names them |
| | roughly when the link was made, and (browser links) the maker's time zone | R `builtAfter`/`builtBefore`, `expiryHint` | known roots per leaf; expiry is 23:59:59 local |
| | in a bundle, each proof's sub-range and share; a capped share gives that proof's sum to 1 tUSD8 | F, test R-D13 | D12/D13, as designed |
| **Does not learn** | any single payment's amount from the link and the chain | R `perPayment` | commitments; the circuit shows only a sum ≥ threshold |
| | the holder's notes, secrets or receive address | — | never in the link |
| **Learns only at today's volume** | that the range holds exactly the holder's payments, so exactly who paid them | R `onlyHoldersInRange` = true ×3; F: false for Ada | other people's vouches in the range would hide which are the holder's |
| | the exact total | R `total` exact ×3; F: not pinned | deposits pin it when the payer has no other spending; attests tighten it |

## Fork fixture
`packages/shaida-pay/scripts/privacy-fixture.ts` on `make fork` (chain 440050, real tUSD8, Gloam's final keys, the
web app's own `/api/index` and `/api/relay`), run 5 of 2026-11-25 (runs 1–4 failed, below). Personas are demo.
Acme (payer 1) deposits 10 and Bisi (payer 2) 6 tUSD8. Eight payments, interleaved: Acme → Ada 1.5, Bisi → Chidi 2,
Acme → Chidi 0.7, Bisi → Ada 1, then (after Chidi sweeps his two **newest first**) Acme → Ada 2.25, 0.5, Bisi →
Ada 1.2, Acme → Ada 1. Ada sweeps her six oldest first. Ada proves all six, the most she can show, for "Landlord Bola":
a 2-proof bundle, both proofs attested by Bola's wallet. Chidi proves ≥ 2 tUSD8 for "Lender Dayo" (not attested) and
withdraws P2's note (2 tUSD8) to a fresh address, which forwards it on. 400 empty blocks between phases.
36 txs: 2 register, 2 deposits, 8 pays, 8 memos, 8 sweeps, 2 attests, 1 unshield, 5 setup.
Output: [observer-fork.json](privacy-audit/observer-fork.json), [reader-fork.json](privacy-audit/reader-fork.json).

| Attack | Fixture | 44005 | What changed |
|---|---|---|---|
| A1 amounts | **fails: 0 of 8 exact, 1 wrong**: the withdrawal (2 tUSD8) was matched first-in-first-out to Ada's P1 (oldest swept), truly Chidi's P2. Bounds held the truth for all 8 | 3 of 6, 0 wrong | the withdrawer was not the first to sweep |
| A2 recipients | **partly: 16 of 28 pairs**; attests did not join anything, since no range held only one holder's payments | 15 of 15 | two recipients, interleaved |
| A3 sweep ↔ pay | **partly: 6 of 8** (Chidi's first sweep and Ada's first sweep wrong); random guessing would expect 3.03 | 6 of 6 | one recipient swept out of order |
| A4 totals | **fails to pin**: the attested ranges cover 8 payments of two recipients; total in [7, 16] (truth for those 8: 10.15) | exact 4 | other people's vouches in the range; two payers' budgets |
| A5 payer | **succeeds: 8 of 8**, all three sources agree | 6 of 6 | nothing: not hidden by design |
| A6 deposits, withdrawals | **succeeds: 3 of 3**, the forward followed one hop | 5 of 5 | nothing: public by design |

Reader, fixture links:
| | Ada's bundle (Bola) | Chidi's link (Dayo) |
|---|---|---|
| Proofs | ≥ 5 (count 4, leaves 0–7, 6 vouch leaves: payers 1 and 2); ≥ 2 (count 2, leaves 8–15, 2 vouch leaves) | ≥ 2 (count 2, leaves 1–15, 7 vouch leaves) |
| Holder's total with chain data | [7, 16]; truth 7.45 | [2, 16]; truth 2.7 |
| Which payments are the holder's | proof 2: yes (2 vouch leaves = count: P7 from Bisi, P8 from Acme). Proof 1: 4 of 6, not which | 2 of 7, not which |
| D13 | the second share (2 < 5) is capped: that proof's sum lies in [2, 3); truth 2.2 | single proof |

So with two payers and interleaved payments the exact totals of 44005 widen to bounds, and the pairings by timing
start to fail. A proof's range still names which payers are in it, and a capped share still gives its proof's sum to
1 tUSD8, as D13 says.

## Fixes applied (D32 F3, F4, F5, F8, F9; 2026-11-25)
App-only changes, no contract, circuit or ceremony change. The fork fixture ran again with them
(`pnpm --filter @shaida/pay privacy:fixture --fixes`, same plan, fresh `make fork`, one RateLimited wait handled by
the script). Data: [fork-truth-fixes.json](../tools/privacy/fixtures/fork-truth-fixes.json),
[fork-dump-fixes.json](../tools/privacy/fixtures/fork-dump-fixes.json),
[observer-fork-fixes.json](privacy-audit/observer-fork-fixes.json), [reader-fork-fixes.json](privacy-audit/reader-fork-fixes.json).
The live 44005 chain is not changed by any of this: its numbers above stay as measured.

| Fix | What changed in the app | Fixture before | Fixture after |
|---|---|---|---|
| F3 recording opt-in | "Record check" (/v) and the bot's "Record on chain" stay off until a box under a warning is ticked | Bola recorded both proofs: the observer bounded Ada's total to [7, 16] from the attested ranges | no records, so no attested range to total (A4 has nothing to work on). The reader's bounds did not change ([5, 16] with or without records), because they come from deposits |
| F4 split sweep (option, off by default) | inbox box "Split each sweep": the largest whole tUSD8 below the payment, and the rest | 1 of 1 withdrawals equal to their payment's amount (Chidi's 2) | 0 of 1: Chidi withdrew 1 of P2's 2 (the other 1 stays a note). Ada's 1.5, 2.25 and 1.2 and Chidi's 2 were split; the payments of 1 tUSD8 or less (1, 0.5, 1 and 0.7) were swept whole |
| F5 withdrawal destination | rule in budget.md and checklist B; the withdraw page says it | the fixture's forward already went to an unlinked address | same; the change is for live runs (run 1's forward to the deployer is what A6 found) |
| F8 UTC expiry | links end at 23:59:59 UTC; shown in the viewer's time zone | script links: exact "now + 30 days" (no zone; the zone leak was the live bot link, UTC+1) | both links end at 23:59:59 UTC: the reader tool reads it as the app's default, no zone |
| F9 suggested threshold | the form suggests the total rounded down to 1, 5 or 10 tUSD8, never the exact total | Ada showed the most: 7 (5 + 2) for a 7.45 total | Ada showed the suggestion: 5 (3 + 2). The bundle's capped share window still held the truth ([2, 3) for 2.2) |

Unchanged, as expected: the payer of every payment (A5, 8 of 8), deposits and withdrawals being public (A6, 3 of 3),
sweep timing (A3, 6 of 8 both times), recipient grouping (A2, 16 of 28 both times), memo shape (all 852 bytes).
Tests: `tools/privacy/test/audit.test.mjs` F3, F4, F8, F9, F-unchanged.

F4 was checked on the fork before it was built: [split-sweep-fork.md](split-sweep-fork.md). A payment of 2 swept
1 + 1 proves "≥ 2 tUSD8 from 1 payment" (the circuit counts the payment's amount; the sweep note's amount only enters
its commitment), and 2 + 1.5 + 1 swept 1+1, 1+0.5 and whole proves "≥ 4 from 3". Both verify with snarkjs and
IncomeVerifier.check. Gas: split sweeps 2,644,453 and 2,644,780, against 2,644,453 and 2,644,744 for whole sweeps at
the same tree positions (evidence/acts-2-3-fork.md); the two withdrawals of the split 1.5 cost 343,686 + 326,598 gas,
against one withdrawal for a whole note. Circuit test: `F4 counts a split-swept payment at its full amount`
(packages/shaida-proofs).

## Revocation and reader codes (D35, D36; 2026-11-26)
No circuit, ceremony or existing-contract change: one new contract (Revocations) and link v2. The fork fixture ran
again with both (`pnpm --filter @shaida/pay privacy:fixture --revoke`, which implies `--fixes`; same plan, fresh
`make fork` with the same deployer and nonces, so the same addresses as the built app). Ada's link is
**code-protected** for "Landlord Bola" (the code comes from 10 CSPRNG bytes and is never written out). Chidi's is
**name only** for "Lender Dayo", and after his withdrawal he revokes it through the relayer. Data:
[fork-truth-revoke.json](../tools/privacy/fixtures/fork-truth-revoke.json),
[fork-dump-revoke.json](../tools/privacy/fixtures/fork-dump-revoke.json),
[observer-fork-revoke.json](privacy-audit/observer-fork-revoke.json),
[reader-fork-revoke.json](privacy-audit/reader-fork-revoke.json). Reader run with `--reader-name "Landlord Bola"
--reader-name "Lender Dayo"`.

What changes for the **reader**:

| | Before (v1, or v2 name only) | Code-protected (Ada) | Revoked (Chidi) |
|---|---|---|---|
| Does the reader's name alone confirm whom the link is for? | yes: "Landlord Bola" matches the reader hash (live links, fork fixtures) | **no**: the hash is Poseidon(5, nameHash, Poseidon(code)); "Landlord Bola" confirms nothing (`names tried that confirm the reader: none`). Verifying needs the name and the code | yes, as before: "Lender Dayo" matches |
| Who can view it | anyone with the link who guesses or knows the name | anyone with the link, the name and the code (a shared secret, not a login) | anyone with the link and the name sees **REVOKED** |
| What the revocation shows | v1: nothing (not revocable, labelled so) | not revoked | the block (4128502) and its time; the sender is the relayer (`0x7099…79c8`), not the holder |
| Payers, leaf range, timing, total bounds | as in "Reader" above | **unchanged**: payer ids 1, 2; leaves 0–7 and 8–15; total [5, 16] (truth 7.45) | **unchanged**: leaves 1–15; [2, 16) (truth 2.7) |

A reader code hides **who the link is for** from someone holding the link and a guessed name. It does not hide the
ledger facts the link carries. Revoking stops future verification; a VALID already seen stays seen, and the link's
ledger facts were public before the revoke.

What changes for the **observer** (no link): one `revokeLink` tx, sent by the relayer, carrying the secret and the
salt. With no attest of that link on chain, it ties the revoke to no payment, payer or holder: the salt reaches
the link only through the link itself. Its gas was 77,796. Everything else is unchanged from the fixes run: A5 8 of
8, A6 3 of 3, A3 6 of 8, A2 16 of 28, A1 0 of 8, memos all 852 bytes, no records (A4 empty).

The fixture also checks that the relayer answers a repeat revoke request from its first record (same request id and
hash) without sending, and that the reader code appears in neither the truth file nor the log (text, without
dashes, decimal, hex).

## Runs that failed (kept on record)
Fork fixture, 2026-11-25, on `make fork`:
1. Stopped at Ada's second sweep with **RateLimited** from the app's relayer (per-address limit; nothing sent). The
   rail worked as designed; the script now waits out the window and asks again on that named refusal only.
2. Stopped at the first deposit with **SignatureInvalid: authorization is expired**: the script's pauses mined blocks
   1 s apart and moved the fork's clock ahead of the wall clock, while the script signed with the wall clock.
3. With the script reading "now" from the chain: **SignatureInvalid: valid for more than an hour**. The relayer checks
   the EIP-3009 window against its own (wall) clock, and the fork's clock was already more than an hour ahead. Fixed
   by a fresh fork (same deployer and nonce, so the same addresses as the built app) and pauses that mine blocks
   without advancing time.
4. On that fresh fork: stopped after the two deposits with **UnknownRoot** from the index ("could not read the
   chain"): the reused build's index start block lay ~87,000 blocks before the fork's deploy, and while catching up
   it read the pool's `nextIndex` at a block where the pool did not exist yet. An artifact of reusing the build, not
   of a normal deploy. Fixed by waiting for the index to catch up first; the script also asks again on a retryable
   index refusal (at most 30 times).

Revocation fixture (`--revoke`), 2026-11-26, on `make fork`:
1. Ran through the withdrawal and Chidi's revoke (mined), then stopped at the script's own check: it expected a
   second revoke request to be refused **AlreadyRevoked**, but the relayer answered from its first record (`mined`,
   same request id), as designed (relayer test R42; AlreadyRevoked is for a salt revoked with no record of this
   relayer, R41). The script's expectation was wrong, not the rail; the check now asserts the same record and an
   unmoved relayer nonce. Log: [fixture-revoke-run1-FAILED.log](privacy-audit/fixture-revoke-run1-FAILED.log). The
   rerun was on a fresh fork and a clean relayer store.
