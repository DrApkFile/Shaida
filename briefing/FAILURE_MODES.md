# FAILURE_MODES

## Aevum RPC (rpc-test.qday.info, single public endpoint, HTTPS only)
| Mode | Can it happen? | Guard chosen | Where | Test |
|---|---|---|---|---|
| Replay | A tx resent after a timeout | Contracts are idempotent: nullifiers (pool), EIP-3009 nonce tied to (contract, depositId), registry ops keyed by payer | contracts | double-submit tests |
| Retry | Network/5xx on reads | Reads retry with backoff; **writes never auto-retry**: show "unknown", re-check by tx hash / nullifier | client rpc layer | unit |
| Timeout | Broadcast without receipt | Outcome = `UNKNOWN`, held; UI says "may have gone through, checking" and polls by hash; never treated as success | client | unit |
| 429 | Possible on public RPC | Backoff; cap sync concurrency to 1 | sync | — |
| Partial result | Log sync interrupted | Tree marked incomplete; **no proof built on an incomplete tree** (root must match the on-chain root) | sync | test |
| Ordering | Reads across blocks | All reads pinned to one block number | client | test |
| Large log range | `eth_getLogs` fails | ≤ 1,000-block pages (value set by S3) | sync | fork test |

## Gloam engine (our deploy on Aevum)
| Mode | Guard |
|---|---|
| Payer claws back before sweep | Only swept notes count (circuit, R1); UI forces sweep before "credited" |
| Payment code doesn't open the named commitment | Refuse, as Gloam does: `PaymentCodeMismatch` |
| Note already spent by someone else | Refuse at pinned block |
| Artifacts URL unreachable | Self-host circuit artifacts with pinned hashes; refuse a mismatched hash |

## Shaida proof verification (page, API, contract)
| Mode | Guard |
|---|---|
| Expired | `ProofExpired`, checked against block time on-chain, server time off-chain |
| Wrong reader | `WrongReader` (reader id is a public signal) |
| Payer revoked | `PayerRevoked`: registry checked at the proof's reference block |
| Unknown root | `UnknownRoot`: the root must be a known historical pool root |
| Malformed input | Strict schema; parse as unknown; refuse rather than repair |

## Secrets
- Note secrets and receive keys stay in the browser (encrypted local storage + exportable backup). Never logged, never sent to our server.
- Deployer/relayer keys: Foundry keystore only; gitleaks in CI.
