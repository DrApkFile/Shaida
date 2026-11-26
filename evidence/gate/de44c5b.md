# make gate at de44c5b (Revocations live on 44005; shaida-sdk 0.2.0 pinned to it)

Fresh clone (under ~/.cache, removed on exit), fork node and dev server off. Exit 0. Step table copied from the
gate's own summary in [de44c5b.log](de44c5b.log).

| Step | Result | Seconds |
|---|---|---:|
| 1 install | PASS | 66 |
| 2 forge build + Shanghai check | PASS | 24 |
| 3 circuit compile + artifact hashes | PASS | 21 |
| 4 typecheck + lint | PASS | 196 |
| 5 unit, circuit, indexer, relayer, flow tests | PASS | 359 |
| 6 fork tests | PASS | 19 |
| 7 claims check | PASS | 1 |
| 8 secret scan (gitleaks, whole history) | PASS | 31 |

gate: PASS at de44c5b in 854 s. gitleaks: 117 commits scanned, no leaks found.

## Tests observed in this run
| Suite | Tests | Passed | Skipped |
|---|---:|---:|---:|
| Contracts (Foundry, 8 suites) | 65 | 65 | 0 |
| `@shaida/proofs` | 72 | 72 | 0 |
| `@shaida/kv` | 6 | 6 | 0 |
| `@shaida/index` | 13 | 13 | 0 |
| `@shaida/relay` (file store) | 51 | 50 | 1 |
| `@shaida/relay` rails + outcomes again on the KV store | 35 | 35 | 0 |
| `@shaida/pay` | 25 | 25 | 0 |
| `@shaida/ceremony` | 14 | 14 | 0 |
| `@shaida/underwrite` | 49 | 49 | 0 |
| `@shaida/privacy-audit` | 23 | 23 | 0 |
| `web` | 7 | 7 | 0 |
| `shaida-sdk` (S01–S24, S12b) | 25 | 25 | 0 |
| Fork tests on real tUSD8 (3 suites) | 12 | 12 | 0 |
| **Total** | **397** | **396** | **1** |

The skipped test is `RS00` (Redis Lua against a real Redis, INCONCLUSIVE without `SHAIDA_KV_TEST_URL`), as in every
gate run. The run took 854 s, against 563 s at 0da36b1: about 1.7 GB of memory was free on the 7.5 GB machine.
