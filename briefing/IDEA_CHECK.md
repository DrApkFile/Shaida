# IDEA_CHECK: Shaida

Date: 2026-11-20
Read before this: references/anti-patterns.md, references/idea-check.md

## Hook
Get paid privately in stablecoins, then prove you earn enough, and show nothing else.

## Who, the job, how they cope today, where it fails
Ada, a Lagos product designer, paid in USDT by three foreign clients. This month she must:
- show a landlord she can afford rent, and
- give a visa office 3–6 months of income evidence.

How she copes today:
- **Screenshots** of exchange history. Trivial to fake, so landlords discount them.
- **Sharing her wallet address.** That exposes every client, every amount and her whole balance, to a stranger, forever.
- **Cashing out to a bank first** just to get a statement. That costs FX spread and fees, and takes days.

Where it fails: she either gives up her privacy or isn't believed. The cost is money (cash-out fees), time, and the risk of being targeted because her full balance is public.

## Hard core
A zero-knowledge circuit proving "the sum of payments to me in block range [A, B] is at least X, across N distinct payments". Each payment is a real, unspent-or-swept note in the Gloam tree, inside the range, and each is backed by a signature from a registered payer. Bound to one named reader and an expiry. The hard part is soundness:
- no double counting
- range enforcement through leaf positions
- binding the proof to the recipient, so a payer (who also knows the note secret) can't present it as theirs
- binding to the reader and expiry

## Thin-wrapper test
There's no model call at all. Remove the UI and what remains is the circuit, the verifier contract, the payer registry and the TS client.

## Sponsor deletion test
| Sponsor | Removed → what breaks | On critical path? |
|---|---|---|
| Aevum | Pool, registry and verifier contracts have nowhere to live; no settlement | Yes |
| tUSD8 | No asset; no EIP-3009 gasless deposit | Yes |
| Gloam (library) | No private payments; nothing to prove over | Yes |

## Boundary
No AI. The "agent" is a deterministic underwriting bot.
- Proposes: the bot applies a lender's rule ("approve if a valid proof says ≥ $X from ≥ 2 payers").
- Decides: the verifier contract/code. A proof either verifies or is refused with a named reason.
- The bot never: holds the user's keys, sees amounts beyond the proven bound, or accepts an expired or wrong-reader proof.

## The loop
register payer → payer deposits tUSD8 (gasless) → private pay + payer signature → freelancer sweeps the note into one only they know → freelancer builds proof for a named reader with an expiry → reader verifies (page, API or on-chain) → **revocation**: a payer de-registered before the proof time fails verification → **expiry**: an old link is refused.
The steps others skip: revocation, expiry and refusal, each shown live.

## What we deliberately do not claim
- Upper bounds ("income below X").
- Identity: we don't prove who the freelancer *is*, only that they control the receiving key.
- Collusion resistance: a registered payer can fake-pay and get refunded off-chain.
- Strong anonymity on testnet (small anonymity set).
- Post-quantum security.
- Trusted-setup safety beyond what our ceremony gives (see risk R4).

## Rubric → proof map
| Criterion | How Shaida answers it | Proof a judge can open |
|---|---|---|
| Innovation (20) | New primitive: vouched, private income-over-time proof | circuit + LANDSCAPE gap |
| UX (15) | 3 screens, plain refusals | live demo |
| Tech + integration (15) | Circuit, verifier on Aevum, EIP-3009, log chunking | tests, deployments/aevum.json |
| Utility (15) | Freelancer → landlord/visa/lender; merchant and grantee templates | README "Who it's for" |
| Safety (15) | Reader binding, expiry, payer revocation, adversarial tests | evidence/ tamper runs |
| Demo (10) | 60-second judge path with tx hashes | evidence/A04-demo-run.md |
| Docs (10) | README, ARCHITECTURE, LIMITS | repo |

## Consent / third-party handling
- Payers opt in by registering and signing each payment. Their names appear only to readers a freelancer chooses.
- Readers learn only the proven bound, the payer count, and the payer names only if the freelancer chooses to show them.
- No personal data is stored server-side. Demo personas are fictional.

## Risks found in this check (must be settled by spikes)
| # | Risk | Why it matters | Planned handling |
|---|---|---|---|
| R1 | Payer clawback | In Gloam the payer creates the payment secret and can spend it back until the payee sweeps (sdk `incoming.ts`). Counting an unswept note counts money that may be gone. | Count only notes the recipient has swept. The circuit links the payment note's nullifier to a fresh note only the recipient knows (as `payroll_total` links payment to spend). Spike S5. |
| R2 | Who is presenting | Payer also knows the payment secret, so knowledge of the secret proves nothing about the recipient | Payer signs (commitment, recipient key). The proof context includes the recipient key, and the presenter signs the context with it. |
| R3 | Date range | Notes have no timestamps | Leaf index ↔ block via the pool's insert events. The circuit constrains leaf index range. Spike S4. |
| R4 | Trusted setup | A single-party Groth16 setup lets its creator forge proofs | **Gloam circuits: settled by S2**, using the final ceremony keys and final verifiers on Aevum. **Shaida's new circuit (S7):** PLONK was 8× slower to prove and its key 8× bigger, so **Groth16 with a multi-party phase 2** (Hermez phase 1 + ≥ 2 contributors + public beacon), recorded in CEREMONY.md. Forging then needs every contributor to collude. |
| R5 | Verifier adoption | Landlords won't install anything | Verification is a plain link and an API; on-chain check optional |
| R6 | Payer friction | Why would a client register? | One EIP-712 signature inside the pay flow. Platforms/payroll providers are the natural payers (roadmap). |
| R7 | Solo scope, 21 days | New circuit + registry + app | Spikes first. Fallback: aggregate Gloam `receipt` proofs plus payer signatures, no new circuit. |
| R8 | Faucet scarcity | 5 tUSD8 per address once | Demo amounts in cents; local fork for tests |

## Verdict
**Go, with changes:** payer vouching (R2) and counting only swept notes (R1) are part of the core, not extras. Run spikes S1–S5 before any product code. If the circuit (S4/S5) isn't proving correctly by 2026-11-24, switch to the R7 fallback.
