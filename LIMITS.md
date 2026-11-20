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
(a direct transfer adds no leaf). Not mitigated in v1.
