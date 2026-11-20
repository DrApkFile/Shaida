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

## Phase 2 (circuit-specific): to do during the build
Done once the circuit is frozen: since D12 that is the 4-slot `income.circom`, r1cs sha256
`d866695ca2473e70408d288feafaec7181983480a688acac30b42156d305d82a` (44,687 constraints; the 2^17 ptau above covers it).
Changing the circuit means a new ceremony.
| # | Contributor | Command | Contribution hash | Date |
|---|---|---|---|---|
| 0 | setup | `snarkjs groth16 setup income.r1cs powersOfTau28_hez_final_17.ptau income_0000.zkey` | — | |
| 1 | builder | `snarkjs zkey contribute income_0000.zkey income_0001.zkey --name="builder"` | | |
| 2 | independent person (named) | `snarkjs zkey contribute income_0001.zkey income_0002.zkey --name="..."` | | |
| B | beacon: hash of a future Aevum block, number fixed in advance here | `snarkjs zkey beacon income_0002.zkey income_final.zkey <blockhash> 10` | | |
| V | verify | `snarkjs zkey verify income.r1cs powersOfTau28_hez_final_17.ptau income_final.zkey` | | |

Publish: every contribution hash, the beacon block number and hash, the final zkey hash, and the verification output.
