# make gate at ced35d0 (chore/gate)

Fresh clone, fork node and dev server off. Exit 0.

| Step | Result | Seconds |
|---|---|---:|
| 1 install | PASS | 47 |
| 2 forge build + Shanghai check | PASS | 29 |
| 3 circuit compile + artifact hashes | PASS | 24 |
| 4 typecheck + lint | PASS | 10042 |
| 5 unit, circuit, indexer, relayer, flow tests | PASS | 79 |
| 6 fork tests | PASS | 15 |
| 7 claims check | PASS | 0 |

gate: PASS at ced35d0 in 10325 s

Step 4's 10,042 s includes a system suspend (journal: resumed 2026-11-22T01:05:37Z). Measured separately: web tsc 14 s, forge lint 1 s.

Earlier run at a0e95db (2026-11-21) was killed in step 1 by the harness for low memory: no result.

Correction: commit ced35d0 says check-artifacts' r1cs check passed in the worktree; it did not run there against a compiled circuit (income.r1cs was missing until compiled). In this gate run it passed after compile (step 3).
