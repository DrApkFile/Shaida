# Pre-submit audit (dry run), 2026-11-25

Branch `docs/judges` from master `9aec406`. Docs and evidence only; no contract, circuit, ceremony or app change. Each
line names the command or file behind it. PASS = holds; **DISCLOSED** = does not fully hold, says why; FIXED = did not
hold and was fixed on this branch. Nothing was sent to Aevum: every chain read is an eth_call or a receipt.

## Rules and eligibility
| # | Check | Result | How / detail |
|---|---|---|---|
| R1 | Every acceptance ID has a passing test and an evidence file | **DISCLOSED** | PROOF_PLAN §5 maps all 12. A02, A08, A10 and A11 (P01) have tests; A01, A03–A07 and A11's network list are checked by `make eligibility`, not by a unit test; A09 and A12 are manual by nature. Every ID has an evidence file except A09 (a DoraHacks page) |
| R2 | `make eligibility` passes today | PASS | [eligibility.md](eligibility.md): A01–A08, A10, A11 and G1–G5 PASS; A09 and A12 MANUAL. The first run failed A06 (README not yet rewritten) and is kept: `eligibility-FAILED-1795585401234.md`. Rerun after the merge (below) |
| R3 | The deadline is 2026-12-11 08:00 UTC | PASS | briefing/EVENT.md "At a glance"; PRD §11 Dec 10 row; SUBMISSION.md top. The PRD's own target is to submit on Dec 10 |
| R4 | The commit history is honest | PASS | 109 commits at 9aec406, from 2026-11-20 04:56 +0100, all inside the window (from 2026-11-16 06:00 UTC); no forced update in origin/master's reflog; failed runs, the superseded ceremony contribution and refuted claims are committed. One feature branch (chore/gate) was rebased before its merge, which its evidence says (gate/7a354c2.md) |
| R5 | The live URL works without an invite | PASS | `make judge-ui`: a fresh headless profile with no wallet and no cookie reaches VALID, Check on-chain and the bot ([judge-ui/report-390.md](judge-ui/report-390.md)); eligibility A05 |
| R6 | Every submission field matches README and UI | PASS | SUBMISSION.md was written from README and CLAIMS; tagline set to the landing headline's wording; addresses, tx hashes, the zkey hash and the deadline compared by hand. The fields left open are listed under "Not filled" |

## Build and code
| # | Check | Result | How / detail |
|---|---|---|---|
| B1 | The gate passes from a clean clone with only the README's setup | PASS, **DISCLOSED** | `make gate` PASS at 9aec406 from a fresh clone ([gate/9aec406.md](gate/9aec406.md), 5,887 s including a system suspend). The clone was fresh, but the machine was not: Foundry, circom 2.2.3, Node 24.19.0, pnpm and gitleaks were already installed. README "Setup and commands" lists exactly those. The gate was not run on a new machine. The gate runs again on this branch before the merge (below) |
| B2 | No `any`, no empty `catch`, no `\|\| default` on values that matter | PASS, **DISCLOSED** | `tools/lint.mjs`: "TypeScript rules over 277 files (no any, no empty catch)". `\|\|`/`??` defaults: 104 sites; those on chain, key, address, amount or config values were reviewed by hand. Three defaults remain, none hides a failure: the income key setting defaults to "final" (the safe key, D21); `NEXT_PUBLIC_NETWORKS` falls back to `aevum` and drops unknown keys without saying so (`web/src/lib/env.ts`: a typo gives the production network, not a refusal); the agent card prints `chainId 0` when the bot has no network (`web/src/server/underwrite-info.ts`). Not changed here (app code) |
| B3 | Config is validated at startup | PASS, **DISCLOSED** | At server start (`web/src/instrumentation.ts`): the store choice (D29, exit 78) and the bot's settings and policy file (D30). Contract addresses are `NEXT_PUBLIC_*` build-time values, checked by zod when first read and refused as `NotConfigured`, not at process start. Render's build refuses any network but `aevum` |
| B4 | Dependencies are pinned | PASS, **DISCLOSED** | `pnpm install --frozen-lockfile` (gate step 1) installs exactly `pnpm-lock.yaml`; Gloam and circom are pinned by commit and sha256. The manifests still carry ranges: `viem ^2.57.0` (packages/aevum), `@types/* ^`, and a `ws` override. The lockfile decides; a lockfile update could move them |
| B5 | The secret scan covers code, logs and evidence | PASS | gitleaks over the whole history (gate step 8; eligibility A08: 102 commits, no leaks) scans every tracked file, including `evidence/` and `evidence/gate/*.log`. Server logs are not in the repo; tests R14 and U19c show they carry no bodies or links |
| B6 | Test counts in the docs equal the counts just observed | PASS, **DISCLOSED** | Observed: 318 tests, 317 passed, 1 skipped (RS00, needs a real Redis) ([gate/9aec406.md](gate/9aec406.md)). README now cites this file instead of a number. Older counts in DECISIONS entries (for example D19 "22" relayer tests, now 44 with D29's) are historical, as of each decision, and not current claims |

## Honesty
| # | Check | Result | How / detail |
|---|---|---|---|
| H1 | Every README, UI and submission claim is PROVEN in CLAIMS | PASS, **DISCLOSED** | `node tools/check-claims.mjs`: 46 claims, 46 PROVEN, README cites 46, every Status block marked. The UI and SUBMISSION.md are not machine-checked; they were compared by hand with CLAIMS. The landing lede is the D32 wording |
| H2 | The real / simplified / not built table is current | PASS | README "Real, simplified, not built", with ROADMAP. Added to ROADMAP: optional payer-name disclosure (PRD P1, not built) |
| H3 | Demo data is labelled | PASS | Landing "See a live proof **Demo**" plus the personas named "(demo)"; evidence headers say "Personas are demo"; the video kit captions say it |
| H4 | Evidence says what it doesn't prove | PASS | e.g. CL33 (one run, one person, screens at 1,247 px), CL43 (checked once; uptime not measured), CL45 (fakes, not Aevum), CL50 (one machine, one day) |
| H5 | Failed runs are kept | PASS | `acts-2-3-fork-FAILED-*` ×3, `acts-4-6-fork-FAILED-*`, `render-rehearsal-2026-11-22-machine-suspended.md`, the privacy fixture's runs 1–4, the superseded ceremony contribution, and `eligibility-FAILED-*` (this audit) |
| H6 | Docs match code, and every file named in the docs exists | FIXED | Every path named in README, PROOF_PLAN, SUBMISSION and docs/VIDEO exists (checked by script; the only misses were upstream-repo paths in NOTICE and URL routes). Drift fixed: LIMITS said "Proposed fixes, none applied" (F3–F9 were applied); ROADMAP still listed deploying IncomeVerifier (done, D24); NOTICE said the generated verifier existed "once the ceremony is finalized", and named `examples/`, removed in `86f27fd`; DECISIONS D32's context said "nothing below is built"; EVENT.md named evidence files that never existed (A02, A04) |

## Judge experience
| # | Check | Result | How / detail |
|---|---|---|---|
| J1 | The verify commands work when pasted | PASS | README's bash block extracted and run in `env -i HOME=… PATH=/usr/bin:~/.foundry/bin bash --noprofile --norc`: health `{"ok":true,"commit":"9aec406…","networks":[{"key":"aevum","chainId":44005}],"store":"redis"}`; both zkey hashes `cbcb06fecdf72b47bb7d45d4403eaf69cf78bee65ad41cd50d0c98f4609cc0a5`; `cast call … check` → `true`; edited threshold → `execution reverted: ProofInvalid` (data `0x7fcdd1f4`). cast names the error from a public signature list; offline it would print only the data |
| J2 | The live guards return the documented codes | PASS | G1–G8 in `make judge-ui` and `make eligibility`; the README's console snippet pasted into the page → ProofInvalid. G9: `POST /api/relay/sweep {"to":…,"data":…}` → HTTP 400 `InputRejected` "Nothing was sent". G10: a 20,000-byte body to `/api/underwrite` → HTTP 413 |
| J3 | The UI works at 390 px, including the empty, error and stale states | PASS, **DISCLOSED** | [judge-ui/report-390.md](judge-ui/report-390.md): 13 screens, horizontal overflow 0 px on each: landing, VALID + on-chain, four refusals, malformed link (error), UnknownRoot (INCONCLUSIVE, "try again in a minute": the stale/resync state), /v with no proof (empty), fresh dashboard (counts "—", vault locked), the bot's three answers. Not shown live: `TxOutcomeUnknown` (it needs a sent transaction; shown on the fork, R12 and `acts-4-6-fork-FAILED-*`) and ProofExpired (shown on the fork with the clock moved) |

## Not filled in SUBMISSION.md
- The DoraHacks handle of the team member (A09).
- The video link (the script is in docs/VIDEO.md).

## Merge and deploy
- `make gate` on `docs/judges` at `495ebf1`: **PASS** from a fresh clone in 665 s (steps 1–8; the same 318 tests,
  317 passed, 1 skipped RS00). Claims check: 46 claims, 46 PROVEN.
- Merged to master as `a756f94` (no-ff) and pushed. Render redeployed; the live `/api/health` reported
  `"commit":"a756f94cfd12141220f39d9f7fccf4a3cdf1eb3e"`, chain 44005, store redis, at 2026-11-25T07:49:28Z.
- `make eligibility` rerun against that deployment: [eligibility.md](eligibility.md) (A05 compares the live commit with
  origin/master).
