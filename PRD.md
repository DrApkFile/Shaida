# PRD: Shaida

Version 1, 2026-11-20. Single source of truth. When evidence contradicts this file: record a DECISIONS.md entry, update this file, withdraw dead claims.
Inputs: `briefing/` (EVENT, LANDSCAPE, IDEA_CHECK, EVAL_DESIGN, AEVUM, AEVUM_INTEGRATION, GLOAM_SDK, REALITY_SPIKES, FAILURE_MODES, CEREMONY).

## 1. Goals and non-goals
**Goal:** one complete, private, vouched-income flow on Aevum Testnet (44005) with tUSD8:
pay privately → payment vouched by a registered payer → recipient sweeps → recipient proves "≥ X received in period from N vouched payments" to one named reader with an expiry → reader verifies (page, API, on-chain).

**Non-goals (never in this build):**
- upper-bound ("below X") proofs
- identity/KYC of recipients
- account abstraction, paymasters, ERC-8004
- mainnet; post-quantum claims
- Gloam swaps, bridge, x402
- our own mixer or pool code (Gloam is the pool)
- server-side storage of user secrets or proofs

## 2. Hook, loop, boundary
- **Hook:** get paid privately in stablecoins, then prove you earn enough, and show nothing else.
- **Loop:** register payer → (gasless) deposit → vouched private pay → recipient sweeps → build proof → share link → reader verifies → revocation and expiry refusals shown live.
- **Boundary:** no AI. The underwriting bot (P1, D30) applies a fixed, versioned policy to a verified proof; it never
  holds the recipient's keys or note secrets, and it sees the link only when its holder sends it, for one decision
  (it reads only the proof's public facts and keeps no copy). Its own key exists only to call `IncomeVerifier.attest`,
  off by default and capped.

## 3. Architecture

```
web (Next.js, from Aevum Starter Kit)          contracts (Foundry, Shanghai)
 /      landing (public, D26)
 /app   dashboard (D26): overview + the four sections below
 /app/pay    payer: deposit + vouched pay ──►  ShaidaDepositor ──► Gloam ShieldPoolPoseidon (final keys)
 /app/inbox  recipient: receive + sweep  ──►  ShaidaLedger ──────► Gloam pool.transfer
 /app/prove  recipient: build income proof      ├ PayerRegistry
 /app/shared proof links made in this browser   │
 /v     reader: verify (link fragment)  ──view──►├ IncomeVerifier (Groth16, ceremony keys)
 /api/relay (hardened)                           └ Poseidon tree: vouch + sweep leaves
 /api/index (leaf snapshots, cursor)  ◄──logs── Aevum RPC (≤1,000-block pages)
packages/shaida-proofs: circuit, witness builder, prover, verifier client (reusable, ecosystem criterion)
packages/aevum: chain/tUSD8/EIP-3009/logs helpers adapted from the kit
```

### Web pages (D26; style: DESIGN.md, D25)
- **Landing `/`** (public, no wallet): the hook ("Get paid privately, prove you earn enough, show nothing else"); how it
  works in 3 steps (get paid privately → sweep → share a proof link); who it is for (freelancers, merchants,
  grantees); the trust story: the ceremony with its named contributors and public beacon (from `ceremony/record.json`),
  open source (repo link), and the limits stated plainly (LIMITS.md); CTAs to the dashboard and to a live verify
  example. No stats or testimonials that no command produced; the example link and personas are labelled demo, and the
  example CTA says so when no example link exists for the configured network.
- **Dashboard `/app`** (one place for the connected user): an overview with one card per section and real counts
  (`—` until read): **Pay** (as a payer: deposit, vouched pay; `/app/pay`), **Inbox** (incoming payments, sweep;
  `/app/inbox`), **Prove** (make a proof link; `/app/prove`), **Shared proofs** (links made in this browser, with their
  reader and expiry, newest first; `/app/shared`). Every section has an empty state, a loading state, an unknown-tx
  state (`TxOutcomeUnknown`, check by hash, never resend), an error state with its closed code, and works at 390 px.
  `/pay` and `/inbox` redirect to `/app/pay` and `/app/inbox`.
- **Prove `/app/prove`** and **verify `/v`**: PRD §5 and §7 acts 4–6; the details are D27. Templates (D31): Prove
  offers income (landlord), merchant revenue (lender) and grantee disbursements (donor or sponsor); the choice sets
  wording and a suggested reader, rides in the reader's URL as `?for=`, and changes nothing that is proven.
- **Underwriting bot `/underwrite`** (public, no wallet; D30): pick a preset policy, paste a link made out to the bot,
  see APPROVE, DECLINE with every failing reason, or INCONCLUSIVE; optionally record an approval on chain. The same
  engine is `POST /api/underwrite` and a CLI; `/llms.txt` and `/.well-known/agent.json` describe it for agents.

### Contracts (new, ours)
| Contract | Responsibility | Key functions |
|---|---|---|
| `PayerRegistry` | Attestor-managed set of payers. Each has a `payerId` (uint32), an address and a display-name hash. Revocation is immediate and permanent per id. | `register(addr, nameHash)`, `revoke(payerId)`, `activeIdOf(addr)` |
| `ShaidaDepositor` | Gasless deposit: `receiveWithAuthorization` (nonce = `keccak256(abi.encode(this, commitment))`) → approve pool → `shieldBound`. Also a standard approve path. | `depositWithAuthorization(...)`, `deposit(...)` |
| `ShaidaLedger` | Wraps Gloam `pool.transfer` and appends Shaida leaves to its own Poseidon tree (Gloam `IncrementalMerkleTreePoseidon`, depth 20). | `vouchedPay(transferArgs)` (msg.sender must be an active payer; inserts **V** = Poseidon(1, payerId, paymentCommitment)), `vouchedPayFor(transferArgs, payerSig)` (relayer path, EIP-712 sig by an active payer), `sweep(transferArgs)` (inserts **S** = Poseidon(2, nullifier, newCommitments[0])), `lateVouch(paymentCommitment)` / `lateVouchFor` (active payer only; repairs a front-run vouchedPay, D9), `isKnownRoot`. At most one V leaf per commitment. |
| `IncomeVerifier` | snarkjs Groth16 verifier wrapped so failure **reverts** (generated verifiers return `false` when out of gas): also requires asset = tUSD8 and `ledger.isKnownRoot(root)`, and refuses to start with less than `MIN_VERIFY_GAS` = 320,000 left (verifyProof measured at 262,573) (`InsufficientGas`; callers set 400k / 420k explicitly). One proof per call (bundles off-chain; ROADMAP). Optional `attest()` emits `IncomeProofChecked(contextHash, threshold, count)`. | `check(proof, signals)` view, `attest(...)` |

Reused (credited, licences kept): Gloam `ShieldPoolPoseidon`, `*VerifierFinal`, `DualProofVerifier`, `GloamPayMemo`, PoseidonT3 (circomlibjs bytecode), `IncrementalMerkleTreePoseidon` (MIT).

### The income circuit (`packages/shaida-proofs/circuits/income.circom`, 4 slots per proof, D12)
Public: `ledgerRoot, asset, threshold, count, fromIndex, toIndex, context`.
Per used slot i (used slots first, V-leaf indices strictly increasing):
1. `Cp = Poseidon(secretP, amount, asset)` (the payment note)
2. `V = Poseidon(1, payerId, Cp)` is in the ledger tree at index `vIdx`; `fromIndex ≤ vIdx ≤ toIndex`
3. `N = Poseidon(secretP, Cp)` (Gloam nullifier formula, S5)
4. `Cs = Poseidon(secretS, amountS, asset)` with `secretS ≠ 0` (the sweep note only the recipient knows)
5. `S = Poseidon(2, N, Cs)` is in the ledger tree
6. `amount < 2^64`; `sum(amount) ≥ threshold`; `count = Σ used ≥ 1`
`context = Poseidon(readerIdHash, expiryUnix, salt)`, checked by the verifier, not the circuit.
Bounds (D11): `fromIndex`, `toIndex` < 2^20; `threshold` < 2^68; `context` is bound to the proof by a dummy square. Compiled with circom 2.2.3 `--O2`: 44,687 constraints (fits 2^16; set up with the verified Hermez 2^17 ptau). r1cs sha256 `d866695c…` (D12).
Why this is sound (map to EVAL_DESIGN):
- V exists only if an active registered payer paid through ShaidaLedger (X01–X03).
- S exists only if the payment note was spent via `sweep`, and opening Cs needs the recipient's secret (X08 clawback, X09 presenter).
- The strict index order stops double counting (X04).

### Bundles: periods with more than 4 payments (D12)
A period is proved by a **bundle** of 1–8 proofs (at most 32 payments). Every proof in a bundle has the same
`context` (so the same reader and expiry), `asset` and `ledgerRoot` (D13), that root passes `isKnownRoot`, and the proofs' leaf ranges
`[fromIndex, toIndex]` are **strictly disjoint**. The bundle proves `total = Σ thresholds` over `count = Σ counts`
payments, from the lowest `fromIndex` to the highest `toIndex`.
Why this is sound: each proof counts only V leaves inside its own range (circuit), a payment has exactly one V leaf
(D9), and disjoint ranges share no leaf, so no payment is counted by two proofs (X14, X15). Proofs made for another
reader or expiry have another context and are refused as a set (X16, X17). Proofs against different roots are
refused too (`MixedRoots`, X18, D13): the builder makes every proof of a bundle against one root, so a mixed bundle was
joined from separate builds.
The witness builder splits automatically: payments in V-leaf order, at most 4 per proof; the first range starts at the
asked `fromIndex`, the last ends at the asked `toIndex`, each boundary is halfway between the last V leaf of one proof
and the first of the next; the asked threshold is split by water-filling in whole steps (equal shares, capped at each
proof's sum rounded down to the share step; D13). The step is 1 tUSD8 (1,000,000 base units) by default, or a coarser
multiple the recipient picks; the asked threshold must be a multiple of it (`InputRejected` otherwise), and
`BelowThreshold` if the rounded sums cannot reach it.
Disclosure cost: each proof's threshold, count and range are public, so a bundle shows sub-totals over sub-ranges
(EVAL C3, LIMITS).

### Off-chain
- **Indexer** `/api/index`: reads pool and ledger events with `getLogsChunked`, with retry and a persisted cursor. Serves leaf snapshots. The client recomputes the root and checks `isKnownRoot`; on mismatch it refuses with `UnknownRoot`.
- **Prover:** in the browser (snarkjs wasm + `income_final.zkey`, self-hosted, hash pinned). Node CLI for tests.
- **Proof link:** `/v#<base64url(JSON {v: 1, proofs: [{proof, publicSignals}] (1–8), readerIdHash, expiry, salt})>` (D12; a single proof is a bundle of one). The fragment never reaches the server.
- **Relayer** `/api/relay`: the kit's rail pattern plus hardening (§8). One route per contract function.

## 4. Vocabulary
- **Payer:** a registered business that pays through Shaida. **Recipient:** the freelancer. **Reader:** whoever the proof is for.
- **Vouch leaf (V)**, **sweep leaf (S)**, **ledger tree**.
- **Context:** binds a proof to a reader and an expiry. Since D35/D36 its salt is `Poseidon(4, revokeSecret)` (the
  holder can revoke the link) and its reader id can bind a reader code: `Poseidon(5, nameHash, Poseidon(code))`.
- **Link versions:** v1 (before D35: random salt, name only, not revocable; still verified exactly as before) and v2
  (`reader: "name" | "code"`, revocable).
- **States:**
  - payment: `sent → swept`, or `unknown`
  - proof: `building → ready → shared`
  - verification: `VALID | INVALID(code) | INCONCLUSIVE(code)`

### Closed error codes (shared by UI, API, bot)
| Code | Meaning | Retryable | Next action |
|---|---|---|---|
| `PayerNotRegistered` | sender/signer is not an active payer | no | register the payer first |
| `PayerRevoked` | payer id revoked | no | — |
| `UnknownRoot` | root not known on-chain or local tree incomplete | yes | resync |
| `ProofInvalid` | Groth16 check failed | no | rebuild proof |
| `ProofExpired` | now > expiry | no | ask for a new link |
| `WrongReader` | reader id hash ≠ verifier's id | no | ask for a link made for you |
| `ContextMismatch` | context ≠ Poseidon(reader, expiry, salt) | no | link was altered |
| `AssetMismatch` | asset ≠ tUSD8 | no | — |
| `RangeUnresolvable` | leaf indices can't be mapped to dates | yes | resync |
| `TxOutcomeUnknown` | broadcast without receipt | yes (check, never resend) | wait; check by hash/nullifier |
| `RelayerBudgetExceeded` | gas budget hit | later | use standard mode |
| `NotEnoughSlots` | > 32 payments in range (a bundle is at most 8 proofs of 4, D12) | no | split the period into shorter ones |
| `TokenPaused` | tUSD8 is paused by its issuer (S9) | later | wait for the issuer to unpause; nothing was sent |
| `PayerBlacklisted` | the paying address is on tUSD8's blacklist (S9) | no | pay from another address |
| `RecipientBlacklisted` | the withdrawal address is on tUSD8's blacklist (S9) | no | withdraw to another address |
| `NoSweptPayments` | no vouched, swept payment in the period (D10) | no | sweep first, or pick another period |
| `BelowThreshold` | the counted payments add up to less than the threshold (D10) | no | lower the threshold or widen the period |
| `InputRejected` | the proof request failed the strict schema (D10) | no | fix the input; nothing was built |
| `RangesOverlap` | two proofs of a bundle share a leaf index (D12) | no | ask for a new link |
| `MixedContexts` | the proofs of a bundle were made for different readers or expiries (D12) | no | ask for a new link |
| `MixedRoots` | the proofs of a bundle were made against different ledger roots (D13) | no | ask for a new link |
| `AlreadySpent` | the note was already spent: swept by the recipient, or moved (D17) | no | nothing was sent |
| `AlreadyVouched` | the payment already has its vouch leaf (D17) | no | nothing to do |
| `SignatureInvalid` | a payer signature is malformed, for another call, or outside its window (D17) | no | sign again; nothing was sent |
| `RateLimited` | too many relay requests from this address or IP (D17) | later | wait a minute; nothing was sent |
| `RelayerUnavailable` | the relayer has no usable key, no gas, or cannot read the chain (D17) | later | try later or pay gas yourself |
| `TxRejected` | the chain refused the call in simulation, or the tx mined and reverted (D17) | no | read the message; a mined revert cost gas, nothing else changed |
| `NotConfigured` | the app has no Shaida contracts for this network (D17) | no | the operator sets them; nothing was read or sent |
| `ChainUnreachable` | the bot could not read the chain or its index (D30) | yes | try again shortly; nothing was decided or sent |
| `AttestCapReached` | the bot's daily record count or gas cap is reached (D30) | later | the decision stands; nothing was sent |
| `AlreadyRecorded` | part of this link was already recorded by the bot (D30) | no | nothing to do |
| `RecorderUnavailable` | the bot has no recording key or not enough gas (D30) | later | the decision stands; nothing was sent |
| `ProofRevoked` | the holder revoked the link: Revocations has its salt at the pinned block (D35) | no | ask the holder for a new link |
| `AlreadyRevoked` | the link is already revoked; nothing was sent (D35) | no | nothing to do |

The bot's decisions (D30) are `APPROVE`, `DECLINE` with reasons, or `INCONCLUSIVE` with one code. A DECLINE reason is a
verification refusal above (`ProofInvalid`, `AssetMismatch`, `MixedContexts`, `MixedRoots`, `RangesOverlap`,
`ContextMismatch`, `WrongReader`, `ProofExpired`, `ProofRevoked`) or a policy rule, checked in this order: `BelowMinThreshold`,
`TooFewPayments`, `PeriodTooShort`, `PeriodTooLong`, `ProofTooOld`, `ExpiresTooSoon`. INCONCLUSIVE is
`ChainUnreachable`, `UnknownRoot` or `RangeUnresolvable`; it is never an approval.

Before every deposit, pay and withdraw, the app reads `paused()` and `isBlacklisted(address)` on tUSD8 and refuses
with the codes above before asking for a signature (D7). `ShaidaDepositor` repeats the deposit checks on chain.

## 5. Core verification steps (`verifyIncomeLink`, first failure returns its code)
Input: a bundle of 1–8 proofs (D12). Pure (`packages/shaida-proofs/src/verify/`): the chain reads, the Groth16 check,
the reader's id hash, the reader code, the revocation read and the clock are injected. Retryable codes (`UnknownRoot`,
`RangeUnresolvable`) and an unreadable revocation registry (`ChainUnreachable`, `NotConfigured`) give `INCONCLUSIVE`,
the others `INVALID`.
1. Decode the fragment and parse it as `unknown`; strict schema (`.strict()`, canonical decimal strings, 1–8 proofs). → `ProofInvalid`
2. Every proof's `asset == tUSD8`. → `AssetMismatch`
   - 2a. Every proof has the same `context`. → `MixedContexts`
   - 2b. Every proof has the same `ledgerRoot` (D13). → `MixedRoots`
   - 2c. Leaf ranges are strictly disjoint (sorted by `fromIndex`, each `toIndex` < the next `fromIndex`; a duplicated proof overlaps itself). → `RangesOverlap`
3. `context == Poseidon(readerIdHash, expiry, salt)`. → `ContextMismatch`
4. `readerIdHash == hash(this reader's id)`: the name's hash, or for a v2 `"code"` link `Poseidon(5, nameHash,
   Poseidon(code))` with the reader's code (no code given → `WrongReader`, D36). → `WrongReader`
5. `now ≤ expiry`. → `ProofExpired`
   - 5a. `Revocations.revokedAt(salt)` at the same pinned block as step 6, for **every** link (v1 included, D35). Revoked →
     `ProofRevoked` (INVALID) with the revocation's block and time. Unreadable → `ChainUnreachable`, no registry
     configured → `NotConfigured` (both INCONCLUSIVE, never VALID).
6. `ledger.isKnownRoot(ledgerRoot)` at a pinned block, for the bundle's one root. → `UnknownRoot`
7. Groth16 verify every proof (off-chain), and optionally `IncomeVerifier.check` on-chain. → `ProofInvalid`
8. Map the lowest `fromIndex` and highest `toIndex` to block timestamps via ledger `Vouched` events. → `RangeUnresolvable`
9. Result `VALID{threshold = Σ thresholds, count = Σ counts, fromDate, toDate, expiry, proofs, link: {version, readerMode, revocable}}`.

Steps 1–5 read nothing from the chain, so a link refused on its own content (including a code-protected link opened
without its code) is refused offline.

## 6. State machines
- **Payment (recipient side):** `seen` (memo opened) → `sweeping` → `swept` | `unknown`. `unknown` has **no resend edge**: check by nullifier.
- **Relayed tx:** `accepted → pending → mined | dropped | unknown`. Each is persisted with (requestId, nonce, hash, gas).
- **Proof:** `selecting → proving → ready`. A failure returns to `selecting` with a code.
- **Revoke (holder side, D35):** `revocable → sending → pending → revoked | unknown`, saved before the relayer is
  called. `revoked` only when `revokedAt(salt) > 0` on chain; `unknown` has **no resend edge** (checked on chain and by
  the relayer's record). A refusal before sending goes back to `revocable` with its code.

## 7. Demo script (live, 3–5 min, top 5)
1. (0:00) Problem in one line; Ada's public wallet shown on the explorer: everything visible.
2. (0:30) Payer "Acme Studio" (registered) pays Ada 3× privately. The first deposit is gasless (signature only). Show the tx on the explorer: no amount, no recipient.
3. (1:30) Ada's inbox: 3 payments → sweep. A clawback attempt by Acme fails (`AlreadySpent`).
4. (2:15) Ada builds a proof for "Landlord Bola", ≥ $15, expiring Dec 20. Shares the link.
5. (2:45) Bola opens the link: ✓ VALID, ≥ $15, 3 vouched payments, Sep–Nov, until Dec 20. Nothing else.
6. (3:15) Attacks, live: edit the threshold in the link → `ProofInvalid`; open as another reader → `WrongReader`; Ada pays herself from an unregistered wallet → `PayerNotRegistered`; an expired link → `ProofExpired`.
7. (4:15) On-chain check tx on the explorer; repo, ceremony record, limits.

## 8. Security model
| # | Adversary | Capability | Defence (file) |
|---|---|---|---|
| A1 | Recipient inflating income | forge/duplicate/out-of-range notes, self-pay | circuit constraints; vouch requires active payer (`ShaidaLedger`, `income.circom`) |
| A2 | Payer clawing back | knows payment secret | only swept payments count (S leaf + Cs secret) |
| A3 | Payer presenting the recipient's income | knows Cp, N | cannot open Cs |
| A4 | Reader-side tampering / forwarding | edits link, forwards to a 3rd party | context binding, reader id, expiry |
| A5 | Relayer drainer | spam expensive txs | per-IP/payer limits before simulation, gas budget, explicit gas cap, simulate before send, one route per function |
| A6 | Setup forger | knows toxic waste | Gloam final ceremony keys; Shaida multi-party phase 2 + beacon (CEREMONY.md) |
| A7 | Indexer lying | serves wrong leaves | client recomputes the root and checks `isKnownRoot` |
| A8 | Attestor misuse | registers fake payers | trust assumption, stated; registry events public |

**Not defended:**
- collusion between a registered payer and a recipient (fake pay + off-chain refund)
- a malicious attestor
- tUSD8 issuer blacklist/pause (S9)
- a small anonymity set on testnet
- quantum adversaries

**Not analysed:** side channels in browser proving; front-end supply chain beyond pinned deps.

## 9. Test list (mirrors the demo and EVAL_DESIGN; IDs in test titles)
- Circuit: H1, H2, X04–X07, X08 (no S leaf), X09 (wrong Cs secret), threshold, count, root, gap, zero, 4-slot full.
- Witness builder: bundle split (5, 9, 12 and 32 payments; threshold = total), `NotEnoughSlots` (33 payments), property test over 1–13 payments.
- Contracts: X01/X02 `PayerNotRegistered` (direct and relayed), X03 `PayerRevoked`, gasless deposit replay/amount/commitment binding (from S6), `sweep` inserts S, roots known, legacy-tx fork test on real tUSD8, tUSD8 blacklist/pause probe (S9), Shanghai opcode check over all artifacts.
- Verifier: every §4 code reachable; tamper threshold/count/range/context → refused; bundles: honest 2- and 3-proof, X14 overlapping ranges, X15 duplicate proof, X16 mixed reader, X17 mixed expiry, X18 mixed roots.
- Relayer: each rail, budget, unknown-outcome handling (no double submit).
- Indexer: retry, cursor resume, root-mismatch refusal.

## 10. Priorities
- **P0:**
  - contracts above
  - circuit (4 slots per proof, bundles: D12) + ceremony
  - Node and browser prover
  - verify page + on-chain check
  - indexer
  - relayer (hardened basics)
  - pay / inbox / prove / verify UI
  - live 44005 run with evidence
  - README, NOTICE, LIMITS, CEREMONY
- **P1:**
  - underwriting bot (API + rule): built, D30
  - merchant and grantee verifier templates: built, D31
  - optional payer-name disclosure
  - explorer verification (S10)
  - gas-budget store in KV
- **Never:** everything in §1 non-goals.

## 11. Build order (record each demo act the moment it works)
| Dates (2026) | Work | Exit check |
|---|---|---|
| Nov 21–22 | Repo from the kit; Gloam as pinned submodule; `make fork` stack deploy (Poseidon, Gloam final verifiers, pool, memo, Shaida contracts); S9 probe | fork test: deposit → vouchedPay → sweep with real tUSD8 |
| Nov 23–24 | `income.circom` v1 (8 slots; 4 slots + bundles since D12) + witness builder + all circuit tests | **go/no-go Nov 24** (fallback per IDEA_CHECK R7) |
| Nov 25–26 | Ceremony phase 2 (2+ contributors + beacon); `IncomeVerifier`; Node prover; verification core (§5) | X-suite green; ceremony recorded |
| Nov 27–29 | Indexer + relayer + pay/inbox flows | acts 2–3 work on fork |
| Nov 30–Dec 2 | Browser prover + prove/verify UI; landing `/` and dashboard `/app` in DESIGN.md's system (D25, D26) | acts 4–6 on fork (script + UI at 390 px and desktop); S8 timing with the final key recorded; screenshots of landing, dashboard, prove and verify in `evidence/ui/` |
| Dec 3–4 | Deploy to 44005; real run with the faucet tUSD8 | evidence/A02, A04 generated |
| Dec 5–7 | README, NOTICE, LIMITS, judge path, P1 items if green | clean-clone gate passes |
| Dec 8–9 | Pre-submit audit; rehearse the live demo | audit checklist done |
| Dec 10 | Submit on DoraHacks (deadline Dec 11 09:00 Lagos) | submission page saved |

## 12. Definition of finished
- The gate passes from a clean clone.
- All acts 1–7 run on 44005, with tx hashes in `evidence/`.
- Every README claim is in CLAIMS.md as PROVEN.
- NOTICE complete; ceremony published.
- The live URL works logged-out.
- The submission is in before Dec 10 23:59 Lagos.

## 13. Submission mapping
See `briefing/EVENT.md` (acceptance IDs A01–A12). Submit at dorahacks.io/hackathon/qday.

## 14. Judge Q&A
See `briefing/LANDSCAPE.md` (prepared questions), plus:
- Q: Why trust your setup? A: CEREMONY.md: Hermez phase 1 (hash-checked) plus independent contributors and a public beacon.
- Q: What does a reader learn? A: threshold, count, period, expiry; nothing else unless the recipient opts in.
