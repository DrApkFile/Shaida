# make gate at 6fcbfb8 (feat/sdk, @shaida/sdk 0.1.0)

Fresh clone (under ~/.cache, removed on exit), fork node and dev server off. Exit 0. Step table copied from the
gate's own summary at the end of [6fcbfb8.log](6fcbfb8.log). The run before it, at cdde387, failed at step 8 on a
public sha256 pin ([cdde387-FAILED.md](cdde387-FAILED.md)).

| Step | Result | Seconds |
|---|---|---:|
| 1 install | PASS | 54 |
| 2 forge build + Shanghai check | PASS | 24 |
| 3 circuit compile + artifact hashes | PASS | 18 |
| 4 typecheck + lint | PASS | 145 |
| 5 unit, circuit, indexer, relayer, flow tests | PASS | 185 |
| 6 fork tests | PASS | 16 |
| 7 claims check | PASS | 0 |
| 8 secret scan (gitleaks, whole history) | PASS | 19 |

gate: PASS at 6fcbfb8 in 533 s. gitleaks: 108 commits scanned, no leaks found.

## Tests observed in this run
| Suite | Command (gate step) | Tests | Passed | Skipped |
|---|---|---:|---:|---:|
| Contracts (Foundry, 7 suites) | `forge test --no-match-path 'test/fork/*'` (5) | 57 | 57 | 0 |
| `@shaida/proofs` | 5 | 57 | 57 | 0 |
| `@shaida/kv` | 5 | 6 | 6 | 0 |
| `@shaida/index` | 5 | 13 | 13 | 0 |
| `@shaida/relay` (file store) | 5 | 44 | 43 | 1 |
| `@shaida/relay` rails + outcomes again on the KV store | 5 | 28 | 28 | 0 |
| `@shaida/pay` | 5 | 20 | 20 | 0 |
| `@shaida/ceremony` | 5 | 14 | 14 | 0 |
| `@shaida/underwrite` | 5 | 45 | 45 | 0 |
| `@shaida/privacy-audit` | 5 | 23 | 23 | 0 |
| `web` | 5 | 6 | 6 | 0 |
| `@shaida/sdk` (S01–S18, S12b; new) | 5 | 19 | 19 | 0 |
| Fork tests on real tUSD8 (3 suites) | `forge test --match-path 'test/fork/*'` (6) | 12 | 12 | 0 |
| **Total** | | **344** | **343** | **1** |

The skipped test is `RS00` (Redis Lua against a real Redis, INCONCLUSIVE without `SHAIDA_KV_TEST_URL`), as in every
gate run. The 28 relay KV tests rerun tests already counted on the file store, so 316 distinct tests ran.
