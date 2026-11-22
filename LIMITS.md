# LIMITS

What Shaida does not protect against, and what it depends on. Each item names the evidence.

## tUSD8 issuer powers (spike S9, measured 2026-11-20)
Source: `contracts/test/fork/S9Tusd8AdminSurface.t.sol`, run with `make test-fork` against a fork of
the live token. tUSD8 is a FiatTokenV2_2 behind an upgradeable proxy.

| Power | Held by (live, 2026-11-20) | Effect on Shaida |
|---|---|---|
| Pause | `pauser` (EOA `0x94ef5dB164e7BBf4149e298c5588C035Ea8E9C05`) | Deposits, gasless deposits and unshields all revert while paused. Private transfers and sweeps inside the pool still work (they move no tokens), so income proofs can still be built. |
| Blacklist a payer | `blacklister` (same EOA) | That payer can no longer deposit, by either path. `approve` still succeeds, so the app checks `isBlacklisted` before asking for a signature. |
| Blacklist the pool | `blacklister` | **Every note in the pool is frozen**: no unshield can pay out. |
| Blacklist a recipient | `blacklister` | That address cannot receive an unshield; the recipient can unshield to another address. |
| Replace the token code | proxy admin (EOA `0x6032E6e660d5C05846B7F305F8A186fA59C6fb88`) | Any behaviour above can change at any time, in one transaction. |

These are trust assumptions about the token issuer, not bugs Shaida can fix. Listed as "Not defended" in PRD §8.

## Payments that can go uncounted (by design of Gloam's open pool)
Gloam's pool accepts `transfer` from any sender. If someone copies a pending `vouchedPay` or `sweep` from the mempool
and sends the same proof to the pool directly first, the note is spent without a vouch or sweep leaf in `ShaidaLedger`.
This never creates a false leaf (only the ledger writes V and S), so it cannot inflate income; it can only leave a
real payment out of every income proof. Shown in `test_GAS_baseline_same_payment_sent_to_the_pool_directly`
(a direct transfer adds no leaf).
- Copied `vouchedPay`: repairable. The payer calls `lateVouch(paymentCommitment)` (or signs `lateVouchFor`); the
  payment then counts, dated by the `lateVouch` (D9).
- Copied `sweep`: not repairable. The swept funds still reach the recipient's sweep note, but that payment can never
  count in an income proof. A repair would let anyone fake swept income (D9).

### Can a front-runner see pending transactions? (probed 2026-11-20, https://rpc-test.qday.info)
| Method | Reply |
|---|---|
| `txpool_content` | exists: `{"baseFee":{},"pending":{},"queued":{}}` |
| `txpool_status` | exists: `{"baseFee":"0x0","pending":"0x0","queued":"0x0"}` |
| `txpool_inspect` | `-32601 the method txpool_inspect does not exist/is not available` |
| `eth_pendingTransactions` | `-32601 the method eth_pendingTransactions does not exist/is not available` |
| `eth_newPendingTransactionFilter` | exists: returns a filter id (e.g. `0x9205000000000000875402d3e494a4e5`) |

Follow-up (10:10 UTC): one new pending-tx filter polled with `eth_getFilterChanges` and `txpool_content` every 2 s,
15 times (blocks 3,653,746 → 3,653,785). The filter returned 0 hashes, no errors, and the txpool stayed empty, while 1
transaction was mined in that window. **Inconclusive:** the pending-tx methods exist, but one transaction is too few to
tell whether this node shows pending transactions or the transaction reached the chain through another node. We did
not send a transaction of our own to test it. Shaida assumes front-running is possible (D9).

## What a bundle of proofs shows (D12)
A period with more than 4 payments is proved by several proofs (at most 8, so at most 32 payments). Each proof's
public signals are visible to the reader, so a bundle shows more than one proof would:
- each proof's leaf range, threshold share and count. The boundaries fall halfway between the last vouch leaf of one
  proof and the first of the next, so they narrow where payments sit among the public `Vouched` events;
- for a proof whose sum (rounded down to the share step) is below the even share of the threshold: that sum, rounded
  down to the step (D13). The step is 1 tUSD8 by default, so such a share narrows the proof's sum to a 1 tUSD8 window
  [share, share + 1 tUSD8); a coarser step (e.g. 10 tUSD8) widens the window and needs a threshold that is a multiple
  of it. Shares are never the unrounded sum, so a share never pins a sum to the base unit. Other shares show only
  that their proof's sum is at least the share.
Not shown: amounts per payment, payer per payment, the recipient's notes. A period of more than 32 payments must be
split into shorter periods (`NotEnoughSlots`).

## The reader's name binds intent, not identity (D27)
The reader name normalises (trim, case, spaces), so it binds intent, not identity: anyone with the link who types
"Landlord Bola" gets VALID. The link is bound to `readerIdHash = Poseidon(3, length, name bytes)` of the normalised
name; nothing checks who is typing it. This stops a link made for one reader being presented as made for another; it
does not keep the link secret and does not authenticate the reader. Keep the link private; it expires on the date in
it. The server never receives the name (it is typed on `/v`). A reader code that does authenticate the reader is on
ROADMAP.md.

## Withdrawals are public (pool.unshield)
withdrawals are public and reveal their amounts. A withdrawal (`/app/withdraw`, relayer route `unshield`) spends a
swept note in full and sends tUSD8 out of the pool in one public transaction: the amount, the recipient address and
the time are visible to anyone. Withdrawing right after a demo run would show that run's payment amounts (1.5, 1,
0.5 tUSD8) next to the payments' time. So the app never withdraws by itself, and on Aevum testnet we withdraw only when
the deployer's tUSD8 would otherwise fall below 2, batching the notes at a quiet time to a fresh address we control,
which then forwards the tUSD8 (evidence/budget.md). The nullifier still keeps a withdrawal unlinkable to the note's
payment and sweep, but amounts that match a known run link it by value. The income proof is not affected: it reads
the ledger's V and S leaves, which a withdrawal does not touch (evidence/withdraw-fork.md).
