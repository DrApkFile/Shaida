# Recording run sheet: the 2:20 video

For the builder, on the day of recording. The script is [VIDEO.md](VIDEO.md); this sheet is the order of work around it.
Written 2026-11-27 against the live site at `7c9ecad` (`/api/health` → `"commit":"7c9ecad…"`, store `redis`,
network `aevum` 44005). Personas are demo. The video sends one transaction per take: the relayer's `revoke` (act 5b).

## 1. Does VIDEO.md match the live site? (checked 2026-11-27)
Checked against the source at `7c9ecad` (the live build), the chain and the live bot. Read-only: nothing was sent.

| Item | Result |
|---|---|
| Live commit | `7c9ecad`, the same as `HEAD` |
| Run 2's vouched pay `0x98c64110…` and sweep `0x754f9029…` | both status 1, **0 tUSD8 logs** in either receipt (act 2's "no tUSD8 moves" holds); the explorer page loads |
| Template "Income, for a landlord" | the label is the same, and the template is the default |
| Reader-code hint, "Code-protected" | same, on `/app/prove`, on `/v` ("This link says: Code-protected") and on Link ready |
| Revoke flow | Revoke → confirm → "Revoke it" → "Revoking…" → "Revoked in block N": same |
| REVOKED on `/v` | same, with "Revoked on chain in block N, <date> your time" |
| Bot sample, asked live with recording off | rent-check **APPROVE** (`a63582509992a400…`), revenue-credit **DECLINE** with BelowMinThreshold, TooFewPayments, PeriodTooShort (`1bcd953eed6a1ec1…`): the same ids as on record |
| `ceremony/TRANSCRIPT.md`, `evidence/privacy-audit.md` on GitHub | both 200; the transcript names Kene and Gunroar |

**What I changed in VIDEO.md** (four things, the rest stands):
1. **Act 4, button names.** There is no "Prove" button. It is **Build proof link**. While it works, the button reads
   "Building…" and the line under the bar reads "Step 3 of 3: Proving 1 of 1 (in its own worker)". The result card is
   "Link ready", with a row "Proving N s in this browser". Proving took 21.3 s on 26 Nov, so "15–20 s" is now "about
   20 s". The period is now "From and To both 23 Nov 2026": the From field defaults to your first countable payment.
2. **Act 5b, the code goes back in before REVOKED.** `/v` checks the reader before it checks revocation
   (`packages/shaida-proofs/src/verify/verify.ts`: WrongReader at l.140, ProofRevoked at l.148). Act 5 ends with the
   code cleared, so pressing Verify there would show **WrongReader**, not REVOKED. Put the code back in off camera
   first.
3. **Act 6, the number of reasons depends on the date.** "Three reasons" holds only until 7 Dec (see §2).
4. **Shot list, ready states.** On `/app/prove` the loading text is "Syncing the ledger and opening your payments…",
   and "Reading the ledger…" is `/v`'s Verify button. Bola's reader-code card must be hidden before recording.

## 2. Dates that matter (today is 2026-11-27)
| When (UTC) | What changes | What to do |
|---|---|---|
| **7 Dec 19:53** | revenue-credit's DECLINE gains a 4th reason, ProofTooOld: the sample's ledger state (23 Nov 19:53) is then older than 14 days | **Record act 6 before this**, or say "decline, with every reason" (still true) and caption the count |
| 10 Dec 23:00 | a 5th reason, ExpiresTooSoon: less than 14 days left on the sample | — |
| **11 Dec 08:00** | submission deadline (SUBMISSION.md) | video uploaded and linked before this |
| 15 Dec 06:00 | Demo Day, a live 3–5 min call with no pre-recorded video (briefing/EVENT.md) | see §3 |
| 17 Dec 23:00 | rent-check's APPROVE becomes DECLINE (ExpiresTooSoon, 7 days left), as the README says | — |
| 22 Dec 10:51 | the landing page's example link (run 1) expires; its note says "It expires 22 Dec 2026" | acts 1 and 8 show the landing page only, so they are not affected before this |
| 23 Dec 19:53 | rent-check would also fail ProofTooOld (30 days) | — |
| record day + 30 | the new link's default expiry, 23:59:59 UTC | leave the default |

The best window is **now until 7 Dec**. All the script's wording holds then.

## 3. Budget (read-only, Aevum block 4,215,999, 2026-11-27 ~00:25 UTC)
| Account | tQDAY | tUSD8 | Floor | Headroom |
|---|---:|---:|---|---|
| relayer `0xF494…1422` (nonce 24) | 0.020035338 | 0 | refuses to send below **0.01** (`minBalanceWei`) | 0.010035338 |
| deployer `0x5f80…9698` (nonce 30) | 0.924300969 | 4 | ≥ 0.5 tQDAY, ≥ 2 tUSD8 (evidence/budget.md) | 0.4243 tQDAY, 2 tUSD8 |
| reader (Bola) `0xbed9…785E` | 0.000362935 | 0 | 0.00042 up front for an attest | **cannot pay for "Record check"** (not in the video) |
| bot `0x5B14…EE2C` | 0.001032947 | 0 | 0.00042 up front per attest | 2 recorded decisions (the video records none) |

Gas price 1 gwei; tUSD8 not paused. The relayer's nonce and balance are unchanged since the 26 Nov revoke.

**Does a recording run fit?** Yes. One take is one revoke: 77,796 gas used, about 0.0000778 tQDAY, with a 101,134
gas limit held up front. The headroom covers about **129 revokes**. A day of 5 takes plus 1 rehearsal costs about
0.00047 tQDAY and leaves the relayer at about 0.01957. The relayer's daily budget (30M gas on Render) is not touched.
No top-up is needed for the video.

**Top-up before Demo Day.** That depends on what you show live:
- **Revoke only** (prove, verify, revoke, as in the video): **no top-up**. About 0.0196 tQDAY covers 120 or more.
- **A full live run** (pay, vouch, sweep, prove, revoke): by the budget rule (planned need × 1.5, plus the 0.01 floor
  that is never spent), the target is (17,874,084 run maxima + 101,134 revoke) × 1.5 = 0.026962827, plus 0.01, which
  gives **0.036962827 tQDAY**. After the video the relayer will hold about 0.0196, so top it up by about
  **0.0174 tQDAY**: the target minus a fresh balance read on the day. The deployer stays at about 0.907 (≥ 0.5). The
  run needs tUSD8 from the deployer: at most 2 before it reaches its floor of 2. Run 2 used 1.
- A live "Record check" also needs the reader topped up by about 0.000267 tQDAY (to 0.00063, as F2 did).
- Don't do a full rehearsal on the hosted relayer on Demo Day's UTC day: two runs (about 36M) are more than the 30M
  daily budget. Rehearse on the fork (`make fork`).

Each take's revoke is a real relayer tx. After recording, add them to `evidence/budget.md` (failed takes too).

## 4. Before you press record
**Profiles and wallets.** No shot needs a wallet; the relayer pays the revoke.
| Window | Firefox profile | Wallet | Size |
|---|---|---|---|
| A, "clean" | a fresh profile | none | 1366 full screen, zoom 110–125 % |
| B, Ada (demo) | the builder's normal profile, vault restored from `ada-after-batch.vault.json` (run 2) and **unlocked off camera** | none | Responsive Design Mode 390 × 844 |
| C, Bola (demo) | `shaida-acme-bola` | MetaMask present, **locked** | Responsive Design Mode 390 × 844 |

**Tabs, in order.**
| Window | Tab | URL |
|---|---|---|
| A | 1 | https://shaida.onrender.com (scrolled to the top; used again for the close) |
| A | 2 | https://explorer-test.qday.info/address/0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698 (the deployer's public tx list, act 1) |
| A | 3 | https://explorer-test.qday.info/tx/0x98c64110aec9049f1745dd8564c7c5418c0aaf6dd6a0d184517cc4d16f68e27a |
| A | 4 | https://explorer-test.qday.info/tx/0x754f902959ee96cc563d883edec0eeb2f89046402dddb1326396d755b8564dfa |
| A | 5 | the bot sample, README step 5 (`/underwrite?preset=rent-check#eyJ2…`), loaded, **not asked**, "record" left off |
| A | 6 | https://github.com/DrApkFile/Shaida/blob/master/ceremony/TRANSCRIPT.md, scrolled to the contribution table |
| A | 7 | https://github.com/DrApkFile/Shaida/blob/master/evidence/privacy-audit.md |
| B | 1 | `/app/inbox`: run 2's three payments read "swept: yours alone" |
| B | 2 | `/app/prove`: "Payments a proof can count" shows; form filled except the code (see S6) |
| B | 3 | `/app/shared`: reload it after the link is built; the new link is at the top |
| C | 1 | `/v`: the reader-code card hidden ("Done, hide it") |
| C | 2 | opened at S8: Ada's new link |

**Ready checks.**
- [ ] 10 min before: open https://shaida.onrender.com/api/health. It should show `ok: true` and `7c9ecad`.
- [ ] Same day: `make judge-ui` passes (read-only).
- [ ] Bola's code: made at C1 with OBS **not recording**, pasted into B2's code field, then "Done, hide it". Keep it
      in your password manager for re-entry, never in an open text file. Copy something else afterwards so no
      clipboard history shows it.
- [ ] Each take needs a new link: a revoked link stays revoked. The same code works for every take.
- [ ] GNOME Do Not Disturb on, bookmarks bar hidden, every terminal, editor, file manager, `DEPLOY_RENDER.md`,
      the Render and Upstash dashboards, keystore folders and the vault backup closed. OBS window capture only.
- [ ] Ada's inbox: if it also lists run 1's payments (22 Nov), frame on run 2's three (23 Nov: 0.5 / 0.3 / 0.2).

## 5. Shot by shot
🔒 = Bola's reader code could appear. Pause OBS while it is typed or pasted, and blur the code field in the edit
whenever it is in frame (a fixed rectangle: at 390 px the field doesn't move unless you scroll).

| # | Time | Window/tab | Click | Say (VIDEO.md) | Must be visible |
|---|---|---|---|---|---|
| S1 | 0:00–0:07 | A1 | nothing | "Freelancers paid in stablecoins can't prove income without handing over their whole wallet:" | the headline |
| S2 | 0:07–0:15 | A2 | scroll the tx list slowly | "every payment, every client, every balance. Screenshots prove nothing." | a full public tx history |
| S3 | 0:15–0:35 | A3 | zoom on the empty token-transfer section, then the input data | "Acme Studio, a registered payer, … public, by design." | no tUSD8 transfer; the calldata; caption "Recorded state from live run 2, 23 Nov 2026" |
| S4 | 0:35–0:44 | B1 | nothing | "Ada sweeps each payment into a note only she can open." | three payments, "swept: yours alone" |
| S5 | 0:44–0:50 | A4 | nothing | "Only swept payments count, so Acme can't claw one back and still have it counted." | the sweep tx, status success |
| S6 🔒 | 0:50–1:01 | B2 | show the filled form: Income, for a landlord; From/To 23 Nov 2026; at least 1; reader "Landlord Bola"; code (pasted with OBS paused); press **Build proof link** | "She proves at least one tUSD8 from three vouched payments, for Landlord Bola and the code he gave her, until a set date." | the "Code-protected" hint; **the code field blurred** |
| S7 | 1:01–1:03 | B2 | nothing; **cut** | "The proof is made here, in the browser," | "Building…", "Step 3 of 3: Proving 1 of 1" |
| S8 🔒 | 1:03–1:15 | B2 | scroll to Link ready, keeping the code field out of frame; **Copy link** | "with keys from a two-person ceremony. It never touches our server." | Link ready, Protection Code-protected, Revocable Yes, "Proving N s in this browser"; caption "Cut: proving took N s" |
| S9 🔒 | 1:15–1:26 | C2 | (paste the link into C2's URL bar off camera) type "Landlord Bola"; enter the code with OBS paused; **Verify** | "Bola opens the link and types his name and code. Valid: at least one tUSD8, three payments, the dates, the expiry." | "This link says: Code-protected"; VALID; **the code field blurred** |
| S10 🔒 | 1:26–1:33 | C2 | **Check on-chain** | "The on-chain check agrees." | "IncomeVerifier.check passed for 1 proof at block N. Nothing was sent." Don't tick the consent box |
| S11 🔒 | 1:33–1:40 | C2 | clear the code (blurred; or pause, clear, resume); **Verify** | "With his name alone, it's refused: wrong reader." | WrongReader, "This link is code-protected: it needs your name and the reader code…" |
| S12 | 1:40–1:46 | B3 | **Revoke** → **Revoke it** | "Ada can take it back. One click," | the confirm text, "Revoking…", then "Revoked in block N" (cut the wait if long; caption "Cut: the revoke took N s") |
| S13 🔒 | 1:46–1:50 | C2 | with OBS paused, put the code back; resume; **Verify** | "and Bola's page says revoked." | **REVOKED**, "Revoked on chain in block N" (the same N as S12); the code field blurred |
| S14 | 1:50–1:58 | A5 | **Ask the bot** | "Or ask our underwriting bot. No AI: fixed, published rules. Rent check: approve." | APPROVE, policy rent-check |
| S15 | 1:58–2:05 | A5 | pick revenue-credit; **Ask the bot** | "Business credit: decline, with every reason." | DECLINE with 3 reasons (before 7 Dec) |
| S16 | 2:05–2:10 | A6 | scroll to the table | "The keys come from a public ceremony." | Kene, Gunroar, the beacon |
| S17 | 2:10–2:15 | A7 | nothing | "And we attacked our own deployment, and published exactly what it leaks." | the audit's headline |
| S18 | 2:15–2:20 | A1 | nothing | "Shaida. Get paid privately, prove you earn enough. shaida dot onrender dot com." | the URL bar |

Caption "Demo personas · Aevum testnet 44005" runs from 0:15 to 2:05. Ada's Shared proofs page (S12) shows no code. It
shows "Code-protected" and the older, already revoked link from 26 Nov lower in the list. After recording, check every
🔒 shot at 1× speed for a readable code, and the whole file at 2× for anything that isn't the browser.

## 6. If something breaks mid-take
- **Render cold start** (a blank page, 502, or a minute's spinner): stop the take, open `/api/health`, wait until it
  answers, then reload. Re-take only that act. Your earlier acts are separate clips.
- **RPC slow** ("Reading the ledger…" or "Syncing the ledger…" stays; "Ledger unavailable" / RangeUnresolvable): the
  trees refetch every 15 s, so wait 30 s, then reload once. Meanwhile record the acts that don't need the chain
  (S1, S16–S18).
- **Explorer slow or down**: record S3/S5 later; the tx pages don't change.
- **Proof takes longer** than usual: it's behind the cut anyway. Close other tabs and stay on mains power. The caption
  uses whatever number the page shows. If an error box appears, read its code, then press Build proof link again. No
  transaction was sent.
- **Revoke slow**: cut the wait and caption it. If the page says "**Revoke: outcome unknown**", don't press anything
  again. The page checks on its own, and UNKNOWN is never resent. Look up the relayer's latest tx on the explorer
  (`0xF4945dD5…01422`) before deciding the take is lost.
- **Revoke refused** (relayer low on balance, or its budget is used up): stop recording, read the balance, and decide
  on a top-up (§3). Don't record around it.
- **WrongReader at S9**: the code was mistyped. Pause, paste it again from the password manager, then re-take S9.
- **Bot INCONCLUSIVE**: ask again. It isn't cached.
- **Firefox or OBS crash**: MKV keeps what was recorded. Restart, unlock Ada's vault off camera, resume at the act.
