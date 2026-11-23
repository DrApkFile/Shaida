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
| F3 | before the batch | 0.000086375 tQDAY to a fresh forward address (new keystore `shaida-forward`, made by the builder) | deployer | 21,000 |
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

### Checklist for the builder (run 2, hosted UI, 390 px)

Chrome: a separate profile holding only the demo wallets (Acme Studio (demo) `0xA1dd…91D4b` and Bola's reader
`0xbed9…785E`), DevTools device mode at 390 × 844, the Aevum testnet network (chain 44005, RPC
https://rpc-test.qday.info, symbol tQDAY) added to the wallet. Ada needs no wallet. Every screenshot goes to
evidence/ui-44005/ with the name given; send the coding agent each tx hash the page or terminal shows, and the agent
checks it on chain and records it. Stop at the first red error or `TxOutcomeUnknown` and report it: never resend.

**Before the batch** (builder's terminal; agent checks each receipt)
- [ ] F1 deployer → relayer 0.017378531 tQDAY
- [ ] F2 deployer → reader 0.000267017 tQDAY
- [ ] F3 make keystore `shaida-forward`; deployer → forward address 0.000086375 tQDAY
- [ ] agent: balances read from the chain match "after F1–F3"

**Withdrawal batch** (quiet time, ≥ 12 h after run 1; Ada's tab, no wallet)
- [ ] W0 `/app`: restore Ada's run-1 vault backup with its passphrase → `390-00-vault-restored.png`
- [ ] W1 `/app/withdraw`: 3 swept notes listed, all 3 picked, recipient = forward address, the "withdrawals are
      public" warning visible → `390-01-withdraw-picked.png`
- [ ] W2 withdraw; wait until all 3 show as sent and mined → `390-02-withdrawn.png` (agent: 3 unshields, 3 tUSD8 at
      the forward address)
- [ ] W3 terminal: forward address → deployer 3 tUSD8 (agent: deployer 5 tUSD8)

**Run 2** (≥ 12 h after the batch)
- [ ] R0 terminal: deployer → Acme 1 tUSD8 (agent: Acme 1 tUSD8, deployer 4)
- [ ] R1 Ada's tab `/app/inbox`: copy her receive tag → `390-03-ada-receive-tag.png`
- [ ] R2 Acme's tab `/app/pay`: connect Acme's wallet, gasless deposit of 1 tUSD8 (sign only) → `390-04-deposit-signed.png`,
      then mined → `390-05-deposit-mined.png`
- [ ] R3 pay Ada 0.5 tUSD8 with memo "Invoice 1 (demo)" (sign the vouch) → `390-06-pay1.png`
- [ ] R4 pay Ada 0.3 tUSD8, memo "Invoice 2 (demo)" → `390-07-pay2.png`
- [ ] R5 pay Ada 0.2 tUSD8, memo "Invoice 3 (demo)" → `390-08-pay3.png`
- [ ] R6 Ada's tab `/app/inbox`: 3 payments seen → `390-09-inbox-seen.png`; sweep all 3 → `390-10-inbox-swept.png`
- [ ] R7 `/app/prove`: run 2's 3 payments, threshold 1 tUSD8, reader "Landlord Bola", 30 days; prove; the card shows the
      proving time → `390-11-proved.png`; copy the link (agent records the proving time with the machine and browser
      version: `chrome://version`)
- [ ] R8 Bola's tab: open the link, type "Landlord Bola" → VALID → `390-12-verify-valid.png`
- [ ] R9 **Check on-chain** → passes → `390-13-onchain-check.png`
- [ ] R10 **Record check** with the reader wallet → mined → `390-14-attested.png` (agent: IncomeProofChecked
      threshold 1000000, count 3)
- [ ] agent: balances after; evidence/live-44005-run2.md from the chain; CLAIMS CL33 updated only from what this run shows
