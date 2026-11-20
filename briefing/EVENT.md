# EVENT: Aevum Builder Challenge #1 (QDay / PQA Labs, on DoraHacks)

Researched: 2026-11-20
Sources fetched or read:
- qday.io/builder-challenge (landing page + FAQ; user-supplied text and WebFetch)
- dorahacks.io/hackathon/qday/detail (user-supplied text; direct fetch blocked here)
- aevum-starter-kit.vercel.app/docs and github.com/qday-io/aevum-starter-kit (cloned, commit log read to 2026-11-20)

## At a glance
| Item | Detail |
|---|---|
| Build window | 2026-11-16 06:00 UTC → 2026-12-11 08:00 UTC |
| Deadline | **2026-12-11 08:00 UTC = 09:00 Lagos (UTC+1)**. Late submissions not accepted. |
| Judging | 2026-12-12 to 12-14 |
| Demo Day | 2026-12-15 06:00 UTC (07:00 Lagos). Top 5, 3–5 min **live** call. No pre-recorded video. At least one member attends. |
| Prizes | $1,500 USDT: $800 / $500 / $200. One pool, not per track. Eligibility checks apply. |
| Team | Solo (decided) |
| Field size | Unknown. ~20 public repos found by 2026-11-20 (see LANDSCAPE.md). |
| Extra | Fast track into QDay mainnet builder program |

## Scoring
Weights from the qday.io landing page (out of 100). Sub-criteria from DoraHacks. The starter kit says the DoraHacks page takes precedence; DoraHacks lists an 8th criterion (ecosystem contribution) with no weight. **Open question: which weights apply.**

| Criterion | Max | What full marks looks like (paraphrased) | Our planned proof |
|---|---|---|---|
| Innovation and originality | **20** | Non-derivative; novel agentic payment primitives or on-chain business models | Vouched income-total proof: absent from Gloam and all found entrants |
| User experience and presentation | 15 | First-time users finish fast; clear status; plain-language errors; desktop and mobile | Three screens (pay, prove, verify); named refusals |
| Technical quality and platform integration | 15 | Native tooling (smart accounts, session keys, limits, identity); retries, async confirmations, tests | EIP-3009 gasless deposit; on-chain proof check on Aevum; 1,000-block log chunking; circuit + contract tests |
| Real-world utility | 15 | Real audience with demand; business model; path to mainnet | Freelancer income in Nigeria; verifier fees; two more niche templates |
| Safety, trust and controls | 15 | Least privilege, expiry, caps; review/approval; revocation; privacy; on-chain audit trail | Reader-bound, expiring proofs; payer revocation in registry; adversarial test set |
| Demo | 10 | Reproducible walkthrough with tx hashes and explorer links; edge cases | Live judge path with tamper attempts that fail |
| Documentation | 10 | README with flowcharts, env vars, testnet addresses, reproduction steps, integration detail | README + ARCHITECTURE + LIMITS |
| Ecosystem contribution (DoraHacks only, unweighted) | — | Reusable, licensed SDKs or components | `@shaida/proofs` package: circuit, verifier, TS client |

Heaviest item: Innovation (20).
Fatal gates:
- Activity must be on Aevum Testnet. Settling only on another chain (e.g. x402 on Base) does not count.
- Core building during the window. Adding tUSD8 to an existing product, or submitting one unchanged, does not count.

## Eligibility gates (acceptance IDs)
| ID | Requirement | How we verify | Evidence file |
|---|---|---|---|
| A01 | Public GitHub repo, permissive license (MIT/Apache-2.0) | LICENSE present; repo public | repo root |
| A02 | Contracts deployed on chain 44005, explorer links | `deployments/aevum.json` + script that reads code at each address | evidence/A02-deployments.md |
| A03 | Link to exact deployed commit | deploy script writes git SHA into deployments file | deployments/aevum.json |
| A04 | Tx hashes showing the app working | demo run log with explorer links | evidence/A04-demo-run.md |
| A05 | Live demo, works without login | deployed URL; clean-browser check | evidence/A05-live.md |
| A06 | Docs: problem, architecture, workflows, technologies | README sections | README.md |
| A07 | Credit reused code; NOTICE for third-party deps | NOTICE.md lists Gloam (MIT) and others | NOTICE.md |
| A08 | No private keys, .env or API keys in repo or history | gitleaks in CI | CI log |
| A09 | Team member registered on DoraHacks | manual | — |
| A10 | Uses tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` | constant checked against chain in a fork test | test |
| A11 | All settlement on Aevum | no other-chain RPC in prod config; test asserts chainId 44005 | test |
| A12 | No malicious code / no attacks on platform or participants | review | — |

## Track chosen and why
Tracks are suggestions on qday.io; there is one prize pool. We sit across **Decentralized Payments** and **Confirmation of Payee** (payer vouching). Nobody found so far builds private, vouched income proofs.

## Stack, hosting and "real work" rules
- Any contract model, any EVM tooling. Demo can be one app or API + testnet interaction.
- Boilerplate, scaffolding, standard libraries and templates allowed if licensed; credit required.
- Contract verification on the explorer does not work yet; share addresses + commit hashes.
- Help: QDay Discord, Mon–Fri 10:00–18:00 HKT (03:00–11:00 Lagos).

## What judges read, in order (assumed; unconfirmed)
DoraHacks BUIDL page → README → live demo → explorer links → (top 5) live call.

## Rules on commits, history, prior work, updates during judging
- No stated rule on commits during judging. **Assume none after 2026-12-11 08:00 UTC.**
- Prior work: libraries allowed with credit; "core building" must be in the window. Our reuse: Gloam SDK and contracts (MIT) as a pinned dependency, declared in NOTICE.md.

## Organiser answers (QDay Discord, 2026-11-20)
Q1 (reusing the Gloam SDK/contracts): answered with attribution rules, so reuse is permitted when credited. Paraphrased:
- Keep the original copyright notices and licence headers in any file you copy.
- Put a short comment directly above each borrowed snippet naming the source repo, author and licence.
- List third-party dependencies and their licences in README.md or a separate NOTICE file.
- If you copy whole directories or libraries, keep their original LICENSE file inside that folder.

How Shaida complies (acceptance A07):
- Depend on Gloam through a pinned git submodule or npm package rather than copying, so its LICENSE stays intact.
- Any Gloam contracts vendored into `contracts/lib/gloam/` keep Gloam's LICENSE in that folder.
- Code adapted from the Aevum Starter Kit (MIT, © 2026 PQA Labs) keeps the SPDX header and gets a source comment. README says "Based in part on Aevum Starter Kit (MIT, PQA Labs)".
- NOTICE.md lists: Aevum Starter Kit, Gloam (MIT), circomlib (GPL-3.0, used for circuit templates; check licence implications before vendoring), snarkjs (GPL-3.0, used as a tool/dependency), forge-std, viem, wagmi, Next.js and the rest of the dependency tree (`pnpm licenses list`).

### Licence mix (checked 2026-11-20)
- snarkjs-generated verifier contracts carry `SPDX-License-Identifier: GPL-3.0`, © 2021 0KIMS association. circomlib (`poseidon`, `comparators`, `bitify`) is GPL-3.0. Gloam ships the same mix: an MIT repo with GPL-3.0 verifier files.
- Plan: the repo is MIT for Shaida's own code. Generated verifiers and any circuit file including circomlib keep GPL-3.0 headers. NOTICE.md lists them per file. This is a per-file licence mix, not a relicensing. Not legal advice; if judges ask, point to NOTICE.md.

## Open questions for organisers (still open)
2. Which weights apply: the qday.io 7-criterion /100, or DoraHacks' 8 criteria?
3. Are commits allowed during judging (bug fixes only)?
4. Is the Discord faucet the only tUSD8 source for new addresses? (5 tUSD8 once per account per address.)
