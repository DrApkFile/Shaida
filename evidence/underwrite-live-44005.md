# Underwriting bot, live check on Aevum testnet (44005), 2026-11-23/24

The hosted site at https://shaida.onrender.com, commit `c959b34` (from `/api/health`). Personas and the bot are demo.
Steps 1–3 ran with recording **off** (`/api/underwrite`: `enabled: false`; the bot's nonce was still 0 afterwards).
Step 4 ran after the builder set `UNDERWRITE_RECORD=on` on Render. Transactions: the bot's funding (B1) and its one
attest (B2), both in [budget.md](budget.md).

## What the builder did (by hand, Firefox, Ada's profile)
1. `/app/prove`, template **Revenue proof, for a lender**, reader **Shaida underwriting bot (demo)** (the template's
   suggestion), period 23 Nov 2026 (live run 2's three payments of 0.5 + 0.3 + 0.2 tUSD8), at least 1 tUSD8, default
   30-day expiry. Built in the browser in **22.6 s** (one proof), checked VALID there →
   [01-prove-link-ready.png](underwrite-live-44005/01-prove-link-ready.png). The link is a `/v?for=merchant#…` link
   ([run.json](underwrite-live-44005/run.json)).
2. `/underwrite`, preset **rent-check@1**, Ask the bot → **APPROVE**: at least 1 tUSD8, 3 payments, 23 Nov (1 day),
   ledger state 0.2 days old, 31.0 days left; decision `a63582509992a400…`, proof `cfe42cd6dff155f4…`, evaluated
   2026-11-23T23:35:17Z → [02-bot-rent-check-approve.png](underwrite-live-44005/02-bot-rent-check-approve.png).
3. Same link, preset **revenue-credit@1** → **DECLINE**: BelowMinThreshold (1 < 10 tUSD8), TooFewPayments (3 < 6),
   PeriodTooShort (1 < 28 days); decision `1bcd953eed6a1ec1…`, same proof id, 23:36:19Z →
   [03-bot-revenue-credit-decline.png](underwrite-live-44005/03-bot-revenue-credit-decline.png).

The two bot screenshots were taken at desktop width, not at 390 px (the page at 390 px is in
[underwrite-ui/](underwrite-ui/report-390.md)).

## Checked by the agent afterwards (read-only)
- The CLI on this machine (`pnpm --filter @shaida/underwrite decide`), which trusts only the RPC
  (https://rpc-test.qday.info) and checks the server's index snapshot itself: rent-check@1 **APPROVE**
  `a63582509992a400…`, revenue-credit@1 **DECLINE** (the same three codes) `1bcd953eed6a1ec1…`; the same proof id.
- The live `POST /api/underwrite`, asked again: the same two decisions and ids. The decision id does not depend on
  when it is asked, so the browser, the live API and the local CLI agree (D30 idempotency, on the real chain).
- `IncomeVerifier.check` (eth_call, 400,000 gas, block 3957634, `0xc9844a8f…e1c8`) returned **true** for the proof.
  Public signals: threshold 1000000, count 3, ledger leaves 6–11 (run 2's vouch and sweep leaves), expiry 1798153199
  (2026-12-24 22:59:59 UTC: end of that day in the browser's time zone, UTC+1).

## Step 4: the bot records the approval (recording on)
The builder set `UNDERWRITE_RECORD=on`, asked again under rent-check@1 and pressed **Record on chain**: "Recorded.",
mined, block 3959087 → [04-bot-recorded.png](underwrite-live-44005/04-bot-recorded.png). Read from the chain by the
agent:
- tx [`0xc2caccd4…`](https://explorer-test.qday.info/tx/0xc2caccd4db89f8b0dccc0d67e7cf7df0491fec304248b2bc58c8fe137075a415), block 3959087 (2026-11-24T00:05:42Z), status success, legacy (type 0).
- from the bot `0x5B145B460924413951cc424B5D3D7241eC77EE2C` (its first tx: nonce now 1) to IncomeVerifier
  `0xc9844a8f…e1c8`, selector `0x7f383798` (`attest`), gas limit 420,000, gas used **267,053**, 1 gwei.
- event `IncomeProofChecked` (topic `0x0428b964…`): context `0x2286caab…19fa`, which is the link's context
  signal; threshold 1000000 (1 tUSD8), count 3.
- the bot's balance after: 0.001032947 tQDAY (0.0013 − 0.000267053).
- right after the record, `/api/underwrite` reported recording **on**; the builder then set `UNDERWRITE_RECORD=off`
  on Render. Re-read at 2026-11-24T00:24:47Z (block 3960215): `/api/underwrite` reports `enabled: false` (no bot
  address shown), and the bot's nonce is still 1 and its balance 0.001032947 tQDAY: one attest, nothing else sent.

Not shown live: asking to record the same proof again (the "once per proof" rule is shown by test U14, not on 44005).
