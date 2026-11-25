# Demo video kit (2:20)

For the builder, who records it. Everything shown is the live site on Aevum testnet 44005, or the explorer. Personas
are demo, and the captions say so. Nothing in the video needs a new transaction: payments and sweeps are shown from
live run 2 (23 Nov 2026), and the proof is made live in the browser, which sends nothing.

Pace: about 2.3 spoken words a second. Each line below fits its slot with a breath to spare. Total: **140 s**.

## Script, timed to the second

| Time | Act | On screen | Voice-over | Source |
|---|---|---|---|---|
| 0:00–0:15 | 1 The problem | Landing page `/`, the headline; then a wallet's full history on the explorer (Ada's address page is not used: use the deployer's public tx list) | "Freelancers paid in stablecoins can't prove income without handing over their whole wallet: every payment, every client, every balance. Screenshots prove nothing." (26 words) | live |
| 0:15–0:40 | 2 Ada is paid privately | Explorer: run 2's vouched pay [`0x98c64110…`](https://explorer-test.qday.info/tx/0x98c64110aec9049f1745dd8564c7c5418c0aaf6dd6a0d184517cc4d16f68e27a): no tUSD8 moves in it, the input is a proof; zoom on the empty token-transfer section and the calldata | "Acme Studio, a registered payer, paid Ada three times through a shielded pool on QDay's Aevum testnet. On the explorer there's no amount and no recipient. Which registered payer paid is public, by design. The first deposit was gasless: one signature." (42 words) | **pre-recorded state** (run 2's txs) |
| 0:40–0:55 | 3 Sweep | Ada's `/app/inbox` (her Firefox profile): three payments, "swept: yours alone"; cut-in of the sweep tx on the explorer | "Ada sweeps each payment into a note only she can open. Only swept payments count, so Acme can't claw one back and still have it counted." (27 words) | **pre-loaded state** (run 2's sweeps; the inbox shows them swept) |
| 0:55–1:20 | 4 Prove in the browser | `/app/prove`: template "Income, for a landlord", period 23 Nov 2026, at least 1 tUSD8, reader "Landlord Bola"; press Prove; **cut** after 2 s of "Proving…"; resume on the finished link with its proving time | "She proves at least one tUSD8 from three vouched payments, for one reader, Landlord Bola, until a set date. The proof is made here, in the browser, with keys from a two-person ceremony. It never touches our server." (38 words) | live, **with a cut** over the 15–20 s of proving (keep the page's own timer visible after the cut) |
| 1:20–1:45 | 5 Bola sees VALID, one attack refused | Bola's profile: open the link, type "Landlord Bola", Verify → VALID; Check on-chain → passed; change the name to "Tenant Chidi" → WrongReader | "Bola opens the link and types his name. Valid: at least one tUSD8, three payments, the dates, the expiry. The on-chain check agrees. Send the same link to someone else, and it's refused: wrong reader." (36 words) | live |
| 1:45–2:05 | 6 The bot | `/underwrite?preset=rent-check#…` (the README's sample link) → Ask the bot → APPROVE; switch to revenue-credit → DECLINE with three reasons | "Landlords and lenders can ask our underwriting bot. No AI: fixed, published rules. Rent check: approve. Business credit: decline, with every reason listed." (24 words) | live (the sample's APPROVE holds until about 17 Dec 23:00 UTC) |
| 2:05–2:15 | 7 Trust | `ceremony/TRANSCRIPT.md` on GitHub (Kene, Gunroar, beacon block), then `evidence/privacy-audit.md` headline | "The keys come from a public ceremony. And we attacked our own deployment, and published exactly what it leaks." (19 words) | GitHub |
| 2:15–2:20 | 8 Close | Landing page, URL in view | "Shaida. Get paid privately, prove you earn enough. shaida dot onrender dot com." (12 words) | live |

Captions to burn in or overlay (small, bottom left): "Demo personas · Aevum testnet 44005" for 0:15–2:05, "Recorded state from live run 2, 23 Nov 2026" for
0:15–0:55, and "Cut: proving took N s" at 1:08 with the number the page shows.

What not to say: "nothing else is revealed", or anything that implies the reader is authenticated. The reader learns
the payer of each payment and its timing (README "Privacy").

## Shot list and pre-loading
| Shot | Browser and profile | Width | Pre-load before recording |
|---|---|---|---|
| 1, 8 | Firefox, a clean profile (no wallet) | 1366 (full screen) | `https://shaida.onrender.com` loaded and scrolled to the top |
| 2, 3b | same clean profile | 1366 | explorer tabs for run 2's vouched pay `0x98c64110…` and sweep `0x754f9029…` |
| 3, 4 | Firefox, **Ada's profile** (vault restored from the run-2 backup; unlocked off camera) | 390 (Responsive Design Mode, 390 × 844) or 1366 | `/app/inbox` and `/app/prove` loaded, the vault unlocked, the index synced (the button reads "Prove", not "Reading the ledger…") |
| 5 | Firefox, **Bola's profile** (`shaida-acme-bola`; MetaMask locked, not needed) | 390 | the link from shot 4, copied; `/v` open in a tab |
| 6 | clean profile | 1366 | the bot sample URL from the README, loaded, not yet asked |
| 7 | clean profile | 1366 | GitHub tabs: `ceremony/TRANSCRIPT.md`, `evidence/privacy-audit.md` |

Warm the site 10 minutes before (open `/api/health`): Render's free plan can take about a minute to wake up.
Rehearse once with `make judge-ui` the same day; it must pass.

## Recording on this machine (Arch, GNOME on Wayland, 1366 × 768 screen)
- **Recorder: OBS Studio** (installed: `obs`, 32.2.2). `wf-recorder` does not work on GNOME (it needs wlroots).
  GNOME's own recorder (Ctrl+Shift+Alt+R) records no microphone.
- OBS setup: Sources → **Screen Capture (PipeWire)**, and pick the monitor; or a window capture of only the browser.
  Settings → Video: base canvas **1366 × 768**, output **1280 × 720**, Lanczos scaling, 30 fps. 720p is a slight
  downscale of this screen (no upscaling blur) and the same 16:9 shape. Zoom Firefox to 110–125 % for the desktop
  shots so text stays readable at 720p.
  Settings → Output: Recording format **MKV** (safe if OBS crashes), then File → Remux to MP4; encoder x264, CRF 20.
- Audio: Sources → **Audio Input Capture (PulseAudio)**, your mic. Mute "Desktop Audio". Speak at a normal level: the
  mixer meter should peak in the yellow, around −12 to −6 dB, and never touch red. Add filters: Noise Suppression
  (RNNoise), then a Limiter at −1 dB.
- Record each act as its own clip, then join them in any editor (Kdenlive or Shotcut: `sudo pacman -S kdenlive`).
  That makes the proving cut clean and lets you re-take one act.

## Keeping keys and passwords off screen
- Never show a terminal. The video needs none; act 7 is GitHub in the browser.
- Before recording: close every terminal, editor and file manager. Close `DEPLOY_RENDER.md` and the Render and Upstash
  dashboards (environment variables). Close any keystore folder and the vault backup file.
- Unlock Ada's vault **before** you start recording, or pause OBS while typing the passphrase. MetaMask stays locked:
  no shot needs it.
- Use the OBS **window capture** of the browser rather than the full screen, so notifications and other windows never
  appear. Turn on GNOME's Do Not Disturb.
- Hide the bookmarks bar, and check the tab titles in shot: none should name a dashboard or a private document.
- After recording, scrub the final file at 2× speed for anything that is not the browser.
