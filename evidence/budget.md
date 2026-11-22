# Budget: tQDAY and tUSD8 on Aevum testnet

The only funds are on the deployer `0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698`; there is no faucet top-up.
Gas price on 44005 is 1 gwei, so 1,000,000 gas = 0.001 tQDAY.

**Hard limits:**
- The deployer never goes below 0.5 tQDAY.
- The deployer never holds less than 2 tUSD8.
- Helpers (the relayer and the reader) are funded with the planned need plus 50%, never more.
- **Withdrawals (changed 2026-11-22, after the plan below was first written):** a withdrawal is public and shows its
  amount (LIMITS.md), so it never happens right after a demo run. Ada withdraws only when the deployer's tUSD8 would
  otherwise fall below 2. Then she withdraws all swept notes in one batch at a quiet time, to a fresh address we
  control, which forwards the tUSD8 to the deployer.

## Ledger (actual, read from the chain)

| When | What | Txs | Gas used | tQDAY spent | Deployer tQDAY after | Deployer tUSD8 after |
|---|---|---:|---:|---:|---:|---:|
| before deploy | starting balance (derived: balance after deploy + deploy fees) | — | — | — | 1.000000000 | 5 |
| 2026-11-22, blocks 3810938–3810997 | `make deploy-aevum` (run by the builder): 16 creates and 4 pool setup calls ([evidence/aevum-deployment.md](aevum-deployment.md)) | 20 | 17,030,724 | 0.017030724 | 0.982969276 | 5 |

Every row above comes from receipts (`gasUsed × effectiveGasPrice`) and `eth_getBalance` / `balanceOf` at block 3811143.
Explorer verification of `PayerRegistry` (S10) cost nothing: it is an explorer API call, not a transaction.

## Plan for live run 1 (not run; no transaction sent)

Where the gas figures come from:
- **Relayed transactions:** the largest measured on the fork (evidence/fork-gas.md, evidence/acts-4-6-fork.md).
- **Unshield and forward:** measured on the fork (evidence/withdraw-fork.md).
- **Registration and the tUSD8 transfer:** `eth_estimateGas` on 44005.

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
| withdraw | — | 0 | — | 0 (not after a run: see below) |

### Withdrawal batch (before run 2, not after run 1)

After run 1 the deployer holds exactly 2 tUSD8 and Ada holds 3 tUSD8 in 3 swept notes. Run 2 needs 3 tUSD8, which would
take the deployer below 2. So the batch comes first: at a quiet time, Ada withdraws the 3 notes to a fresh address we
control, and that address forwards the 3 tUSD8 to the deployer.

| Step | Sender (pays gas) | Txs | Gas each | Gas |
|---|---|---:|---:|---:|
| 3 unshields (one per note) | relayer | 3 | 343,698 (fork max) | 1,031,094 |
| fund the fresh address | deployer | 1 | 21,000 | 21,000 |
| forward 3 tUSD8 to the deployer | fresh address | 1 | 57,583 (fork) | 57,583 |

The fresh address is funded at that time with 0.000087 tQDAY (57,583 × 1.5), not now.

### Keys (generated 2026-11-22, outside the repo)

| Role | Address | Where the key is |
|---|---|---|
| relayer | `0xF4945dD57C8de1C637966179df5b631689901422` | Foundry keystore `shaida-relayer`; the server gets it only as `RELAYER_PRIVATE_KEY` in its environment at start |
| reader (Bola) | `0xbed994a7fD0e7A49DAD09866e86817ccA6Ea785E` | Foundry keystore `shaida-reader`, to import into the reader's browser wallet for "Record check" |

Both keystores are in `~/.foundry/keystores/`, with random passwords in `~/.config/shaida/` (mode 600).

### Funding from the deployer (waiting for the builder's yes)

| Account | Planned gas | Funding | Why that amount |
|---|---:|---:|---|
| relayer `0xF494…1422` | 18,905,178 (run 1 + the batch) | **0.0384 tQDAY** | 0.018905 × 1.5 = 0.028358, plus 0.01: the relayer refuses to send below 0.01 tQDAY (`minBalanceWei`). That 0.01 is never spent and is returned with the rest. |
| reader `0xbed9…785E` | 267,017 | **0.00063 tQDAY** | The node needs gas limit × price = 0.00042 up front for the 420k attest; × 1.5 |
| attestor | — | 0 | It is the deployer itself |
| payer, Acme Studio (demo) | 0 | 0 tQDAY, 3 tUSD8 | EIP-3009 is gasless for the payer |
| Ada (demo) | 0 | 0 | The relayer sends her sweeps and withdrawals |

### Expected balances

| Point | Deployer tQDAY | Deployer tUSD8 | Relayer tQDAY | Reader tQDAY |
|---|---:|---:|---:|---:|
| now | 0.982969 | 5 | 0 | 0 |
| after funding, registration and the tUSD8 transfer | 0.943734 | 2 | 0.0384 | 0.00063 |
| after run 1 | 0.943734 | 2 | ≈ 0.020526 | ≈ 0.000363 |
| after the withdrawal batch (before run 2) | ≈ 0.943626 | 5 | ≈ 0.019495 | ≈ 0.000363 |

The deployer stays ≥ 0.5 tQDAY and ≥ 2 tUSD8 at every point. One run plus its share of a batch costs ≈ 0.0193 tQDAY
in gas.

## Runs

None yet.
