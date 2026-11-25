# SUBMISSION: draft of the DoraHacks BUIDL page (Aevum Builder Challenge #1)

Draft for https://dorahacks.io/hackathon/qday. Every statement is from README.md and CLAIMS.md (PROVEN rows only).
Deadline: **2026-12-11 08:00 UTC** (09:00 Lagos). Fields marked **TODO** are the builder's.

## Name
Shaida

## Tagline
Get paid through a private pool on Aevum, prove you earn enough to a reader you name. (The landing page's headline: "Get paid through a private pool, prove you earn enough".)

## Short description
Shaida lets a freelancer, merchant or grantee get paid in tUSD8 through Gloam's shielded pool on Aevum testnet, then
prove "at least X from N payments by registered payers, in this period" to one named reader with an expiry, without
sharing a wallet. The reader verifies in the browser, or on chain with `IncomeVerifier.check`. A deterministic
underwriting bot (no LLM) applies a published policy to the same proof. It is live at https://shaida.onrender.com;
two end-to-end runs and one bot decision are recorded on chain, and the privacy limits were measured and published.

## The problem
To rent a flat or get credit, someone paid in stablecoins has to show income. A wallet shows every payment,
counterparty and balance. A screenshot proves nothing. The reader needs real, recent, vouched income; the earner needs
to keep the rest of their finances to themselves.

## The solution
- Payers registered by an attestor pay privately through Gloam's pool. Shaida's ledger writes a **vouch leaf** for
  each payment by an active registered payer, and a **sweep leaf** when the recipient moves it into a note only they
  can open.
- The recipient proves in the browser, with a Groth16 circuit (44,687 constraints) set up in a two-contributor
  ceremony, that vouched and swept payments add up to at least a threshold. The proof is bound to one reader name
  and an expiry, and rides in the URL fragment, so the server never sees it.
- The reader opens the link, types their name and gets VALID or a named refusal (WrongReader, ProofInvalid,
  ContextMismatch, ProofExpired, …). They can also run the on-chain check, which costs no gas.
- Landlords and lenders who read many links can point the underwriting bot at them. It runs the same verification,
  then six fixed rules, and answers APPROVE, DECLINE with every reason, or INCONCLUSIVE.

## How it works
Loop: register payer → gasless deposit (EIP-3009) → vouched private pay → recipient sweeps → proof in the browser →
share link → reader verifies (page, API or chain) → refusals for edits, the wrong reader and expiry.
Contracts on 44005: `PayerRegistry`, `ShaidaDepositor`, `ShaidaLedger`, `IncomeVerifier` and the ceremony's
`IncomeGroth16Verifier`, all on Gloam's `ShieldPoolPoseidon` with Gloam's final-ceremony verifiers. Off chain: an
indexer (chunked `eth_getLogs`, persisted cursor), a hardened relayer (one route per contract function, records
claimed in Redis before each send), and the Next.js app. Diagram and guarantees table: README "The loop" and
"How it works".

## Tracks
Decentralized Payments; Confirmation of Payee (payer vouching). There is one prize pool.

## Tech
Aevum testnet 44005, tUSD8 (FiatTokenV2, EIP-3009), Solidity 0.8.24 (Shanghai) with Foundry, circom 2.2.3 and snarkjs
0.7.6 (Groth16), Gloam contracts and `@gloamtrade/sdk` 0.8.0, Next.js 16.4.6, React 19, wagmi, viem, RainbowKit, zod,
Upstash Redis, Render, Node 24.

## Team
Kene, solo. **TODO:** the DoraHacks handle (acceptance A09 is checked by hand).

## Links
| | |
|---|---|
| Live app | https://shaida.onrender.com |
| Repository | https://github.com/DrApkFile/Shaida |
| Ceremony release | https://github.com/DrApkFile/Shaida/releases/tag/ceremony-v1 (income_final.zkey, sha256 `cbcb06fe…`) |
| Explorer: IncomeVerifier | https://explorer-test.qday.info/address/0xc9844a8f058be2d658c972d1d2276b13f308e1c8?tab=contract |
| Explorer: run 1 attest | https://explorer-test.qday.info/tx/0xf8c1b89b50c79f2891b254f1ca3b297e1e5bb796af64f292b72a2a28f0645441 |
| Explorer: bot attest | https://explorer-test.qday.info/tx/0xc2caccd4db89f8b0dccc0d67e7cf7df0491fec304248b2bc58c8fe137075a415 |
| Judge guide | https://github.com/DrApkFile/Shaida/blob/master/PROOF_PLAN.md |
| Video | **TODO:** link after upload (script: docs/VIDEO.md, 2:20) |

## At a glance: judging criteria → where the answer is
Weights from qday.io (out of 100). Ecosystem contribution is DoraHacks' extra criterion and has no weight.

| Criterion | Weight | What answers it | Files and evidence |
|---|---:|---|---|
| Innovation and originality | 20 | Vouched, swept income totals proven in zero knowledge, bound to one reader and an expiry; a deterministic underwriting bot over the same proof | `packages/shaida-proofs/circuits/income.circom`, `contracts/src/ShaidaLedger.sol`, DECISIONS D3, D30 |
| User experience and presentation | 15 | Pay, inbox, prove and verify in the browser at 390 px; named refusals that say whether anything changed; run 2 clicked by a person on the live site | `evidence/live-44005-run2.md`, `evidence/ui-44005/`, `evidence/judge-ui/`, `DESIGN.md` |
| Technical quality and platform integration | 15 | EIP-3009 gasless deposits; legacy txs; Shanghai opcode check; 1,000-block log paging with a cursor; a restart-safe relayer; the snarkjs gas trap handled; `make gate` from a clean clone | `evidence/presubmit-audit.md`, `evidence/fork-gas.md`, `tools/gate.sh`, D14, D19, D29 |
| Real-world utility | 15 | Templates for income (landlord), revenue (lender) and disbursements (sponsor); the bot as an API for lenders and agents | D31, `/underwrite`, `/.well-known/agent.json`, `evidence/underwrite-live-44005.md` |
| Safety, trust and controls | 15 | Reader binding, expiry, payer revocation; relayer rails and gas budget; the bot's own capped key, opt-in recording; a two-contributor ceremony; a published privacy audit of our own deployment | `THREAT_MODEL.md`, `LIMITS.md`, `ceremony/TRANSCRIPT.md`, `evidence/privacy-audit.md` |
| Demo | 10 | Two runs and a bot record on 44005 with tx links; a 60-second judge path with live attacks; read-only commands anyone can paste | `PROOF_PLAN.md`, `evidence/live-44005-run1.md`, `evidence/eligibility.md` |
| Documentation | 10 | README in judge order with a diagram, contract addresses and reproduction steps; every claim in CLAIMS.md with evidence, checked by the gate | `README.md`, `CLAIMS.md`, `PRD.md`, `DECISIONS.md`, `DEPLOY_RENDER.md` |
| Ecosystem contribution | — | `@shaida/proofs` (circuit, witness builder, verifier core with no network imports), `@shaida/underwrite` (engine and CLI), `tools/check-shanghai.mjs` extended to Gloam | `packages/shaida-proofs`, `packages/shaida-underwrite`, `NOTICE.md` |

## What is not built (stated on the page too)
On-chain bundle checks, a reader code that authenticates the reader, a relayer key pool, signed bot decisions,
payer-name disclosure, the privacy fixes F1, F2, F6, F7 and F10, and mainnet (ROADMAP.md). The payer of every payment
is public by design, and at today's volume timing links sweeps to payments (LIMITS.md).

## Build log (all inside the window, 2026-11-16 → 2026-12-11)
| Dates (2026) | Commits | What |
|---|---|---|
| Nov 20 | `3c6dcfc`–`9e2ff48` | Started from the Aevum Starter Kit; Gloam pinned; stack deployed to a fork; tUSD8 issuer spike (S9) |
| Nov 20 | `753a8dc`–`3a851b3` | PayerRegistry, ShaidaDepositor, ShaidaLedger with tests; fork exit check on real tUSD8; lateVouch (D9) |
| Nov 20–21 | `d3746d0`–`683648a` | Income circuit, witness builder, X-suite; browser bench; 4 slots with bundles (D12, D13) |
| Nov 21 | `5f39a3f`–`e370842` | Ceremony: setup, contribution 1 superseded (placeholder name) and redone, contribution 2, beacon, final key |
| Nov 21 | `8837878`–`3e4e8b3` | Indexer, relayer, pay flows, pay and inbox UI; acts 2–3 green on the fork after three failed runs (D20) |
| Nov 21–22 | `9630da6`–`b21e0d8` | Next.js security upgrade; IncomeVerifier in the deploy; `make gate` and the claims check |
| Nov 22 | `0d733a1`–`2a10759` | Release ceremony-v1; design system; landing, dashboard, prove and verify; acts 4–6 on the fork (script and UI) |
| Nov 22 | `ee3336f`–`8a52763` | Deployed to 44005; explorer verification; withdrawals; secret scan; **live run 1** |
| Nov 22–23 | `7b4f646`–`cd50d13` | Redis-backed relayer and index; Render rehearsal; hosted at shaida.onrender.com |
| Nov 23 | `9d7b525`–`ad2b9ff` | Withdrawal batch on 44005; prove-form fix; **live run 2**, clicked by hand |
| Nov 23–24 | `a5f4f00`–`159545d` | Underwriting bot, templates, agent card; live APPROVE/DECLINE and the bot's on-chain record |
| Nov 25 | `db8c13d`–`9aec406` | Privacy audit of the live deployment; pitch corrected; quick fixes F3, F4, F5, F8, F9 |
| Nov 25 | this branch | Judge docs: README, PROOF_PLAN, SUBMISSION, video kit, `make eligibility`, `make judge-ui`, pre-submit audit |

## Credits and licences (organisers' attribution rules)
- **Gloam** (MIT, © 2026 Gloam), https://github.com/gloamtrade/gloam: the shielded pool, final-ceremony verifiers,
  pay memo and SDK. A pinned submodule (commit `d8db1e6c`), unmodified, with its LICENSE kept.
- **Aevum Starter Kit** (MIT, © 2026 PQA Labs), https://github.com/qday-io/aevum-starter-kit: the repo layout,
  Makefile, Shanghai check, `packages/aevum`, the relay route shape and the gasless pattern. Adapted files carry a
  source comment, and borrowed snippets are listed in NOTICE.md.
- **Ceremony contributors:** Kene and Gunroar, with a beacon from Aevum block 3772100, on the Hermez phase 1
  (powersOfTau28_hez_final_17).
- **Fonts:** Inter Tight and JetBrains Mono, SIL Open Font License 1.1.
- **GPL-3.0 files:** `contracts/src/generated/IncomeGroth16Verifier.sol` and the throwaway test verifiers (snarkjs
  template, © 0KIMS); Gloam's `*VerifierFinal` (snarkjs); `packages/shaida-proofs/circuits/income.circom` (includes
  circomlib); snarkjs and ffjavascript in the proving and bot bundles. Headers are kept and listed per file in
  NOTICE.md.
- Shaida's own code is MIT.
