# PROOF_PLAN: what a judge can check, and how

Everything here is read-only unless a line says otherwise. Personas are demo (Acme Studio, Ada, Landlord Bola,
Tenant Chidi, "Shaida underwriting bot (demo)"); the amounts are real testnet tUSD8 on Aevum 44005.
Explorer: https://explorer-test.qday.info. RPC: https://rpc-test.qday.info. Live app: https://shaida.onrender.com.

## 1. The verified real runs on Aevum testnet (44005)
Each tx below was re-read by its hash with status 1 by `make eligibility` ([evidence/eligibility.md](evidence/eligibility.md), A04).

### Run 1, by script through the app's server routes (2026-11-22, commit `9c65184`)
Full table, 13 txs with gas and balances: [evidence/live-44005-run1.md](evidence/live-44005-run1.md).

| Step | Tx |
|---|---|
| Acme registered as payer #1 (attestor) | [`0xbfbf81db…`](https://explorer-test.qday.info/tx/0xbfbf81db8af5387a1b0100f733a6437dc4b8043b1c0a6f2649f574a6a4744ada) |
| Gasless deposit of 3 tUSD8 (Acme signs, the relayer pays gas) | [`0x3304a6f5…`](https://explorer-test.qday.info/tx/0x3304a6f52d75143f5c958fae450e62e4f422bc7bf755cf2c40d5d49156e4c9ea) |
| Vouched private pays 1.5 / 1 / 0.5 tUSD8 | [`0x364428d9…`](https://explorer-test.qday.info/tx/0x364428d98fab385d23d2b66b78be1dd24a08133243979e2ff2d8fb254f35ed29) · [`0xc111e08a…`](https://explorer-test.qday.info/tx/0xc111e08a4e9587ac383095c84b61516d4d0a96952b38bb20a942b7affbb7c684) · [`0x9eb24ba7…`](https://explorer-test.qday.info/tx/0x9eb24ba7655b534d9b63309449c4af2f9f5f623f14488b0b2d1b733c13b1234a) |
| Sweeps by Ada | [`0x54700656…`](https://explorer-test.qday.info/tx/0x547006565b06880c5164a1b7298065417f9e370106462fe5f41924d035a1fc4e) · [`0x483b0ece…`](https://explorer-test.qday.info/tx/0x483b0ecedf482a42ac050e1f3dc1512588dd4fc88b1dc8593afe607cb688c1d2) · [`0x75d07174…`](https://explorer-test.qday.info/tx/0x75d071745bc0b562d4ef3614f8279502a9a46e5010d49418e6c62316d57f5831) |
| Bola's attest: `IncomeProofChecked(threshold 3000000, count 3)` | [`0xf8c1b89b…`](https://explorer-test.qday.info/tx/0xf8c1b89b50c79f2891b254f1ca3b297e1e5bb796af64f292b72a2a28f0645441) |

The proof (≥ 3 tUSD8, 3 payments, final key, made in Node in 13.4 s) is the landing page's example link
(`web/src/app/example-links.json`). It expires **2026-12-22 10:51:58 UTC**; after that, /v answers ProofExpired, as
designed. `IncomeVerifier.check` does not read the expiry, so section 3's command keeps returning true.

### Run 2, clicked by hand by the builder on the live site (2026-11-23, Firefox 157 at 390 px)
Full table: [evidence/live-44005-run2.md](evidence/live-44005-run2.md). Screens: [evidence/ui-44005/](evidence/ui-44005/).

| Step | Tx |
|---|---|
| Gasless deposit of 1 tUSD8 (signed in MetaMask) | [`0xb6bcbc40…`](https://explorer-test.qday.info/tx/0xb6bcbc4098fb07260d50125b17be654716fe647b4ad500173873c9578c4dde02) |
| Vouched pays 0.5 / 0.3 / 0.2 | [`0x98c64110…`](https://explorer-test.qday.info/tx/0x98c64110aec9049f1745dd8564c7c5418c0aaf6dd6a0d184517cc4d16f68e27a) · [`0x097cb2fb…`](https://explorer-test.qday.info/tx/0x097cb2fb8ab58448c81e78fc3d3ffec0f6c4316e4b9e5ea29e9958b2907b21a2) · [`0x23233274…`](https://explorer-test.qday.info/tx/0x23233274a33772f4cca01885bfadf1f05f7ddcf868593f6e348e77c7860f4a30) |
| "Sweep all 3" | [`0x754f9029…`](https://explorer-test.qday.info/tx/0x754f902959ee96cc563d883edec0eeb2f89046402dddb1326396d755b8564dfa) · [`0xf92f4e20…`](https://explorer-test.qday.info/tx/0xf92f4e20662f2344b91b2cceabaf9c7ae5f25f511f99904713f7e45e3bdc8180) · [`0xf4c1256f…`](https://explorer-test.qday.info/tx/0xf4c1256f1abd7d799fe1b2decc47555e959ad48d087e10faac637d04f8a5da0c) |
| Proof in the browser: 16.2 s, one proof, final key (screen 390-14) | — (made in the browser, no tx) |
| Bola's attest from MetaMask: `IncomeProofChecked(threshold 1000000, count 3)` | [`0x05435681…`](https://explorer-test.qday.info/tx/0x054356813d7e88de742ae78079174e94772a46baa6d4f9de5eb5ffc0241111ec) |

### The bot's on-chain record (2026-11-24)
[evidence/underwrite-live-44005.md](evidence/underwrite-live-44005.md). Ada made a proof for the bot's reader name in
Firefox (22.6 s). The bot APPROVEd it under rent-check@1 (decision `a63582509992a400…`) and DECLINEd it under
revenue-credit@1 (`1bcd953eed6a1ec1…`). The CLI and the live API gave the same ids. The bot then recorded the approval
with its own key: [`0xc2caccd4…`](https://explorer-test.qday.info/tx/0xc2caccd4db89f8b0dccc0d67e7cf7df0491fec304248b2bc58c8fe137075a415)
(267,053 gas). Recording was switched off again; the bot's nonce is 1.

Not part of the runs, on record: run 1's notes were withdrawn later through the live site (three `pool.unshield`,
[evidence/budget.md](evidence/budget.md) W2). Withdrawals are public and showed those amounts (LIMITS.md).

## 2. The judge path (60 seconds, browser only)
Scripted at 390 px by `make judge-ui` ([evidence/judge-ui/report-390.md](evidence/judge-ui/report-390.md)).
1. https://shaida.onrender.com → **See a live proof (Demo)**.
2. Type **Landlord Bola** → **Verify** → **VALID**: at least 3 tUSD8 in 3 payments, 22 Nov 2026, expires 22 Dec 2026.
3. **Check on-chain** → "IncomeVerifier.check passed for 1 proof at block N. Nothing was sent."
4. Attacks (section 4): another reader name, an edited threshold, an edited expiry.
5. The bot: open the sample link from the README's judge path → **Ask the bot** → APPROVE (rent-check); switch to
   revenue-credit → DECLINE with three reasons.

Do not press "Record check": it sends a transaction from your own wallet, and it publishes the proof's numbers.
It stays disabled until you tick the consent box (D32 F3).

## 3. Verify it yourself (terminal, no clone)
The commands are in the README, under "Verify it yourself in 30 seconds". They were pasted into a clean `env -i` shell
on 2026-11-25, with the results recorded in [evidence/presubmit-audit.md](evidence/presubmit-audit.md):
`curl /api/health` (commit, chain 44005, redis); the zkey sha256 from the release and from the live site
(`cbcb06fe…`, both); `cast call IncomeVerifier.check` with run 1's proof (`true`); and the same call with the
threshold edited (`ProofInvalid`).

## 4. Live-attackable guards
| # | Attack | How a judge tries it | Expected |
|---|---|---|---|
| G1 | Present a proof to the wrong reader | /v with run 1's link, type `Tenant Chidi` | **WrongReader** |
| G2 | Inflate the threshold | browser console snippet in the README (signal 3 → 4000000), then Verify | **ProofInvalid** |
| G3 | Extend the expiry | same snippet with `j.expiry+=2592000` | **ContextMismatch** |
| G4 | Inflate the threshold on chain | README command 4 (`cast call … 30000000`) | revert **ProofInvalid** |
| G5 | A malformed link | `https://shaida.onrender.com/v#bm90LWEtbGluaw`, any name | **ProofInvalid** ("The link is malformed …") |
| G6 | A proof over a ledger the chain never had | the bot's final-key test fixture (`packages/shaida-underwrite/test/fixtures/final-key-link.json`) on /v | **INCONCLUSIVE UnknownRoot** (never VALID) |
| G7 | A link made for someone else, sent to the bot | /underwrite, rent-check, paste run 1's link | **DECLINE WrongReader** |
| G8 | A proof below a lender's policy | the bot sample under revenue-credit | **DECLINE** BelowMinThreshold, TooFewPayments, PeriodTooShort |
| G9 | Relay arbitrary calldata | `curl -X POST https://shaida.onrender.com/api/relay/sweep -d '{"to":"0x…","data":"0x…"}'` | **InputRejected** (strict schema; no route takes calldata or a target) |
| G10 | Oversized body to the bot | `head -c 20000 /dev/zero \| tr '\0' a \| curl --data-binary @- -H 'content-type: application/json' https://shaida.onrender.com/api/underwrite` | HTTP **413** |

G1–G8 run in `make judge-ui` and `make eligibility`. G9 and G10 were run once by curl for the pre-submit audit
([evidence/presubmit-audit.md](evidence/presubmit-audit.md)). Not live-attackable, but shown by tests:
`PayerNotRegistered` (X01, X02), `PayerRevoked` (X03), `AlreadySpent` clawback (R07; fork run of acts 2–3),
`ProofExpired` (fork, browser clock moved 31 days: [evidence/ui/report-390.md](evidence/ui/report-390.md)), and the
bundle refusals X14–X18.

## 5. Acceptance IDs (briefing/EVENT.md) → test → evidence
| ID | Requirement | Test or check | Evidence |
|---|---|---|---|
| A01 | public repo, MIT | `make eligibility` A01 (GitHub API: public, MIT) | `LICENSE`, [evidence/eligibility.md](evidence/eligibility.md) |
| A02 | contracts on 44005 with explorer links | `make verify-aevum` (`tools/verify-aevum.mjs`, `contracts/script/VerifyDeployment.s.sol`); eligibility A02 | `deployments/aevum.json`, [evidence/aevum-deployment.md](evidence/aevum-deployment.md), [evidence/s10-explorer-verify.md](evidence/s10-explorer-verify.md) |
| A03 | exact deployed commit | `tools/write-deployment.mjs` records it; eligibility A03 (on GitHub, ancestor of master, clean) | `deployments/aevum.json` `gitCommit` `2a10759…` |
| A04 | tx hashes showing the app working | eligibility A04 (every linked tx mined, 3 `IncomeProofChecked`) | [run 1](evidence/live-44005-run1.md), [run 2](evidence/live-44005-run2.md), [bot](evidence/underwrite-live-44005.md) |
| A05 | live demo without login | `tools/check-hosting.sh`, `make judge-ui`, eligibility A05 | [evidence/hosting-render.md](evidence/hosting-render.md), [evidence/judge-ui/](evidence/judge-ui/report-390.md) |
| A06 | docs: problem, architecture, workflows, tech | eligibility A06 (README sections and diagram); claims check (gate step 7) | `README.md`, `PRD.md`, `DECISIONS.md` |
| A07 | credit reused code, NOTICE | eligibility A07 | `NOTICE.md`, `contracts/lib/gloam/LICENSE` |
| A08 | no keys or secrets in repo or history | gitleaks, gate step 8, eligibility A08 | `.gitleaks.toml`, `tools/gate.sh` (CL41) |
| A09 | team member registered on DoraHacks | **manual** | `SUBMISSION.md` (team: Kene) |
| A10 | uses tUSD8 `0x4565…3483` | `test_A10_real_tUSD8_has_the_expected_domain_and_decimals` (fork); eligibility A10 (symbol, decimals, `IncomeVerifier.asset()`) | `contracts/test/fork/AevumFork.t.sol` |
| A11 | all settlement on Aevum | `tools/render-build.sh` refuses any network but `aevum`; `P01` (the throwaway key is refused on 44005); eligibility A11 (RPC chain id, live networks) | [evidence/eligibility.md](evidence/eligibility.md). No unit test asserts the production network list; the build script and the live check do |
| A12 | no malicious code | **manual** review | `THREAT_MODEL.md`, PRD §8 |

## 6. `make eligibility`
`node tools/eligibility.mjs` re-checks A01–A08, A10 and A11, and the live guards (on-chain check true, edited
threshold ProofInvalid, bot APPROVE, DECLINE and WrongReader), against GitHub's public API, the live site and Aevum
44005. It sends no transaction and needs no key. A09 and A12 print as MANUAL. It writes
[evidence/eligibility.md](evidence/eligibility.md), or a `-FAILED-` copy that stays on record. Exit 0 means every
automatic check passed. A05 needs the live `/api/health` commit to equal `origin/master`, so it fails for the few
minutes Render takes to redeploy after a push.

Time-dependent: the bot sample's APPROVE turns into DECLINE ExpiresTooSoon after about 2026-12-17 23:00 UTC, and
run 1's link turns ProofExpired on /v after 2026-12-22 10:51:58 UTC. Both are by design (LIMITS.md, D30).
