# make gate at cdde387 (feat/sdk): FAIL at step 8

Fresh clone, exit 1. Raw output: [cdde387-FAILED.log](cdde387-FAILED.log).

| Step | Result | Seconds |
|---|---|---:|
| 1 install | PASS | 73 |
| 2 forge build + Shanghai check | PASS | 49 |
| 3 circuit compile + artifact hashes | PASS | 37 |
| 4 typecheck + lint | PASS | 200 |
| 5 unit, circuit, indexer, relayer, flow tests | PASS | 227 |
| 6 fork tests | PASS | 15 |
| 7 claims check | PASS | 0 |
| 8 secret scan (gitleaks, whole history) | **FAIL** | 17 |

gitleaks found 1 leak in 107 commits: rule `generic-api-key`, `packages/sdk/src/pins.ts` line 20, commit cdde387, the
`vkeySha256` value. That value is `PINNED.vkeySha256`: the sha256 of the canonical JSON of the income circuit's
public final verification key (D33), not a secret. Fix (next commit): `.gitleaks.toml` allowlists that exact value
and `PINNED.networkSha256`, as it already does for the published zkey sha256 pins. History was not rewritten; the
allowlist covers the value in cdde387 too. A local `gitleaks detect` over the whole history then reports no leaks.
