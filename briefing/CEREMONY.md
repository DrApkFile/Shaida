# CEREMONY: Shaida income circuit (Groth16)

Why: a single-party Groth16 setup lets whoever ran it forge proofs (IDEA_CHECK R4, spike S7). Phase 1 comes from a public ceremony. Phase 2 has several independent contributors and a public beacon, so forging needs all of them to collude.

## Phase 1 (universal)
| Item | Value |
|---|---|
| File | powersOfTau28_hez_final_17.ptau (2^17 = 131,072 constraints; ~144 MB) |
| Source | Hermez ceremony, listed in the iden3/snarkjs README (row 17, link https://circom.info/powersOfTau28_hez_final_17.ptau) |
| Expected blake2b (README) | 6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345 |
| Builder's b2sum, 2026-11-20 | 6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345 (**match**) |
| Stored | builder's machine only, not in the repo |

## Phase 2 (circuit-specific): procedure
Circuit frozen by D13: the 4-slot `income.circom` (D12), r1cs sha256
`d866695ca2473e70408d288feafaec7181983480a688acac30b42156d305d82a` (44,687 constraints; the 2^17 ptau above covers it).
Changing the circuit means a new ceremony (record it in DECISIONS.md and start again from step 0).

Scripts: `ceremony/*.ts` (snarkjs 0.7.6, pinned). Every step reads and extends `ceremony/record.json`; the readable
`ceremony/TRANSCRIPT.md` is regenerated from it after every step and is never edited by hand. Zkeys live in
`ceremony/work/` (gitignored, ~25 MiB each); `zkey verify` logs in `ceremony/logs/` (committed).
Paths below are relative to `ceremony/`. `PTAU=$PWD/powers/powersOfTau28_hez_final_17.ptau` from the repo root.

| # | Who | Command (repo root) | What it checks / writes |
|---|---|---|---|
| 0 | builder | `make ceremony-prepare PTAU_PATH=$PTAU` | ptau blake2b = the value above; r1cs sha256 = the frozen one; `groth16 setup` → `work/income_0000.zkey` (deterministic, no secret); starts record.json |
| 1 | builder | `make ceremony-contribute IN=work/income_0000.zkey OUT=work/income_0001.zkey NAME="<builder name>"` | input = the recorded setup; entropy typed at a hidden prompt (≥ 32 chars, mixed by snarkjs with 64 OS-random bytes; never stored); prints the contribution hash and output sha256 |
| 1v | builder | `make ceremony-verify ZKEY=work/income_0001.zkey PTAU_PATH=$PTAU` | `snarkjs zkey verify` against r1cs + ptau; records the contribution hashes read from the file; log kept |
| 1c | builder | commit + push record.json, TRANSCRIPT.md, logs/ | publishes the sha256 of `income_0001.zkey` before it is sent |
| 2 | independent person | `ceremony/CONTRIBUTE.md`: `snarkjs zkey contribute income_0001.zkey income_0002.zkey --name="…"` | they check the input sha256, contribute with their own entropy, send back the file, its sha256 and the contribution hash |
| 2v | builder | `make ceremony-verify ZKEY=work/income_0002.zkey EXPECT="2:<hash they sent>" PTAU_PATH=$PTAU` | as 1v, plus: the zkey must extend `income_0001`'s contributions and contribution #2 must equal the hash they reported |
| S | builder (only if needed) | `make ceremony-supersede SHA256=<zkey sha256> REASON="…"` | takes the **latest** active verified zkey off the chain before the beacon is announced (e.g. a wrong name in the zkey). Nothing is deleted: the record entry and its verify log stay, marked superseded with the reason and time; the file moves to `work/superseded/`. The next contribution must start from the previous active zkey (or the setup); `contribute` and `verify` refuse the superseded zkey and anything built on it. Commit + push after |
| B1 | builder | `make ceremony-beacon-announce`, then commit + push at once | refuses unless the last verified zkey has ≥ 2 contributions and no beacon. Reads the Aevum head (chain 44005) and fixes block = head + ⌈7,200 s / 1.012 s⌉ = head + 7,115 (~2 h after the last contribution) in record.json |
| B2 | builder | `make ceremony-beacon-apply` (≥ 2 h later) | refuses until the block is mined with ≥ 64 confirmations; finds the first commit that announced the number, requires it in `origin/master` and committed before the block's timestamp; reads the block hash twice; `zkey beacon … <hash without 0x> 10` → `work/income_final.zkey` |
| Bv | builder | `make ceremony-verify ZKEY=work/income_final.zkey PTAU_PATH=$PTAU` | the whole chain verifies; the last contribution carries the beacon value |
| F | builder | `make ceremony-finalize` | exports `packages/shaida-proofs/keys/income_final_vkey.json` and `contracts/src/generated/IncomeGroth16Verifier.sol` (contract renamed, GPL-3.0 header kept, provenance line added); compiles the verifier alone (solc 0.8.24, Shanghai) and runs `tools/check-shanghai.mjs`; proves one sample witness with the final key, checks it with the vkey and checks a tampered threshold is refused; records every hash |
| P | builder | commit + push; publish `income_final.zkey` (release asset) | the app pins the final zkey and vkey by sha256 |

Rules:
- The beacon block number is announced in a pushed commit **before** the block is mined (B1). It is never changed:
  `beacon announce` refuses a second announcement. If something goes wrong after the announcement, record it in
  DECISIONS.md and start a new announcement from a new record, keeping the old one on record.
- Contributions are only ever made to the latest active verified zkey (`contribute` refuses any other input,
  including a superseded one). Supersede never deletes history; it is refused once the beacon is announced.
- Superseded so far: contribution #1 of commit `e7b116e` (zkey sha256 `18f2ec26…`), made under the placeholder name
  "Your Real Name"; superseded 2026-11-21, redone from `income_0000.zkey`. Its entropy must still be forgotten (a
  superseded key is not on the chain, so it cannot weaken the final key either way).
- Nobody runs step 1 or 2 for someone else, and nobody keeps entropy. The builder's agent made no contribution.
- A rehearsal: `CEREMONY_DIR=<scratch dir>` makes every script a DRY RUN in that directory (test entropy via
  `CEREMONY_TEST_ENTROPY`, `BEACON_DELAY_HOURS`, the `make fork` chain allowed; every file marked DRY RUN).
  Rehearsed 2026-11-21 on the builder's laptop (i3 M 370): `evidence/ceremony-dry-run-2026-11-21/` (local paths
  redacted). The first attempt failed at the second verify (the log parser expected snarkjs to list contributions
  oldest first; it lists newest first). Fixed, then resumed from that step and completed: 2 contributions (one with
  this repo's script, one with the plain snarkjs CLI as in CONTRIBUTE.md), beacon from Aevum 44005 block 3,747,371
  (0.02 h delay for the rehearsal), chain verified, verifier 1,908 bytes runtime and Shanghai-safe, sample proof
  verified, tampered threshold refused. Timings there: setup 7.5 min, each `zkey verify` ~5 min (another key
  setup ran at the same time).

## Does `zkey contribute` mix OS randomness with the typed entropy? Yes.
Checked 2026-11-21 in the pinned snarkjs 0.7.6 (`node_modules/.pnpm/snarkjs@0.7.6/node_modules/snarkjs`):
- `src/zkey_contribute.js:44`: `const rng = await misc.getRandomRng(entropy);` (the typed text, or the prompt's
  answer if none was given).
- `src/misc.js:182-198` `getRandomRng`: a blake2b-512 hasher takes `getRandomBytes(64)` first (line 188:
  `hasher.update(getRandomBytes(64));`), then the UTF-8 entropy text (line 190); the digest seeds the ChaCha RNG.
- `src/misc.js:155-162` `getRandomBytes`: in Node, `crypto.randomFillSync(array)` (line 160); in a browser,
  `crypto.getRandomValues`. So it is Node's CSPRNG through `randomFillSync`, **not** `crypto.randomBytes` (the same
  OS source, a different call).
- The code that actually runs is the same: the library build our scripts import, `build/main.cjs` (sha256
  `7380039f…`): `phase2contribute` at line 5761 calls `getRandomRng(entropy)` at 5776, which hashes
  `getRandomBytes(64)` at 257, which calls `randomFillSync` at 229. The CLI an outside contributor runs,
  `build/cli.cjs` (sha256 `6d787e37…`): lines 5006 / 5021 / 351 / 323. (`src/misc.js` sha256 `9f58cbff…`,
  `src/zkey_contribute.js` `abd0bac0…`.)
Consequence: a contribution stays secret if either the typed entropy or the 64 OS-random bytes stay unknown. A
contributor's typed text alone does not determine their contribution, so they cannot reproduce it later either.

Publish: every contribution hash, the beacon block number and hash, the final zkey, vkey and verifier hashes, and
the verification logs: all in `ceremony/TRANSCRIPT.md` and `ceremony/logs/`.
