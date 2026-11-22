# Budget: tQDAY and tUSD8 on Aevum testnet

The only funds are on the deployer `0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698`; there is no faucet top-up.
Gas price on 44005 is 1 gwei, so 1,000,000 gas = 0.001 tQDAY.

**Hard limits:**
- The deployer never goes below 0.5 tQDAY.
- The deployer never holds less than 2 tUSD8.
- Helpers (the relayer and the reader) are funded with the planned need plus 50%, never more.
- After every live run, Ada withdraws her swept tUSD8 back to the deployer.

## Ledger (actual, read from the chain)

| When | What | Txs | Gas used | tQDAY spent | Deployer tQDAY after | Deployer tUSD8 after |
|---|---|---:|---:|---:|---:|---:|
| before deploy | starting balance (derived: balance after deploy + deploy fees) | — | — | — | 1.000000000 | 5 |
| 2026-11-22, blocks 3810938–3810997 | `make deploy-aevum` (run by the builder): 16 creates and 4 pool setup calls ([evidence/aevum-deployment.md](aevum-deployment.md)) | 20 | 17,030,724 | 0.017030724 | 0.982969276 | 5 |

Every row above comes from receipts (`gasUsed × effectiveGasPrice`) and `eth_getBalance` / `balanceOf` at block 3811143.
Explorer verification of `PayerRegistry` (S10) cost nothing: it is an explorer API call, not a transaction.

## Plan for live run 1 (not run; no transaction sent)

The gas figures are the largest measured on the fork (evidence/fork-gas.md, evidence/acts-4-6-fork.md). Three are
different:
- **Registration and the tUSD8 transfer** are `eth_estimateGas` on 44005.
- **Unshield** is spike S2 on anvil.
- **The withdraw step is not built yet.**

Payments: **1.5 + 1 + 0.5 = 3 tUSD8**, from one gasless deposit of 3 tUSD8 by a demo payer.

Proof: **≥ 3 tUSD8, step 1**. It is one proof: 3 payments fit its 4 slots, so the D13 rounding loses nothing (3,000,000 → 3).

| Step | Sender (pays gas) | Txs | Gas each | Gas |
|---|---|---:|---:|---:|
| fund the relayer | deployer | 1 | 21,000 | 21,000 |
| fund the reader | deployer | 1 | 21,000 | 21,000 |
| register Acme Studio (demo) as payer | deployer (= attestor) | 1 | 117,922 (estimate) | 117,922 |
| 3 tUSD8 to the payer | deployer | 1 | 45,503 (estimate) | 45,503 |
| gasless deposit of 3 tUSD8 | relayer | 1 | 1,346,538 | 1,346,538 |
| vouched pays of 1.5, 1 and 0.5 | relayer | 3 | 2,766,976 | 8,300,928 |
| sealed memos (one per pay) | relayer | 3 | 44,923 | 134,769 |
| sweeps by Ada | relayer | 3 | 2,697,283 | 8,091,849 |
| check on chain | nobody (eth_call) | 0 | — | 0 |
| attest (record check) | reader | 1 | 267,017 (gas limit 420,000) | 267,017 |
| withdraw: 3 unshields to the deployer, one per swept note (**not built**) | relayer | 3 | ~320,000 | 960,000 |

### Funding from the deployer

| Account | Planned gas | Funding | Why that amount |
|---|---:|---:|---|
| relayer (new key, server only) | 18,834,084 | **0.039 tQDAY** | 0.0188 × 1.5 = 0.0283 to spend, plus 0.01: the relayer refuses to send below 0.01 tQDAY (`minBalanceWei`). That 0.01 is never spent and is returned with the rest. |
| reader, Bola (new browser key) | 267,017 | **0.00063 tQDAY** | The node needs gas limit × price = 0.00042 up front for the 420k attest; × 1.5 |
| attestor | — | 0 | It is the deployer itself |
| payer, Acme Studio (demo) | 0 | 0 tQDAY, 3 tUSD8 | EIP-3009 is gasless for the payer |
| Ada (demo) | 0 | 0 | The relayer sends her sweeps and withdrawals |

### Expected balances

| Point | Deployer tQDAY | Deployer tUSD8 | Relayer tQDAY | Reader tQDAY |
|---|---:|---:|---:|---:|
| now | 0.982969 | 5 | 0 | 0 |
| after funding, registration and the tUSD8 transfer | 0.943134 | 2 | 0.039 | 0.00063 |
| after the run and the withdrawal | 0.943134 | 5 | ≈ 0.0202 | ≈ 0.00036 |
| after returning the leftovers (2 × 21,000 gas) | ≈ 0.963621 | 5 | 0 | 0 |

The deployer stays ≥ 0.5 tQDAY and ≥ 2 tUSD8 at every point. Net cost of one run: ≈ 0.0193 tQDAY. That leaves
room for 23 more full runs above the 0.5 reserve.

## Runs

None yet.
