# Reader code: offline guessing cost (D36)

Command: `node tools/bench-reader-code.mjs`. Commit f745bb2, 2026-11-25T22:14:29.870Z, Node v24.19.0, Intel(R) Core(TM) i3 CPU       M 370  @ 2.40GHz (one core), poseidon-lite 0.3.0. Class: real (this machine).

One guess = Poseidon(code) and Poseidon(5, nameHash, ·), compared with the link's readerIdHash. 20000 guesses per run, 5 runs: median 45.603 s, so **439 guesses per second** on one core (runs: 31.835, 36.372, 45.603, 50.147, 55.180 s).

Expected time to find a random code (half the space). The 1,000× and 1,000,000× columns are assumptions, not measurements: a many-core cluster and a large GPU farm with an optimised Poseidon.

| Code bits | Codes | Years, this core | Years, 1,000× faster | Years, 1,000,000× faster |
|---|---:|---:|---:|---:|
| 60 (12 characters) | 1.153e+18 | 4.17e+7 | 4.17e+4 | 4.17e+1 |
| 80 (16 characters) | 1.209e+24 | 4.37e+13 | 4.37e+10 | 4.37e+7 |

Shaida uses 80 bits (16 characters). A link lives at most 365 days (D27), so an attacker has at most that long, and the holder can revoke it earlier (D35).
