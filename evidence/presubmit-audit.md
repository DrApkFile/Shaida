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
| B2 | No `any`, no empty `catch`, no `\|\| default` on values that matter | FIXED (fix/audit-defaults) | `tools/lint.mjs`: no any, no empty catch. Of the three defaults found: `NEXT_PUBLIC_NETWORKS` now has no default, and an unset, unknown or repeated key is the named refusal `WebConfigError` at build (`next.config.ts`) and at server start (`web/src/startup.node.ts`, exit 78); tests W10–W12; a build with `aevun` stopped with `NEXT_PUBLIC_NETWORKS has unknown network(s) "aevun"`. The agent card no longer prints `chainId 0`: without a network it says `configured: false` and `NotConfigured` (test U19f). The income key still defaults to "final", now documented in CLAUDE.md as a deliberate safe default (test P01) |
| B3 | Config is validated at startup | FIXED (fix/audit-defaults) | `checkWebConfig` (`web/src/lib/web-config.ts`) validates `NEXT_PUBLIC_NETWORKS` and the contract addresses of every listed network (strict schema, 20-byte addresses, deploy block) as a whole, listing every problem: at build in `next.config.ts` and at server start in `instrumentation.ts`, before the store and bot checks. Tests W13–W15. A first-use refusal (`NotConfigured`) remains only for networks that are not listed |
| B4 | Dependencies are pinned | FIXED (fix/audit-defaults) | Every runtime specifier is exact: `viem 2.57.12` in packages/aevum (was `^2.57.0`), the `ws` override `8.21.3` (was `^8.21.0`; pinned to the newest locked version so nothing moved back). `@types/*` stay ranges (dev only). `pnpm install --frozen-lockfile` passes on the updated lockfile (9 lines changed: specifiers only) |
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

## Follow-up (2026-11-25, branch fix/audit-defaults)
B2, B3 and B4 were fixed after this audit's first pass (rows above). docs/VIDEO.md: the 0:15 line now says "a shielded
pool on QDay's Aevum testnet", and OBS outputs 1280 × 720 for the 1366 × 768 screen.

Measured on this laptop, 2026-11-25 (Next.js 16.4.6):
- `NEXT_PUBLIC_NETWORKS=aevun next build` stops before compiling: `Error [WebConfigError]: WebConfigError: NEXT_PUBLIC_NETWORKS has unknown network(s) "aevun": allowed aevum, fork, local`, exit 1.
- `NEXT_PUBLIC_NETWORKS=aevum` + the 44005 contracts: the first `pnpm build` was cut off by my own 20-minute `timeout`
  during "Running TypeScript" (exit 124, after "Compiled successfully in 16.5min" under memory pressure; not a pass).
  The rerun finished: "Compiled successfully in 4.7min", exit 0.
- `next start` on that build logs `[startup] networks: aevum; contracts valid for each` before the store check (which
  then stops it here, since no Redis is configured locally: StoreNotConfigured, as designed). It logs the same with
  `NEXT_PUBLIC_NETWORKS` and the contracts removed from its environment: `NEXT_PUBLIC_*` are inlined at build, so the
  server checks the values it was built with. `next.config.ts` therefore refuses at `next build` and `next dev` only
  (a first version also checked the runtime env at `next start`, which would have stopped `tools/render-rehearsal.sh`,
  whose `env -i` start carries no `NEXT_PUBLIC_*`).
- CI's web job builds with `NEXT_PUBLIC_NETWORKS=aevum` only; it now also exports the public 44005 addresses from
  `deployments/aevum.json` (`tools/write-web-env.mjs --print`), as Render's dashboard does.

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
