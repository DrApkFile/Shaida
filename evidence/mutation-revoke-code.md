# Mutation check: revocation (D35) and reader codes (D36)

Command: `node tools/mutation-revoke-code.mjs`. Commit 257fd52, 2026-11-25T23:35:15.624Z, Node v24.19.0, local (no chain).
Each mutation edits one line of packages/shaida-proofs and runs test/verify.revoke-code.test.ts and test/verify.revoke-code.property.test.ts; the source is restored after each run.

| Mutation | What it removes | Tests that failed | Result |
|---|---|---|---|
| — | no mutation | all pass | ok |
| M1 | remove the revocation check (step 5a) | failing: RP01, RV10, RV13 | caught |
| M2 | check revocation only for links that say v2 | failing: RP01, RV13, RV14 | caught |
| M3 | remove the code binding (the code no longer enters the reader id) | failing: RC03, RP01 | caught |
| M4 | accept a code-protected link without a code (fall back to the name) | failing: RC02, RC04, RP01 | caught |

Every mutation was caught by the tests named for it.
