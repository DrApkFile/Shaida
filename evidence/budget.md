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
- **Where withdrawals go (changed 2026-11-25, D32 F5):** the privacy audit followed run 1's withdrawal one hop: the
  forward address sent the 3 tUSD8 to the deployer, which had funded the payer, so both ends of the demo showed as one
  party (evidence/privacy-audit.md, A6). From now on a withdrawal goes only to an address with no tUSD8 or tQDAY
  link to the payer or to whoever funded the payer: not the deployer, not the payer, not an address either of them
  funded or will pay. Its gas money comes from the relayer's withdrawal itself (no tQDAY needed to receive) or from a
  source with no link to them. The W4 forward to the deployer (2026-11-23) stays on record as done before this rule.
  With split sweeps on (F4), the two notes of a payment are withdrawn at different times, never in one batch.

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
| 2026-11-23, block 3884966 | F1: fund the relayer with 0.017378531 tQDAY (sent by the builder) [`0x33cd209b…`](https://explorer-test.qday.info/tx/0x33cd209be4fed5331bd1b3e7535a789899df8941b9bc4a4e3f5341d36c1efb4d) | 1 | 21,000 | 0.017399531 | 0.926317440 | 2 |
| 2026-11-23, block 3884979 | F2: fund the reader with 0.000267017 tQDAY (sent by the builder) [`0x56f24a01…`](https://explorer-test.qday.info/tx/0x56f24a015e8b8c32c521949010b0388e0d7b6fda152f1e7ffc04c2b515458384) | 1 | 21,000 | 0.000288017 | 0.926029423 | 2 |
| 2026-11-23, block 3884993 | F3: fund the forward address `0xe317E304…8Ee7A0` with 0.000086375 tQDAY (sent by the builder) [`0x017bd36d…`](https://explorer-test.qday.info/tx/0x017bd36d337f41019b222f579c9e9055244cc09013c73b4c90282d878bc107a1) | 1 | 21,000 | 0.000107375 | 0.925922048 | 2 |
| 2026-11-23, blocks 3885363–3885380 | withdrawal batch W2 (driven by the agent in headless Chromium on the live site, at the builder's request): Ada (demo) withdraws her 3 swept notes, 1.5 / 1 / 0.5 tUSD8, to the forward address; relayer sends `pool.unshield` ×3: [`0x379cab95…`](https://explorer-test.qday.info/tx/0x379cab9532d728dfa176b95d08ebc029ac679dc6b40c10f04af63ba8bc6a62ac) 343,698 · [`0x4336f050…`](https://explorer-test.qday.info/tx/0x4336f050b1aff441d4c11abf4bf453b6de61fedb03943d209b9d3b545e57f164) 326,598 · [`0x30b85e2e…`](https://explorer-test.qday.info/tx/0x30b85e2ed28dd654a49adb88c32923601ff3bc9de944f87e5eca7d708e1fe338) 317,010 | 3 | 987,306 | 0.000987306 (relayer) | 0.925922048 | 2 |
| 2026-11-23, block 3886253 | W4: the forward address `0xe317E304…8Ee7A0` sends the 3 tUSD8 to the deployer (sent by the builder, keystore `shaida-forward`) [`0x614f3801…`](https://explorer-test.qday.info/tx/0x614f380133d4f78093c0f03d0117afd3870e6170b0013018d0f171d42671da4d) | 1 | 40,483 | 0.000040483 (forward address) | 0.925922048 | 5 |
| 2026-11-23, block 3939866 | R0: 1 tUSD8 to Acme Studio (demo) (sent by the builder) [`0x948664bc…`](https://explorer-test.qday.info/tx/0x948664bc7186149cb2070770d21bfc46a9e99faebeab078c9fa176eac2b86d79) | 1 | 62,383 | 0.000062383 | 0.925859665 | 4 |
| 2026-11-23, blocks 3942008–3947708 | live run 2, clicked by the builder in Firefox on the hosted site: 10 relayed txs (relayer pays 0.017257327) and 1 attest (reader pays 0.000267065); per-tx rows in [evidence/live-44005-run2.md](live-44005-run2.md) | 11 | 17,524,392 | 0.017524392 (helpers) | 0.925859665 | 4 |
| 2026-11-23, block 3955537 | B1: fund the underwriting bot `0x5B145B46…77EE2C` with 0.0013 tQDAY, its daily cap of 3 attests × 420,000 gas × 1 gwei (sent by the builder) [`0xefec6eb2…`](https://explorer-test.qday.info/tx/0xefec6eb206fe854ede375aa3207e45481f345749cd69fb6808735a19af157e87) | 1 | 21,000 | 0.001321 | 0.924538665 | 4 |
| 2026-11-24, block 3959087 | B2: the bot records the live check's approval, `IncomeVerifier.attest` from `0x5B145B46…77EE2C` (recording switched on by the builder; [evidence/underwrite-live-44005.md](underwrite-live-44005.md)) [`0xc2caccd4…`](https://explorer-test.qday.info/tx/0xc2caccd4db89f8b0dccc0d67e7cf7df0491fec304248b2bc58c8fe137075a415) | 1 | 267,053 | 0.000267053 (bot) | 0.924538665 | 4 |

Every row above comes from receipts (`gasUsed × effectiveGasPrice`) and `eth_getBalance` / `balanceOf` (deploy rows at block
3811143; funding rows at block 3822171, when the relayer held 0.0384 tQDAY and the reader 0.00063 tQDAY, as sent).
"tQDAY spent" on a funding row is the value sent plus its gas; the value is still ours, on the helper account.
The registration row has no balance of its own because the builder sent both deployer transactions before the script
read balances; the transfer row's balances are read after both (block 3826515 onward). Run 1's helper spend comes out
of the 0.0384 and 0.00063 already sent, not out of the deployer.
F1–F3 (2026-11-23): each receipt status 1, legacy (type 0), 1 gwei, 21,000 gas, from the deployer at nonces 24, 25
and 26, value exactly as planned. Balances read at block 3885060, after all three: deployer 0.925922048 tQDAY and 2 tUSD8
(nonce 27), relayer 0.038357767, reader 0.00063, forward 0.000086375 (nonce 0): equal to the plan's "F3" row to the wei.
The per-row deployer balances for F1 and F2 are derived from the receipts (value + gas).
Withdrawal batch (2026-11-23 03:20–03:21 UTC, 16.5 h after run 1): the 3 receipts are status 1, legacy (type 0),
1 gwei, from the relayer (nonces 10, 11, 12) to the pool, selector `0x67cca6c5` = `unshield(bytes,bytes32,bytes32,address,address,uint256)`;
each emitted a tUSD8 Transfer from the pool to `0xe317E304…8Ee7A0` of 1,500,000 / 1,000,000 / 500,000. Balances at
block 3885406: relayer 0.037370461 tQDAY (nonce 13; plan ≈ 0.037326673 at the 343,698 maximum), forward 0.000086375
tQDAY and 3 tUSD8 (nonce 0), pool 0 tUSD8, deployer 0.925922048 tQDAY and 2 tUSD8 (unchanged). Browser report and
screenshots: [evidence/ui-44005/report-withdraw-390.md](ui-44005/report-withdraw-390.md).
W4 (block 3886253): status 1, legacy, 1 gwei, from the forward address (nonce 0) to tUSD8, one Transfer of 3,000,000 to
the deployer; 40,483 gas (planned 57,583, the fork's). Balances at block 3886294: deployer 0.925922048 tQDAY and
5 tUSD8 (nonce 27), forward 0.000045892 tQDAY and 0 tUSD8 (nonce 1; dust, as planned), relayer 0.037370461, reader
0.00063, Acme Studio (demo) 0 / 0. The batch is done; hard limits held at every step (deployer lowest 0.925922048
tQDAY and 2 tUSD8). Next: R0, at least 12 h after W2 (from 2026-11-23 15:21 UTC) and on a later calendar day than run 1.
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
| underwriting bot (D30; generated 2026-11-23) | `0x5B145B460924413951cc424B5D3D7241eC77EE2C` | Foundry keystore `shaida-bot`; the server gets it only as `UNDERWRITE_BOT_PRIVATE_KEY`, used only for `IncomeVerifier.attest` when `UNDERWRITE_RECORD=on` |

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

### Run 2, 2026-11-23, blocks 3939866–3947708: passed (clicked by the builder in the hosted UI)

Per-tx hashes, explorer links, gas and balances before and after, and what the browser showed:
[evidence/live-44005-run2.md](live-44005-run2.md) (written by `node tools/live-run2-report.mjs` from the chain).
Screens: evidence/ui-44005/390-03 … 390-14 and 1247-15 … 1247-17.

| | Planned | Actual |
|---|---:|---:|
| tUSD8 transfer gas (R0) | 62,383 | 62,383 |
| relayed gas (deposit, 3 pays, 3 memos, 3 sweeps) | 17,874,084 | 17,257,327 |
| attest gas | 267,017 | 267,065 |
| proving time (1 proof, final income key) | read off the page | 16.2 s, Firefox 157.0.1 at 390 px, Intel Core i3 M 370, 7.5 GB RAM |

Balances read from the chain at block 3947916, after the run:

| Account | tQDAY | tUSD8 | Expected (plan) |
|---|---:|---:|---|
| deployer | 0.925859665 | 4 | 0.925859665 / 4 |
| relayer | 0.020113134 | 0 | ≥ 0.019496377 (planned maxima) |
| reader | 0.000362935 | 0 | ≥ 0.000363 at 267,017; the attest used 48 gas more |
| Acme Studio (demo) | 0 | 0 | 0 / 0 |
| pool | — | 1 | 1 (Ada's 3 swept notes of run 2: 0.5 / 0.3 / 0.2) |

Limits held at every step (deployer lowest 0.925859665 tQDAY and 4 tUSD8; relayer lowest 0.020113134, above its 0.01
floor). Changes from checklist C, all recorded in the run file: Firefox 157.0.1 instead of Chrome; Ada in the builder's
normal profile (restored from `ada-after-batch.vault.json`, since the batch's headless profile was gone), Acme and Bola
in profile `shaida-acme-bola`; 390-05 not taken and 390-04 taken after the deposit (Public tUSD8 0); R11–R13 screens taken at 1,247 px (named so); /app/prove reset its
form every ~15 s and was fixed and redeployed mid-run (`5120b24`) before R9 was redone. No withdrawal after the run.

## Plan for live run 2: entirely through the hosted UI (run 2026-11-23: see Runs)

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
- [x] F1 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xF4945dD57C8de1C637966179df5b631689901422 --value 0.017378531ether`
- [x] F2 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xbed994a7fD0e7A49DAD09866e86817ccA6Ea785E --value 0.000267017ether`
- [x] F3 `cast send --legacy --gas-price 1gwei --gas-limit 21000 --rpc-url $RPC --account shaida-deployer 0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0 --value 0.000086375ether`
- [x] agent: 3 receipts status 1, balances = rows F1–F3 (block 3885060; tx hashes in the ledger above)

### Checklist B: withdrawal batch (quiet time: ≥ 12 h after run 1, which ended 2026-11-22 10:52 UTC)
Rule for every future batch (D32 F5, 2026-11-25): before W1, check that the recipient address has no transfer from or
to the payer, the deployer or any address they funded (explorer, address page); never forward to the deployer or the
payer. W4 below broke this rule before it existed (the audit found it), and is kept as it happened.
W0–W3 done 2026-11-23 by the agent with `node tools/ui-withdraw-live.mjs` (headless Chromium, 390 px, the live site
at f83e4ee), at the builder's request: the builder allowed the agent to read Ada's demo vault passphrase and backup
for this task only; the passphrase went to the page over CDP only. Updated backup:
`~/.config/shaida/ada-after-batch.vault.json` (mode 600). W4 is the builder's.
Profile "Shaida Ada (demo)", https://shaida.onrender.com. The backup is `~/.config/shaida/ada-live-run-1.vault.json`;
its passphrase is in `~/.config/shaida/ada-live-run-1.vault-passphrase` (copy it to the clipboard yourself, e.g.
`wl-copy < …` or `xclip -selection clipboard < …`; clear the clipboard after). Nobody else sees either.
- [x] W0 open `/app/withdraw`. The vault box says **Create your vault** (a fresh profile). Paste the passphrase into
      **Passphrase**, open **Restore from a backup file**, choose the backup file (in the file picker, Ctrl+L and type
      the path; `~/.config` is hidden), click **Restore (uses the passphrase above)**. The bar shows "Vault open in
      this tab" → `390-00-vault-restored.png`
- [x] W1 the page lists 3 notes, each "in the pool": 1.5, 1 and 0.5 tUSD8; the warning **"Withdrawals are public and
      reveal their amounts."** is visible. Tick all 3; in the recipient field ("0x… a fresh address you control") paste
      `0xe317E3049cDB48e0915b095D5B3CFa689f8Ee7A0`. The button reads **Withdraw 3 notes (3 tUSD8)** →
      `390-01-withdraw-picked.png` (warning, ticks, address and button in view)
- [x] W2 click **Withdraw 3 notes (3 tUSD8)** once. Each note goes "withdrawing…" → "withdrawn to 0xe317E3…"
      (3 unshield proofs in the browser, sent one after another by the relayer; a few minutes in all). When all 3
      say withdrawn → `390-02-withdrawn.png`. Send the agent the 3 tx hashes if shown (otherwise the agent finds them
      by the forward address). Agent: 3 unshields status 1, forward address holds 3 tUSD8, rows W2a–W2c.
- [x] W3 still in Ada's tab: **Export backup** (top bar) → save as `~/.config/shaida/ada-after-batch.vault.json`,
      then `chmod 600` it. It records the withdrawals; it is the backup to use from now on.
- [x] W4 terminal: `cast send --legacy --gas-price 1gwei --gas-limit 80000 --rpc-url $RPC --account shaida-forward 0x456569838f1d43009A91ebA4263147Afd7233483 'transfer(address,uint256)' 0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698 3000000`
      (password: `~/.config/shaida/shaida-forward.password`, or add `--password-file` with that path). Agent: status 1,
      deployer 5 tUSD8, row W4.

### Checklist C: run 2 (≥ 12 h after W2, and on a later calendar day than run 1)
Run 1's payments still count after the batch (a withdrawal does not touch the ledger's V and S leaves), so the proof's
period must hold only run 2's day: run 2 has to fall on a later date than 22 Nov, and R10 sets both dates to it.
- [x] R0 terminal: `cast send --legacy --gas-price 1gwei --gas-limit 90000 --rpc-url $RPC --account shaida-deployer 0x456569838f1d43009A91ebA4263147Afd7233483 'transfer(address,uint256)' 0xA1ddEB46A1060C8970E68C3dA34427B1a7B91D4b 1000000`
      Agent: Acme 1 tUSD8, deployer 4, row R0.
- [x] R1 Ada's profile, `/app/inbox`: **Unlock** with her passphrase (the restored vault is still there). Under the
      receive address (the same `gloamr1.…` as run 1) click **Copy address** → `390-03-ada-receive-tag.png`
- [x] R2 wallets profile, `/app/pay`: **Create your vault** with a new passphrase for Acme (8+ characters; keep it
      outside the repo, mode 600). **Paying as → Your wallet → Connect Wallet**, pick Acme's account. The panel shows
      Acme's address, **Registered payer: yes, #1** and **Public tUSD8: 1** → `390-04-pay-ready.png`.
      In **1 · Deposit (gasless)** type `1`, click **Deposit privately**, sign the ReceiveWithAuthorization in the
      wallet (a signature, no gas) → `390-05-deposit-signed.png`; when every step is ticked and **Private balance**
      shows 1 tUSD8 → `390-06-deposit-mined.png`. Then **Export backup** (Acme's note exists only in this browser).
- [x] R3 **2 · Pay a recipient**: paste Ada's receive address, amount `0.5`, private note `Invoice 1 (demo)`, click
      **Pay privately**, sign the Vouch in the wallet. Wait until all 6 steps are ticked (the sealed memo is the last)
      → `390-07-pay1.png`
- [x] R4 the same with `0.3`, `Invoice 2 (demo)` → `390-08-pay2.png`
- [x] R5 the same with `0.2`, `Invoice 3 (demo)` → `390-09-pay3.png` (private balance 0). Wait a minute between pays
      if the page says `RateLimited` (6 payer calls a minute); nothing is sent when it does.
- [x] R6 Ada's profile, `/app/inbox`: the 3 new payments appear (Invoice 1–3 (demo), 0.5 / 0.3 / 0.2) beside run 1's
      3 swept ones → `390-10-inbox-seen.png`
- [x] R7 click **Sweep all 3** once; wait until all 3 show swept → `390-11-inbox-swept.png`. Then **Export backup** →
      `~/.config/shaida/ada-after-run-2.vault.json`, `chmod 600`.
- [x] R8 `/app/prove`: **Payments a proof can count** lists 6 (run 1's 3 and run 2's 3) → `390-12-prove-countable.png`
- [x] R9 in **Make a proof link**: **From** and **To** = run 2's date (both the same day; From defaults to 22 Nov, so
      change it); **At least (tUSD8)** `1`; **Rounding step** 1 tUSD8; **Reader's name** `Landlord Bola`; **Expires**
      left at the 30-day default → `390-13-prove-form.png`
- [x] R10 **Build proof link** once (one proof, final income key, in this tab). The link card appears; its **Proving**
      row gives the time ("x.x s in this browser (1 proof)") → `390-14-proved.png` (Proving row in view). Copy the
      link. Note `chrome://version` (Chrome version) for the agent (run 2 used Firefox 157.0.1: 16.2 s); the agent records the time with this machine.
- [x] R11 wallets profile, new tab: paste the link, type `Landlord Bola`, **Verify** → **VALID**, at least 1 tUSD8,
      3 payments, run 2's date → `390-15-verify-valid.png`
- [x] R12 **Check on-chain** → passes ("IncomeVerifier.check passed … Nothing was sent.") → `390-16-onchain-check.png`
- [x] R13 switch the wallet to Bola's reader `0xbed9…785E`, **Record check**, confirm the tx (gas limit 420,000) →
      "Recorded" → `390-17-attested.png`. Agent: IncomeProofChecked(threshold 1000000, count 3), reader balance, row R11.
- [x] agent: balances after the run read from the chain; evidence/live-44005-run2.md from the chain; CLAIMS CL33
      updated only from what this run shows (acts 2–6 clicked in the hosted UI), CL40 for the withdrawal on 44005.
