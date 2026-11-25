# Eligibility re-check (A01–A12) against the live system

Written by `make eligibility` (`node tools/eligibility.mjs`). Do not edit by hand. Read-only: no transaction, no key.
Acceptance IDs: briefing/EVENT.md. Live guards G1–G5: PROOF_PLAN.md.

| Field | Value |
|---|---|
| Date (UTC) | 2026-11-25T05:43:21.233Z |
| Checked from commit | `9aec40618ec00cdea758e2cd0996eb0d1623bc53` (origin/master `9aec40618ec00cdea758e2cd0996eb0d1623bc53`) |
| Site / RPC | https://shaida.onrender.com / https://rpc-test.qday.info |
| Result | **FAILED** (1 check(s)) |

| ID | Check | Result | Status |
|---|---|---|---|
| A01 | public repo, permissive licence | GitHub API 200: private false, licence MIT; LICENSE starts "MIT License" | PASS |
| A02 | contracts deployed on 44005 | code at 16 of 16 addresses in deployments/aevum.json | PASS |
| A03 | deployed commit is public | deployments/aevum.json gitCommit 2a10759b3269 (dirty false): ancestor of origin/master true; GitHub 200 | PASS |
| A04 | tx hashes show the app working | 36 of 36 tx hashes in evidence/live-44005-run1.md, evidence/live-44005-run2.md, evidence/underwrite-live-44005.md, evidence/budget.md mined with status 1; IncomeProofChecked events among them: 3 (run 1, run 2, the bot) | PASS |
| A05 | live demo works logged out | /api/health 200: commit 9aec40618ec0 (origin/master 9aec40618ec0), networks [{"key":"aevum","chainId":44005}], store redis; / 200 with "See a live proof" true; /v 200; no cookie or login asked | PASS |
| A06 | docs: problem, architecture, workflows, technologies | README lacks ## The problem, ## How it works, ## The 60-second judge path, ## Tech | **FAIL** |
| A07 | reused code credited | NOTICE.md names 5 of 5 (Aevum Starter Kit, Gloam, circomlib, snarkjs, Inter Tight); contracts/lib/gloam/LICENSE present; README credit line present | PASS |
| A08 | no secrets in repo or history | gitleaks over the whole history: exit 0; 102 commits scanned.; no leaks found | PASS |
| A09 | team member registered on DoraHacks | a person checks the BUIDL page lists Kene as the team member (SUBMISSION.md) | **MANUAL** |
| A10 | uses tUSD8 | 0x456569838f1d43009a91eba4263147afd7233483: symbol "tUSD8", decimals 6; deployments token 0x456569838f1d43009a91eba4263147afd7233483; IncomeVerifier.asset() = 0x456569838f1d43009a91eba4263147afd7233483 | PASS |
| A11 | all settlement on Aevum | RPC https://rpc-test.qday.info eth_chainId 0xabe5 (44005); render-build.sh refuses any NEXT_PUBLIC_NETWORKS but "aevum" true; live site serves [{"key":"aevum","chainId":44005}] | PASS |
| A12 | no malicious code, no attacks on the platform | a person reviews: the only scripts that send txs are the deploy, the run scripts and the app's relayer (THREAT_MODEL.md, PRD §8); this check sent none | **MANUAL** |
| G1 | IncomeVerifier.check accepts run 1's proof | eth_call → true | PASS |
| G2 | IncomeVerifier.check refuses run 1's proof with the threshold edited | eth_call → Error: execution reverted: ProofInvalid | PASS |
| G3 | bot: rent-check → APPROVE | APPROVE; decision a63582509992a400…, evaluated 2026-11-25T05:43:13.000Z | PASS |
| G4 | bot: revenue-credit → DECLINE BelowMinThreshold,TooFewPayments,PeriodTooShort | DECLINE BelowMinThreshold,TooFewPayments,PeriodTooShort; decision 1bcd953eed6a1ec1…, evaluated 2026-11-25T05:43:17.000Z | PASS |
| G5 | bot: rent-check → DECLINE WrongReader | DECLINE WrongReader; decision 5e435c64c148574b…, evaluated 2026-11-25T05:43:21.000Z | PASS |
