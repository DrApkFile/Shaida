# Third-party notices

Shaida is MIT licensed (see [LICENSE](LICENSE)). It is based in part on the
[Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, (c) 2026 PQA Labs), commit
`e87bcff10fbaffcc920df658b2fdf79b4586b277`: the repo layout, Makefile, `tools/check-shanghai.mjs`, `packages/aevum`,
`web/`, `examples/` and `contracts/test/mocks/MockUSD8.sol` come from it (the kit's example `Checkout` contract was removed).
Files adapted from it carry a source comment.

Third-party Solidity libraries are git submodules that keep their own LICENSE files; JavaScript packages are
installed from npm. Nothing from them is copied into this repository, except the snippets listed under
"Borrowed snippets" below.

## Solidity libraries (`contracts/lib`, git submodules)

| Project | Version | License | Source |
|---|---|---|---|
| forge-std | v1.9.6 | MIT or Apache-2.0 | https://github.com/foundry-rs/forge-std |
| OpenZeppelin Contracts | v5.1.0 | MIT | https://github.com/OpenZeppelin/openzeppelin-contracts |
| Gloam (shielded pool, final ceremony verifiers, pay memo, PoseidonT3 bytecode) | commit `d8db1e6c805c5887678fa2c6c82ea617efe1659c` (2026-11-19) | MIT, (c) 2026 Gloam; snarkjs-generated verifiers inside it are GPL-3.0 (0KIMS) | https://github.com/gloamtrade/gloam |

### What Shaida deploys from Gloam
Imported from `contracts/lib/gloam/contracts/` by `contracts/script/DeployStack.s.sol`, unmodified:
`ShieldPoolPoseidon` (+ `ShieldPoolCore`, `ChangeTimelock`, `IncrementalMerkleTreePoseidon`), `GloamPayMemo`,
`DualProofVerifier`, `{Shield,Unshield,Transfer}VerifierFinal` (GPL-3.0, snarkjs) and their `*IVerifierFinal` adapters,
and `KeyCheckProofs` (deploy-time key check only). PoseidonT3 is deployed from Gloam's fixture
`test/fixtures/Poseidon2.json` (circomlibjs bytecode, read at deploy time, not copied).

### What the web app serves and runs from Gloam
`tools/copy-gloam-artifacts.mjs` copies, unmodified and sha256-checked, `app/public/circuits/{shield,transfer,unshield}.wasm` and
`app/public/circuits/final/{shield,transfer,unshield}_final.zkey` (Gloam's final ceremony keys) with Gloam's `LICENSE` into
`web/public/gloam/` for in-browser proving. The app and `packages/shaida-pay` use `@gloamtrade/sdk` 0.8.0 (MIT,
(c) 2026 Gloam) from npm for note, intent, receive-tag and sealed-memo code. Proving runs snarkjs 0.7.6
(GPL-3.0, (c) 0KIMS), loaded in the browser bundle; its licence applies to that bundle.

### Borrowed snippets
| Where | Source | Licence |
|---|---|---|
| `contracts/script/DeployStack.s.sol` `_deployFinalVerifiers`, `_requireCeremonyKeys` | gloamtrade/gloam `contracts/script/MainnetDeploy.sol` | MIT, (c) 2026 Gloam |
| `tools/check-shanghai.mjs` (extended to Gloam sources and raw PoseidonT3 bytecode) | qday-io/aevum-starter-kit `tools/check-shanghai.mjs` | MIT, (c) 2026 PQA Labs |
| `Makefile` (`fork`, `deal`, throwaway-deployer pattern in `deploy-fork`) | qday-io/aevum-starter-kit `Makefile` | MIT, (c) 2026 PQA Labs |
| `contracts/script/DeployStack.s.sol` `_isAnvilAccount` | qday-io/aevum-starter-kit `contracts/script/Deploy.s.sol` | MIT, (c) 2026 PQA Labs |
| `contracts/src/ShaidaDepositor.sol` gasless pattern (nonce bound to contract + id) | qday-io/aevum-starter-kit `contracts/src/Checkout.sol` | MIT, (c) 2026 PQA Labs |
| `web/src/app/api/relay/*`, `web/src/server/relay-route.ts` (`clientIp`, route shape) | qday-io/aevum-starter-kit `web/src/app/api/relay/route.ts` | MIT, (c) 2026 PQA Labs |
| `contracts/test/fork/AevumFork.t.sol` (domain check) | qday-io/aevum-starter-kit same path | MIT, (c) 2026 PQA Labs |
| `packages/shaida-proofs/circuits/lib/merkle.circom` (Merkle path; root and leaf index as outputs) | gloamtrade/gloam `contracts/circuits/common/merkle_poseidon.circom` (commit `d8db1e6c`) | MIT, (c) 2026 Gloam |

## Circuits and circuit tools
`packages/shaida-proofs/circuits/income.circom` includes circomlib (`poseidon`, `comparators`, `bitify`), so it is
GPL-3.0 (its SPDX header says so, D6). The compiled r1cs/wasm and keys are build outputs, not committed.

Generated from the snarkjs 0.7.6 Solidity template (GPL-3.0, (c) 0KIMS association), header kept, contract renamed:
- `contracts/test/fixtures/income/ThrowawayIncomeVerifier{A,B}.sol`: THROWAWAY test keys, written by
  `packages/shaida-proofs/scripts/gen-verifier-fixtures.ts`; never deployed.
- `contracts/src/generated/IncomeGroth16Verifier.sol` (once the ceremony is finalized): written by
  `ceremony/finalize.ts` from the final ceremony key.

| Project | Version | License | Used for |
|---|---|---|---|
| circomlib | 2.0.5 (npm) | GPL-3.0 | included by income.circom |
| circom | 2.2.3 (cargo build from tag, or the release binary in CI, sha256-pinned) | GPL-3.0 | compiler; not shipped |

## Visual style and fonts
- The web app follows the visual style of the builder's Muuve project (colours, type sizes, radii, shadows, layout;
  DESIGN.md, DECISIONS D25). No Muuve file, image or video is copied; Muuve's name and logo are not used.
- Inter Tight (SIL Open Font License 1.1, (c) The Inter Tight Project Authors) and JetBrains Mono (SIL Open Font
  License 1.1, (c) The JetBrains Mono Project Authors), served by `next/font/google`, which downloads them at build time
  and self-hosts them with the app.
- Shaida's mark and wordmark (`web/public/brand/`) and line icons (`web/src/components/Icons.tsx`) were drawn for this
  repo (MIT).

## JavaScript packages (direct dependencies)

| Package | Version | License | Used in |
|---|---|---|---|
| next | 16.4.6 | MIT | web |
| react, react-dom | 19.2.0 | MIT | web |
| @rainbow-me/rainbowkit | 2.2.11 | MIT | web |
| wagmi | 2.19.5 | MIT | web |
| @tanstack/react-query | 5.90.2 | MIT | web |
| viem | 2.57.12 | MIT | web, examples, packages/aevum |
| tsx | 4.23.15 | MIT | examples (dev) |
| typescript | 5.9.3 | Apache-2.0 | all (dev) |
| @gloamtrade/sdk | 0.8.0 | MIT | packages/gloam-fixtures (test fixtures only) |
| snarkjs | 0.7.6 | GPL-3.0 | packages/gloam-fixtures (proving tool, not shipped) |
| circomlibjs | 0.1.7 (via @gloamtrade/sdk) | GPL-3.0 | packages/gloam-fixtures (Poseidon, not shipped) |
| zod | 3.25.76 | MIT | packages/gloam-fixtures, packages/shaida-proofs |
| poseidon-lite | 0.3.0 | MIT | packages/shaida-proofs (Poseidon for the witness builder) |
| snarkjs | 0.7.6 | GPL-3.0 | packages/shaida-proofs (dev: witness checks, throwaway key, timing) |
| snarkjs (browser build `snarkjs.min.js`) | 0.7.6 | GPL-3.0 | tools/s8-bench (copied into the generated, uncommitted `www/`) |
| esbuild | 0.28.2 | MIT | tools/s8-bench (dev: bundles the bench page) |
| snarkjs | 0.7.6 | GPL-3.0 | ceremony (phase-2 setup, contributions, beacon, verify, export; not shipped) |
| zod | 3.25.76 | MIT | ceremony (record.json and RPC reply schemas) |
| snarkjs | 0.7.6 | GPL-3.0 | packages/shaida-underwrite and web's server (the bot's Groth16 check, D30) |
| ffjavascript | 0.3.1 (iden3) | GPL-3.0 | packages/shaida-underwrite and web's server (a single-threaded bn128 curve for that check, D30) |
| @upstash/redis | 1.41.0 | MIT | packages/shaida-kv, web (relayer records and index cursor in Upstash Redis in production) |

Their own dependencies carry their own licenses. To list them all, run `pnpm licenses list` in the repo root.
