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
it. The server never receives the name (it is typed on `/v`). This holds for every **name-only** link: all links made
before D35/D36 and new links made without a code. The UI labels them "Name only: anyone with this link and the name
can view it".

## Reader codes: a shared secret, not a login (D36)
A **code-protected** link binds `Poseidon(5, nameHash, Poseidon(code))`, where the code is 80 random bits the reader
made on `/v` and gave the holder. The link and the name are no longer enough. What is left:
- **Offline guessing.** Anyone with the link and the name can try codes without asking anyone: each guess is two
  Poseidon hashes compared with the link's reader id. Measured: 439 guesses per second on one core of this machine
  (Intel i3 M 370, poseidon-lite). For a random 80-bit code that is 4.37e13 years on that core, and 4.37e7 years at
  an assumed (not measured) 1,000,000× speed-up (evidence/reader-code-work.md). The bound is the code's randomness:
  a code from anywhere other than the page's CSPRNG is not covered.
- **The code is a shared secret.** The holder and the reader both have it; whoever has the link, the name and the code
  sees VALID. If the reader posts the code with the link, the link is name-only in effect.
- **Shown once.** The page does not keep the code. A reader who loses it can't open a code-protected link; they make a
  new code and ask for a new link.
- **The bot is name-only.** Its reader names are public, so a code would be public too; it refuses code-protected
  links (`WrongReader`).
- **The label is the link's claim.** "Code-protected" in a link only makes the page ask for a code; the reader check
  decides. Relabelling a link only makes it fail.

## Revocation acts from its block on (D35)
A link made since D35 can be revoked from Shared proofs. From the revocation's block, every verification (/v, the
bot, `shaida-sdk` 0.2.0) is `ProofRevoked`. What it does not undo:
- a VALID someone already saw, a screenshot, or a verification pinned to an earlier block;
- an on-chain `IncomeVerifier.attest`: its `IncomeProofChecked` event stays a historical record, and
  `IncomeVerifier.check` and the SDK's `checkOnChain` don't look at revocation;
- what a reader learned from the link and the chain (below).

Also:
- **Links made before D35 can't be revoked.** Their salt has no known secret. They still verify and are labelled
  "Not revocable (made before revocation existed)". A v1 link relabelled v2 still can't be revoked by anyone, so
  "revocable" in a link is the link's own claim.
- **The secret is in the vault only.** Without the vault (or its backup) the link can't be revoked. Someone who steals
  the secret can revoke that one link, nothing else.
- **The revoke tx is public.** It shows the secret, the salt and the time. The relayer sends it, so the sender is the
  relayer, not the holder. A salt is one of the three inputs of the link's context; someone who also holds that
  context (an on-chain attest of the link) and guesses the reader name and the expiry day can tie the revoke to the
  attest. For a code-protected link the reader id also needs the code, so the guess fails.
- **A dishonest RPC can hide a revocation**, as it can claim a root is known (the SDK's trust model).
- **Unreadable is not "not revoked".** If the registry can't be read, the answer is INCONCLUSIVE, never VALID.

## Withdrawals are public (pool.unshield)
withdrawals are public and reveal their amounts. A withdrawal (`/app/withdraw`, relayer route `unshield`) spends a
swept note in full and sends tUSD8 out of the pool in one public transaction: the amount, the recipient address and
the time are visible to anyone. Withdrawing right after a demo run would show that run's payment amounts (1.5, 1,
0.5 tUSD8) next to the payments' time. So the app never withdraws by itself, and on Aevum testnet we withdraw only when
the deployer's tUSD8 would otherwise fall below 2, batching the notes at a quiet time to a fresh address we control,
which then forwards the tUSD8 (evidence/budget.md). The nullifier still keeps a withdrawal unlinkable to the note's
payment and sweep, but amounts that match a known run link it by value. The income proof is not affected: it reads
the ledger's V and S leaves, which a withdrawal does not touch (evidence/withdraw-fork.md).

## What the underwriting bot can and cannot know (D30)
- **It trusts the reader-name binding, which is intent, not identity.** A link made out to "Shaida underwriting bot
  (demo)" says the holder meant it for the bot; it does not say who the holder is. Anyone holding that link can send
  it to the bot and get the same decision, so an APPROVE says "this proof meets the policy", never "this applicant
  earns this much". A lender still has to tie the link to an applicant some other way (for example, by receiving it
  from them directly).
- **It sees the link.** Unlike /v, which checks in the browser, the bot's server receives the link for one decision. It
  reads only the proof's public facts (threshold, count, ledger range, expiry, reader hash, root), does not log or keep
  the link, and keeps a hash of each proof it records on chain. An operator who changed the code could keep links;
  running the CLI yourself avoids sending the link anywhere.
- **A minimum period is a span of the ledger, not of payments.** The period is the UTC days between the first and the
  last vouch leaf of the proven range. Those leaves can belong to other recipients, so a long period does not mean the
  holder was paid steadily across it; the payment count and threshold are what is proven about the holder.
- **Proof age is the age of the ledger state the proof was built on** (the time the root it uses was current), not the
  time it was made. A recent proof built on an old root counts as old; the reverse cannot happen.
- **Decisions move with time.** The same link under the same policy version gives the same decision at the same time.
  As time passes, ProofTooOld and ExpiresTooSoon (and ProofExpired) can turn an APPROVE into a DECLINE; nothing turns a
  DECLINE into an APPROVE except a new link.
- **An on-chain record says a proof passed IncomeVerifier, recorded by the bot's address.** The attest event carries the
  proof's context, threshold and count, not the policy; the policy and decision id are in the bot's response only.
- **Templates are wording.** `/v?for=merchant` changes the words on the page, not the proof: anyone can edit the query.

## What the chain and a proof link show (privacy audit, measured 2026-11-24/25)
Measured by attacking the live deployment on Aevum testnet 44005 (every transaction from the deploy block to block
3961095: runs 1 and 2, the withdrawal and the bot) and a fork fixture with two payers and two recipients. Tools,
numbers and tx hashes: [evidence/privacy-audit.md](evidence/privacy-audit.md). Fixes: DECISIONS D32 (F3, F4, F5, F8, F9 applied on 2026-11-25, app only; F1, F2, F6, F7, F10 not applied). The live numbers below were measured before the fixes.

What anyone with the explorer and an RPC sees:
- **Which registered payer made each payment.** Not hidden. The `Vouched` event carries the payer id; the relayed
  `vouchedPayFor` call carries the payer's address; its EIP-712 signature recovers to that address; the registry's
  `PayerRegistered` event links the id to the address. All three agree for every payment (6 of 6 on 44005).
  `PayerRegistered` also carries `keccak256(display name)`, which anyone can confirm by guessing the name.
- **Totals, from public deposits and public attests.** A payer's payments can add up to at most what that payer
  deposited (assuming the payer has no other private funds). An `attest` puts a proof's threshold, count and leaf range
  on chain in clear. Together these pinned Ada's (demo) total from Acme (demo) to exactly 4 tUSD8 on 44005: 3 in run 1
  and 1 in run 2, each exact. With today's single payer and no extra balance, "at least" turns into "exactly".
  Since 2026-11-25 recording is opt-in: the button stays off until the person ticks a box under a warning that says
  this (D32 F3). The three records already on 44005 stay public, and the deposits alone still cap what a payer paid.
- **Each payment's amount, when its swept note is withdrawn.** A sweep moves the whole payment into one note and a
  withdrawal spends a whole note, so each withdrawal amount is one payment's amount. Run 1's three withdrawals
  (1.5, 1 and 0.5 tUSD8) gave all three of run 1's payment amounts, matched in order. Run 2's amounts are hidden
  (each is only known to be below 1 tUSD8), because those notes were not withdrawn. Since 2026-11-25 the inbox can
  split a sweep into two notes, the largest whole tUSD8 below the payment and the rest (D32 F4). It is **off by
  default**, so by default this leak is unchanged. Split, the fork's withdrawal was a part (1 of a 2 tUSD8 payment),
  but withdrawing both notes together would show their sum again.
- **Which sweep belongs to which payment, by timing.** The nullifier hides the link cryptographically, but sweeps
  came minutes after the payments, in the same order, with nobody else using the pool. First-in-first-out timing
  matched 6 of 6 on 44005. On the fork, where one recipient swept out of order, it matched 6 of 8, and the one withdrawal there was matched to
  the wrong payment.
- **That one recipient received a group of payments.** A burst of sweeps reads as one recipient sweeping. Attests by
  the same reader wallet (Bola's two) and over the same range (Bola's run 2 attest and the bot's) joined both runs into
  one holder: 15 of 15 same-recipient pairs right on 44005.
- **Who the withdrawing recipient is, one hop out.** Run 1's withdrawal address forwarded its 3 tUSD8 to the deployer,
  which had also funded the payer. Following the tUSD8 one hop showed both ends of the demo belong to one party.
  Since 2026-11-25 the run checklists allow withdrawals only to an address unlinked to the payer or its funder
  (D32 F5, evidence/budget.md). That forward is still on chain.
- **When things happened.** Every block time, the order of the relayer's transactions, and the signature deadline
  (about when the payer signed, 30 minutes before the deadline). Memos are posted 5–10 blocks after their payment and
  name its commitment by design.

What the observer does not get from the chain:
- payment amounts not later withdrawn, and which receive address was paid (memos are sealed; they share only the fixed
  29-byte P-256 header and all have one padded length, 852 bytes; every ephemeral key differs);
- the recipient's identity, unless a withdrawal or an attest points at it;
- any amount signal in gas: at equal tree positions, payments of different amounts differ by at most 60 gas, while
  moving one position changes gas by about 40,000.
At today's volume (one registered payer, one recipient, six payments on two days) several of these are hidden only
because nothing else happens in the pool that could be confused with them.

What a reader who holds a proof link also learns (beyond "at least the threshold, from count payments"):
- the ledger leaf range, so which payments are in it: the payer id of every vouch leaf in it, and the exact block time
  of each payment and each sweep. When the range holds exactly `count` vouch leaves (true for all three live links),
  those are the holder's payments, so the reader knows who paid the holder and when;
- the exact total, when the payer's deposits and on-chain attests allow it (all three live links). Without run 1's
  attest on chain, run 2's reader would have known only "between 1 and 4 tUSD8";
- when the link was made: the root names the ledger state it used (between two leaf times), and the expiry is either
  an exact "now + 30 days" (run 1, by script) or 23:59:59 in the maker's browser time zone, which gives the time zone
  (the bot link: UTC+1). Links made since 2026-11-25 end at 23:59:59 UTC whatever the browser's zone (D32 F8);
- in a bundle, each proof's sub-range and share; a capped share shows that proof's sum to a 1 tUSD8 window (D13; on
  the fork the window held the true sum, [2, 3) for 2.2). Until 2026-11-25 the UI suggested the most a period could
  show, which made the threshold itself a 1 tUSD8 window on the total (both live thresholds equal the true sums).
  It now suggests the total rounded down to 1, 5 or 10 tUSD8 and never the exact total (D32 F9; Ada's fixture
  link: 5 shown for a 7.45 total, before 7). The most is still allowed, and then the window is back.
With a second payer and a second recipient interleaved (fork fixture), the exact totals widened to bounds (Ada's
link: total in [7, 16], truth 7.45) and the reader could no longer tell which payments in a range were the holder's.
The payer ids in the range were still all shown.
