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
- **Boundary:** no AI. The underwriting bot (P1) applies a fixed rule to a verified proof; it never holds keys or sees more than the public signals.

## 3. Architecture

```
web (Next.js, from Aevum Starter Kit)          contracts (Foundry, Shanghai)
 /pay   payer: deposit + vouched pay  ───────►  ShaidaDepositor ──► Gloam ShieldPoolPoseidon (final keys)
 /inbox recipient: receive + sweep    ───────►  ShaidaLedger ──────► Gloam pool.transfer
 /prove recipient: build income proof            ├ PayerRegistry
 /v     reader: verify (link fragment)  ──view──►├ IncomeVerifier (Groth16, ceremony keys)
 /api/relay (hardened)                           └ Poseidon tree: vouch + sweep leaves
 /api/index (leaf snapshots, cursor)  ◄──logs── Aevum RPC (≤1,000-block pages)
packages/shaida-proofs: circuit, witness builder, prover, verifier client (reusable, ecosystem criterion)
packages/aevum: chain/tUSD8/EIP-3009/logs helpers adapted from the kit
```

### Contracts (new, ours)
| Contract | Responsibility | Key functions |
|---|---|---|
| `PayerRegistry` | Attestor-managed set of payers. Each has a `payerId` (uint32), an address and a display-name hash. Revocation is immediate and permanent per id. | `register(addr, nameHash)`, `revoke(payerId)`, `activeIdOf(addr)` |
| `ShaidaDepositor` | Gasless deposit: `receiveWithAuthorization` (nonce = `keccak256(abi.encode(this, commitment))`) → approve pool → `shieldBound`. Also a standard approve path. | `depositWithAuthorization(...)`, `deposit(...)` |
| `ShaidaLedger` | Wraps Gloam `pool.transfer` and appends Shaida leaves to its own Poseidon tree (Gloam `IncrementalMerkleTreePoseidon`, depth 20). | `vouchedPay(transferArgs)` (msg.sender must be an active payer; inserts **V** = Poseidon(1, payerId, paymentCommitment)), `vouchedPayFor(transferArgs, payerSig)` (relayer path, EIP-712 sig by an active payer), `sweep(transferArgs)` (inserts **S** = Poseidon(2, nullifier, newCommitments[0])), `isKnownRoot` |
| `IncomeVerifier` | snarkjs Groth16 verifier wrapped so failure **reverts** (generated verifiers return `false` when out of gas). Optional `attest()` emits `IncomeProofChecked(contextHash, threshold, count)`. | `check(proof, signals)` view, `attest(...)` |

Reused (credited, licences kept): Gloam `ShieldPoolPoseidon`, `*VerifierFinal`, `DualProofVerifier`, `GloamPayMemo`, PoseidonT3 (circomlibjs bytecode), `IncrementalMerkleTreePoseidon` (MIT).

### The income circuit (`packages/shaida-proofs/circuits/income.circom`, 8 slots)
Public: `ledgerRoot, asset, threshold, count, fromIndex, toIndex, context`.
Per used slot i (used slots first, V-leaf indices strictly increasing):
1. `Cp = Poseidon(secretP, amount, asset)` (the payment note)
2. `V = Poseidon(1, payerId, Cp)` is in the ledger tree at index `vIdx`; `fromIndex ≤ vIdx ≤ toIndex`
3. `N = Poseidon(secretP, Cp)` (Gloam nullifier formula, S5)
4. `Cs = Poseidon(secretS, amountS, asset)` with `secretS ≠ 0` (the sweep note only the recipient knows)
5. `S = Poseidon(2, N, Cs)` is in the ledger tree
6. `amount < 2^64`; `sum(amount) ≥ threshold`; `count = Σ used ≥ 1`
`context = Poseidon(readerIdHash, expiryUnix, salt)`, checked by the verifier, not the circuit.
Why this is sound (map to EVAL_DESIGN):
- V exists only if an active registered payer paid through ShaidaLedger (X01–X03).
- S exists only if the payment note was spent via `sweep`, and opening Cs needs the recipient's secret (X08 clawback, X09 presenter).
- The strict index order stops double counting (X04).

### Off-chain
- **Indexer** `/api/index`: reads pool and ledger events with `getLogsChunked`, with retry and a persisted cursor. Serves leaf snapshots. The client recomputes the root and checks `isKnownRoot`; on mismatch it refuses with `UnknownRoot`.
- **Prover:** in the browser (snarkjs wasm + `income_final.zkey`, self-hosted, hash pinned). Node CLI for tests.
- **Proof link:** `/v#<base64url(proof, signals, readerId, expiry, salt)>`. The fragment never reaches the server.
- **Relayer** `/api/relay`: the kit's rail pattern plus hardening (§8). One route per contract function.

## 4. Vocabulary
- **Payer:** a registered business that pays through Shaida. **Recipient:** the freelancer. **Reader:** whoever the proof is for.
- **Vouch leaf (V)**, **sweep leaf (S)**, **ledger tree**.
- **Context:** binds a proof to a reader and an expiry.
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
| `NotEnoughSlots` | > 8 payments in range | no | split the period (disjoint ranges add safely) |

## 5. Core verification steps (`verifyIncomeLink`, first failure returns its code)
1. Parse the fragment as `unknown`; strict schema (`.strict()`, BigInt strings). → `ProofInvalid`
2. `asset == tUSD8`. → `AssetMismatch`
3. `context == Poseidon(readerIdHash, expiry, salt)`. → `ContextMismatch`
4. `readerIdHash == hash(this reader's id)`. → `WrongReader`
5. `now ≤ expiry`. → `ProofExpired`
6. `ledger.isKnownRoot(ledgerRoot)` at a pinned block. → `UnknownRoot`
7. Groth16 verify (off-chain), and optionally `IncomeVerifier.check` on-chain. → `ProofInvalid`
8. Map `fromIndex`/`toIndex` to block timestamps via ledger `Vouched` events. → `RangeUnresolvable`
9. Result `VALID{threshold, count, fromDate, toDate, expiry}`.

## 6. State machines
- **Payment (recipient side):** `seen` (memo opened) → `sweeping` → `swept` | `unknown`. `unknown` has **no resend edge**: check by nullifier.
- **Relayed tx:** `accepted → pending → mined | dropped | unknown`. Each is persisted with (requestId, nonce, hash, gas).
- **Proof:** `selecting → proving → ready`. A failure returns to `selecting` with a code.

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
- Circuit: H1, H2, X04–X07, X08 (no S leaf), X09 (wrong Cs secret), threshold, count, root, gap, zero, 8-slot full, `NotEnoughSlots`.
- Contracts: X01/X02 `PayerNotRegistered` (direct and relayed), X03 `PayerRevoked`, gasless deposit replay/amount/commitment binding (from S6), `sweep` inserts S, roots known, legacy-tx fork test on real tUSD8, tUSD8 blacklist/pause probe (S9), Shanghai opcode check over all artifacts.
- Verifier: every §4 code reachable; tamper threshold/count/range/context → refused.
- Relayer: each rail, budget, unknown-outcome handling (no double submit).
- Indexer: retry, cursor resume, root-mismatch refusal.

## 10. Priorities
- **P0:**
  - contracts above
  - circuit (8 slots) + ceremony
  - Node and browser prover
  - verify page + on-chain check
  - indexer
  - relayer (hardened basics)
  - pay / inbox / prove / verify UI
  - live 44005 run with evidence
  - README, NOTICE, LIMITS, CEREMONY
- **P1:**
  - underwriting bot (API + rule)
  - merchant and grantee verifier templates
  - optional payer-name disclosure
  - explorer verification (S10)
  - gas-budget store in KV
- **Never:** everything in §1 non-goals.

## 11. Build order (record each demo act the moment it works)
| Dates (2026) | Work | Exit check |
|---|---|---|
| Nov 21–22 | Repo from the kit; Gloam as pinned submodule; `make fork` stack deploy (Poseidon, Gloam final verifiers, pool, memo, Shaida contracts); S9 probe | fork test: deposit → vouchedPay → sweep with real tUSD8 |
| Nov 23–24 | `income.circom` v1 (8 slots) + witness builder + all circuit tests | **go/no-go Nov 24** (fallback per IDEA_CHECK R7) |
| Nov 25–26 | Ceremony phase 2 (2+ contributors + beacon); `IncomeVerifier`; Node prover; verification core (§5) | X-suite green; ceremony recorded |
| Nov 27–29 | Indexer + relayer + pay/inbox flows | acts 2–3 work on fork |
| Nov 30–Dec 2 | Browser prover + prove/verify UI | acts 4–6 on fork; S8 timing recorded |
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
