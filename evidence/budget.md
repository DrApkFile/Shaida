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
| 2026-11-22, block 3822055 | fund the relayer `0xF4945dD5…01422` with 0.0384 tQDAY (sent by the builder) [`0x48471e52…`](https://explorer-test.qday.info/tx/0x48471e529d07dabbb6ba33edaee3eccbb034348cd5fdd9c770e383891eabd352) | 1 | 21,000 | 0.038421 | 0.944527276 | 5 |
| 2026-11-22, block 3822068 | fund the reader `0xbed994a7…a785E` with 0.00063 tQDAY (sent by the builder) [`0x53eb21eb…`](https://explorer-test.qday.info/tx/0x53eb21eb186f9279c5d76b568250b97fd588da4c53e61aa525748a47caf0d553) | 1 | 21,000 | 0.000651 | 0.943897276 | 5 |
| 2026-11-22, block 3826477 | register Acme Studio (demo) `0xA1ddEB46…91D4b` as payer #1 (sent by the builder) [`0xbfbf81db…`](https://explorer-test.qday.info/tx/0xbfbf81db8af5387a1b0100f733a6437dc4b8043b1c0a6f2649f574a6a4744ada) | 1 | 117,922 | 0.000117922 | — | 5 |
| 2026-11-22, block 3826515 | 3 tUSD8 to the payer (sent by the builder) [`0xe986ae47…`](https://explorer-test.qday.info/tx/0xe986ae473388cd5cc9a98ebab912285f65bca8d2639d3a37b1c924c53a27e7d0) | 1 | 62,383 | 0.000062383 | 0.943716971 | 2 |
| 2026-11-22, blocks 3826680–3826836 | live run 1: 10 relayed txs (relayer pays 0.017420764) and 1 attest (reader pays 0.000267017); per-tx rows in [evidence/live-44005-run1.md](live-44005-run1.md) | 11 | 17,687,781 | 0.017687781 (helpers) | 0.943716971 | 2 |

Every row above comes from receipts (`gasUsed × effectiveGasPrice`) and `eth_getBalance` / `balanceOf` (deploy rows at block
3811143; funding rows at block 3822171, when the relayer held 0.0384 tQDAY and the reader 0.00063 tQDAY, as sent).
"tQDAY spent" on a funding row is the value sent plus its gas; the value is still ours, on the helper account.
The registration row has no balance of its own because the builder sent both deployer transactions before the script
read balances; the transfer row's balances are read after both (block 3826515 onward). Run 1's helper spend comes out
of the 0.0384 and 0.00063 already sent, not out of the deployer.
Explorer verification of `PayerRegistry` (S10) cost nothing: it is an explorer API call, not a transaction.

## Plan for live run 1 (run 2026-11-22: see Runs)

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

### Funding from the deployer (sent by the builder, blocks 3822055 and 3822068)

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

### Run 1, 2026-11-22, blocks 3826477–3826836: passed

Per-tx hashes, explorer links, gas and balances before and after: [evidence/live-44005-run1.md](live-44005-run1.md).
Bola's browser check of the same link at 390 px: [evidence/live-44005-ui/report-390.md](live-44005-ui/report-390.md).

| | Planned | Actual |
|---|---:|---:|
| registration gas | 117,922 (estimate) | 117,922 |
| tUSD8 transfer gas | 45,503 (estimate; 62,874 re-estimated before sending) | 62,383 |
| relayed gas (deposit, 3 pays, 3 memos, 3 sweeps) | 17,874,084 | 17,420,764 |
| attest gas | 267,017 | 267,017 |

Balances read from the chain at block 3827735, after the run:

| Account | tQDAY | tUSD8 | Expected (plan) |
|---|---:|---:|---|
| deployer | 0.943716971 | 2 | 0.943734 / 2 (the transfer cost 16,880 gas more than estimated) |
| relayer | 0.020979236 | 0 | ≈ 0.020526 |
| reader | 0.000362983 | 0 | ≈ 0.000363 |
| payer, Acme Studio (demo) | 0 | 0 | 0 / 0 (all 3 tUSD8 paid out) |
| Ada (demo) | — | 3, in 3 swept pool notes | 3 |

No withdrawal after the run (rule above). Limits held at every step: the script read them from the chain before each
transaction (deployer ≥ 0.5 tQDAY and ≥ 2 tUSD8; relayer ≥ its 0.01 floor plus the call's gas limit).
The relayer can pay for the withdrawal batch (≈ 0.001031 tQDAY) and stay above its 0.01 floor. It can't pay for run 2
as well (≈ 0.0174 tQDAY), so a top-up is needed before run 2. It will be sized and approved with the builder then.

## Plan for live run 2: entirely through the hosted UI (not run; nothing sent)

Written 2026-11-22 from balances read at block 3834199 (unchanged since run 1: deployer 0.943716971 tQDAY and
2 tUSD8, relayer 0.020979236, reader 0.000362983, Acme Studio (demo) active payer #1 with 0 tQDAY and 0 tUSD8, Ada's
3 tUSD8 in 3 swept pool notes). Runs only after the hosted site is live (DEPLOY_RENDER.md), every step clicked in the
hosted app at 390 px, screenshots in evidence/ui-44005/. Gas figures: the largest measured (fork maxima from
evidence/fork-gas.md and evidence/withdraw-fork.md; each is ≥ the 44005 actual of run 1).

### tUSD8: why the withdrawal batch comes first
The deployer holds exactly 2 tUSD8, its floor. Any tUSD8 for run 2, however small, would take it below 2, so a smaller
amount on its own is not possible: the batch has to come first either way. The choice is only how much run 2 uses.

| | Run 2 = 3 tUSD8 (1.2 + 1.1 + 0.7), not chosen | Run 2 = 1 tUSD8 (0.5 + 0.3 + 0.2), **chosen by the builder (2026-11-23)** |
|---|---|---|
| Proof | ≥ 3 tUSD8, 3 payments (as run 1) | ≥ 1 tUSD8, 3 payments |
| Deployer tUSD8 after | 2 (at the floor again) | 4 |
| Next run | needs another public withdrawal batch first | a run 3 of up to 2 tUSD8 needs no withdrawal |
| Gas | the same (gas does not depend on the amount) | the same |
| Public amounts | batch shows 1.5, 1, 0.5 (run 1's); deposit shows 3 | batch shows 1.5, 1, 0.5; deposit shows 1 |

Either way the run 2 amounts differ from the 1.5 / 1 / 0.5 the batch makes public, so the batch's amounts cannot be
matched to run 2's payments. The batch runs at a quiet time: at least 12 h after run 1 and at least 12 h before run 2
(D28, LIMITS.md).

### Steps and transactions

| # | When | What (who clicks / sends) | Sender, pays gas | Gas (planned max) |
|---|---|---|---|---:|
| F1 | before the batch | 0.017378531 tQDAY to the relayer `0xF4945dD57C8de1C637966179df5b631689901422` (builder's terminal) | deployer | 21,000 |
| F2 | before the batch | 0.000267017 tQDAY to the reader `0xbed994a7fD0e7A49DAD09866e86817ccA6Ea785E` (builder's terminal) | deployer | 21,000 |
| F3 | before the batch | 0.000086375 tQDAY to the forward address `0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0` (keystore `shaida-forward`) | deployer | 21,000 |
| W1–W3 | quiet time | Ada restores her run-1 vault backup in her browser profile, `/app/withdraw`, picks her 3 swept notes, recipient = the forward address (3 unshields) | relayer | 343,698 × 3 = 1,031,094 |
| W4 | after W1–W3 | the forward address sends the 3 tUSD8 to the deployer (builder's terminal) | forward address | 57,583 |
| R0 | ≥ 12 h later | 1 tUSD8 to Acme Studio (demo) `0xA1ddEB46A1060C8970E68C3dA34427B1a7B91D4b` (builder's terminal) | deployer | 62,383 (run 1 actual) |
| R1 | run 2 | Acme, `/app/pay` with the demo payer's wallet: gasless deposit (signs EIP-3009 only) | relayer | 1,346,538 |
| R2–R7 | run 2 | Acme pays Ada 0.5, 0.3 and 0.2 tUSD8 (signs each vouch; Ada's receive tag pasted from her `/app/inbox`), a sealed memo after each | relayer | 2,766,976 × 3 + 44,923 × 3 = 8,435,697 |
| R8–R10 | run 2 | Ada, `/app/inbox`: sweeps the 3 payments | relayer | 2,697,283 × 3 = 8,091,849 |
| R11 | run 2 | Ada, `/app/prove`: one proof in the browser with the final key, ≥ 1 tUSD8 for "Landlord Bola", 30 days; proving time read off the page | nobody | 0 |
| R12 | run 2 | Bola opens the link in his browser profile, types "Landlord Bola" → VALID; **Check on-chain** (eth_call, gas limit 400,000) | nobody | 0 |
| R13 | run 2 | Bola, **Record check** with the reader wallet (attest, gas limit 420,000) | reader | 267,017 |

Relayer total: 18,905,178 gas (batch 1,031,094 + run 17,874,084).

### Funding the builder sends (from the deployer)

| Account | Planned gas | Needed at start | Holds now | Send |
|---|---:|---:|---:|---:|
| relayer | 18,905,178 | 18,905,178 × 1.5 = 0.028357767, plus the 0.01 floor it never spends = 0.038357767 | 0.020979236 | **0.017378531 tQDAY** |
| reader | 267,017 | the node wants gas limit × price = 0.00042 up front; × 1.5 = 0.00063 | 0.000362983 | **0.000267017 tQDAY** |
| forward address | 57,583 | × 1.5 = 0.000086375 | 0 | **0.000086375 tQDAY** |
| Acme Studio (demo) | 0 (gasless) | 1 tUSD8 | 0 | **1 tUSD8** (R0, after the batch) |
| Ada (demo) | 0 | — (the relayer sends her txs) | — | 0 |

### Expected balances

| Point | Deployer tQDAY | Deployer tUSD8 | Relayer | Reader | Forward | Ada (pool) |
|---|---:|---:|---:|---:|---:|---:|
| now (block 3834199) | 0.943716971 | 2 | 0.020979236 | 0.000362983 | — | 3 (run 1) |
| after F1–F3 | 0.925922048 | 2 | 0.038357767 | 0.00063 | 0.000086375 | 3 |
| after the batch W1–W4 | 0.925922048 | 5 | ≈ 0.037326673 | 0.00063 | ≈ 0.000028792 | 0 |
| after R0 (1 tUSD8) | 0.925859665 | 4 | ≈ 0.037326673 | 0.00063 | ≈ 0.000028792 | 0 |
| after run 2 (planned max gas) | 0.925859665 | 4 | ≥ 0.019452589 | ≈ 0.000362983 | ≈ 0.000028792 | 1 |

The deployer stays ≥ 0.5 tQDAY and ≥ 2 tUSD8 at every point. The forward address keeps ≈ 0.000029 tQDAY of dust
(sending it back would cost as much gas as it holds). With run 1's actual gas (17,420,764 for the run), the relayer
would end near 0.0199. Nothing above has been sent.

### Re-read before funding (2026-11-23, block 3883921): unchanged
Read from the chain with `cast balance` / `balanceOf` / `nonce` at one block: deployer 0.943716971 tQDAY, 2 tUSD8
(nonce 24); relayer 0.020979236 (nonce 10); reader 0.000362983 (nonce 1); Acme Studio (demo) 0 / 0 (nonce 0); forward
address 0 / 0 (nonce 0). Gas price 1 gwei. tUSD8 not paused; neither the forward address nor the deployer blacklisted.
Every balance equals the plan's "now" row, so the funding amounts above stand unchanged.

Forward address (keystore `shaida-forward`, made 2026-11-23 like the others: random password in
`~/.config/shaida/shaida-forward.password`, both files mode 600, nothing in the repo):
**`0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0`** (the keystore decrypts to this address).
The forward address is public on both sides (funded by the deployer in F3, forwards to it in W4), so it does not hide
who receives the batch; it keeps the deployer out of the unshields themselves. The batch's privacy comes from its
timing (D28).

### Browser setup (both checklists)
One vault per site and chain lives in the browser (`localStorage` key `shaida:vault:44005`), so **Ada and Acme need
different Chrome profiles**, or Acme's notes would land in Ada's vault:
- **Profile "Shaida wallets (demo)"**: the wallet extension holding only Acme Studio (demo) `0xA1dd…91D4b` (keystore
  `shaida-payer-demo`) and Bola's reader `0xbed9…785E` (keystore `shaida-reader`), with Aevum testnet added (chain
  44005, RPC https://rpc-test.qday.info, symbol tQDAY). Acme's vault and Bola's tab live here.
- **Profile "Shaida Ada (demo)"**: no extension, no wallet. Ada's vault only.
- In both: DevTools → device toolbar → Dimensions 390 × 844. Screenshots: DevTools ⋮ → **Capture full size
  screenshot**, saved under the name given, into `evidence/ui-44005/`.
- Stop at the first red error box or `TxOutcomeUnknown`, screenshot it, and send it to the agent. Never press a button
  twice and never reload in the middle of a step: a sent request is checked by hash, never resent.
- After each step, send the agent the tx hashes the page or terminal shows; the agent checks each receipt and the
  balances against the table below before you go on.

Proving time shows in one place only: the **Proving** row of the link card on `/app/prove` (R11: "x.x s in this
browser (1 proof)"). Deposit, pay, sweep and withdraw proofs are also made in the browser (Gloam's final keys), but
those pages show a step list and no time, so no proving time is recorded for them.

### Balances after each step (planned max gas; tQDAY unless marked)

| After | Deployer | Deployer tUSD8 | Relayer | Reader | Forward | Forward tUSD8 | Acme tUSD8 | Ada (pool) tUSD8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| now (block 3883921) | 0.943716971 | 2 | 0.020979236 | 0.000362983 | 0 | 0 | 0 | 3 |
| F1 relayer +0.017378531 | 0.926317440 | 2 | 0.038357767 | 0.000362983 | 0 | 0 | 0 | 3 |
| F2 reader +0.000267017 | 0.926029423 | 2 | 0.038357767 | 0.000630000 | 0 | 0 | 0 | 3 |
| F3 forward +0.000086375 | 0.925922048 | 2 | 0.038357767 | 0.000630000 | 0.000086375 | 0 | 0 | 3 |
| W2a unshield 1.5 | 0.925922048 | 2 | 0.038014069 | 0.000630000 | 0.000086375 | 1.5 | 0 | 1.5 |
| W2b unshield 1 | 0.925922048 | 2 | 0.037670371 | 0.000630000 | 0.000086375 | 2.5 | 0 | 0.5 |
| W2c unshield 0.5 | 0.925922048 | 2 | 0.037326673 | 0.000630000 | 0.000086375 | 3 | 0 | 0 |
| W4 forward → deployer 3 tUSD8 | 0.925922048 | 5 | 0.037326673 | 0.000630000 | 0.000028792 | 0 | 0 | 0 |
| R0 deployer → Acme 1 tUSD8 | 0.925859665 | 4 | 0.037326673 | 0.000630000 | 0.000028792 | 0 | 1 | 0 |
| R2 deposit 1 | 0.925859665 | 4 | 0.035980135 | 0.000630000 | 0.000028792 | 0 | 0 (1 in Acme's note) | 0 |
| R3 pay 0.5 + memo | 0.925859665 | 4 | 0.033168236 | 0.000630000 | 0.000028792 | 0 | 0 | 0 (0.5 unswept) |
| R4 pay 0.3 + memo | 0.925859665 | 4 | 0.030356337 | 0.000630000 | 0.000028792 | 0 | 0 | 0 (0.8 unswept) |
| R5 pay 0.2 + memo | 0.925859665 | 4 | 0.027544438 | 0.000630000 | 0.000028792 | 0 | 0 | 0 (1 unswept) |
| R7 three sweeps | 0.925859665 | 4 | 0.019452589 | 0.000630000 | 0.000028792 | 0 | 0 | 1 |
| R8–R10 prove, VALID, Check on-chain | (no tx) | 4 | 0.019452589 | 0.000630000 | 0.000028792 | 0 | 0 | 1 |
| R11 attest | 0.925859665 | 4 | 0.019452589 | 0.000362983 | 0.000028792 | 0 | 0 | 1 |

Hard limits at every row: the deployer's lowest is 0.925859665 tQDAY (≥ 0.5) and its lowest tUSD8 is 2, from now
through W2c (≥ 2); after W4 it holds 5, then 4. Helpers stay payable: the relayer's lowest balance before a send is
0.022149872 (before the last sweep; it refuses below 0.01, and that sweep needs at most 3.1M gas = 0.0031 up front);
the reader holds 0.00063 ≥ the 0.00042 the node wants for the 420k attest; the forward address holds 0.000086375 ≥
the 0.00008 its 80,000 gas limit needs. Relayer daily budget (`RELAYER_DAILY_GAS_BUDGET` 30,000,000, counting gas
caps for txs in flight): the highest point is ≈ 18.9M (batch and run 2 on one UTC day, before the last sweep).
Actual gas is usually below these maxima (run 1's relayed gas was 17,420,764 against 17,874,084 planned), so the
agent records the real balances after each step and they will be a little higher than the table.

### Checklist A: funding (builder's terminal, before the batch)
`RPC=https://rpc-test.qday.info`. Each `cast send` asks for the keystore password (hidden prompt).
- [ ] F1 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xF4945dD57C8de1C637966179df5b631689901422 --value 0.017378531ether`
- [ ] F2 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xbed994a7fD0e7A49DAD09866e86817ccA6Ea785E --value 0.000267017ether`
- [ ] F3 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0 --value 0.000086375ether`
- [ ] agent: 3 receipts status 1, balances = rows F1–F3

### Checklist B: withdrawal batch (quiet time: ≥ 12 h after run 1, which ended 2026-11-22 10:52 UTC)
Profile "Shaida Ada (demo)", https://shaida.onrender.com. The backup is `~/.config/shaida/ada-live-run-1.vault.json`;
its passphrase is in `~/.config/shaida/ada-live-run-1.vault-passphrase` (copy it to the clipboard yourself, e.g.
`wl-copy < …` or `xclip -selection clipboard < …`; clear the clipboard after). Nobody else sees either.
- [ ] W0 open `/app/withdraw`. The vault box says **Create your vault** (a fresh profile). Paste the passphrase into
      **Passphrase**, open **Restore from a backup file**, choose the backup file (in the file picker, Ctrl+L and type
      the path; `~/.config` is hidden), click **Restore (uses the passphrase above)**. The bar shows "Vault open in
      this tab" → `390-00-vault-restored.png`
- [ ] W1 the page lists 3 notes, each "in the pool": 1.5, 1 and 0.5 tUSD8; the warning **"Withdrawals are public and
      reveal their amounts."** is visible. Tick all 3; in the recipient field ("0x… a fresh address you control") paste
      `0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0`. The button reads **Withdraw 3 notes (3 tUSD8)** →
      `390-01-withdraw-picked.png` (warning, ticks, address and button in view)
- [ ] W2 click **Withdraw 3 notes (3 tUSD8)** once. Each note goes "withdrawing…" → "withdrawn to 0xe317E3…"
      (3 unshield proofs in the browser, sent one after another by the relayer; a few minutes in all). When all 3
      say withdrawn → `390-02-withdrawn.png`. Send the agent the 3 tx hashes if shown (otherwise the agent finds them
      by the forward address). Agent: 3 unshields status 1, forward address holds 3 tUSD8, rows W2a–W2c.
- [ ] W3 still in Ada's tab: **Export backup** (top bar) → save as `~/.config/shaida/ada-after-batch.vault.json`,
      then `chmod 600` it. It records the withdrawals; it is the backup to use from now on.
- [ ] W4 terminal: `cast send --legacy --gas-price 1gwei --gas-limit 80000 --rpc-url $RPC --account shaida-forward 0x456569838f1d43009A91ebA4263147Afd7233483 'transfer(address,uint256)' 0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698 3000000`
      (password: `~/.config/shaida/shaida-forward.password`, or add `--password-file` with that path). Agent: status 1,
      deployer 5 tUSD8, row W4.

### Checklist C: run 2 (≥ 12 h after W2, and on a later calendar day than run 1)
Run 1's payments still count after the batch (a withdrawal does not touch the ledger's V and S leaves), so the proof's
period must hold only run 2's day: run 2 has to fall on a later date than 22 Nov, and R10 sets both dates to it.
- [ ] R0 terminal: `cast send --legacy --gas-price 1gwei --gas-limit 90000 --rpc-url $RPC --account shaida-deployer 0x456569838f1d43009A91ebA4263147Afd7233483 'transfer(address,uint256)' 0xA1ddEB46A1060C8970E68C3dA34427B1a7B91D4b 1000000`
      Agent: Acme 1 tUSD8, deployer 4, row R0.
- [ ] R1 Ada's profile, `/app/inbox`: **Unlock** with her passphrase (the restored vault is still there). Under the
      receive address (the same `gloamr1.…` as run 1) click **Copy address** → `390-03-ada-receive-tag.png`
- [ ] R2 wallets profile, `/app/pay`: **Create your vault** with a new passphrase for Acme (8+ characters; keep it
      outside the repo, mode 600). **Paying as → Your wallet → Connect Wallet**, pick Acme's account. The panel shows
      Acme's address, **Registered payer: yes, #1** and **Public tUSD8: 1** → `390-04-pay-ready.png`.
      In **1 · Deposit (gasless)** type `1`, click **Deposit privately**, sign the ReceiveWithAuthorization in the
      wallet (a signature, no gas) → `390-05-deposit-signed.png`; when every step is ticked and **Private balance**
      shows 1 tUSD8 → `390-06-deposit-mined.png`. Then **Export backup** (Acme's note exists only in this browser).
- [ ] R3 **2 · Pay a recipient**: paste Ada's receive address, amount `0.5`, private note `Invoice 1 (demo)`, click
      **Pay privately**, sign the Vouch in the wallet. Wait until all 6 steps are ticked (the sealed memo is the last)
      → `390-07-pay1.png`
- [ ] R4 the same with `0.3`, `Invoice 2 (demo)` → `390-08-pay2.png`
- [ ] R5 the same with `0.2`, `Invoice 3 (demo)` → `390-09-pay3.png` (private balance 0). Wait a minute between pays
      if the page says `RateLimited` (6 payer calls a minute); nothing is sent when it does.
- [ ] R6 Ada's profile, `/app/inbox`: the 3 new payments appear (Invoice 1–3 (demo), 0.5 / 0.3 / 0.2) beside run 1's
      3 swept ones → `390-10-inbox-seen.png`
- [ ] R7 click **Sweep all 3** once; wait until all 3 show swept → `390-11-inbox-swept.png`. Then **Export backup** →
      `~/.config/shaida/ada-after-run-2.vault.json`, `chmod 600`.
- [ ] R8 `/app/prove`: **Payments a proof can count** lists 6 (run 1's 3 and run 2's 3) → `390-12-prove-countable.png`
- [ ] R9 in **Make a proof link**: **From** and **To** = run 2's date (both the same day; From defaults to 22 Nov, so
      change it); **At least (tUSD8)** `1`; **Rounding step** 1 tUSD8; **Reader's name** `Landlord Bola`; **Expires**
      left at the 30-day default → `390-13-prove-form.png`
- [ ] R10 **Build proof link** once (one proof, final income key, in this tab). The link card appears; its **Proving**
      row gives the time ("x.x s in this browser (1 proof)") → `390-14-proved.png` (Proving row in view). Copy the
      link. Note `chrome://version` (Chrome version) for the agent; the agent records the time with this machine.
- [ ] R11 wallets profile, new tab: paste the link, type `Landlord Bola`, **Verify** → **VALID**, at least 1 tUSD8,
      3 payments, run 2's date → `390-15-verify-valid.png`
- [ ] R12 **Check on-chain** → passes ("IncomeVerifier.check passed … Nothing was sent.") → `390-16-onchain-check.png`
- [ ] R13 switch the wallet to Bola's reader `0xbed9…785E`, **Record check**, confirm the tx (gas limit 420,000) →
      "Recorded" → `390-17-attested.png`. Agent: IncomeProofChecked(threshold 1000000, count 3), reader balance, row R11.
- [ ] agent: balances after the run read from the chain; evidence/live-44005-run2.md from the chain; CLAIMS CL33
      updated only from what this run shows (acts 2–6 clicked in the hosted UI), CL40 for the withdrawal on 44005.
