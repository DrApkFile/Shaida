# Shaida

Private income proofs on Aevum Testnet (chain 44005, tUSD8): get paid privately in stablecoins, then prove
you earn enough to one named reader, and show nothing else.

Based in part on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Private payments run on [Gloam](https://github.com/gloamtrade/gloam) (MIT), a pinned submodule. See [NOTICE.md](NOTICE.md).

## Status
PRD §11 steps 1–2 and acts 2–3 run on a local fork; nothing is deployed on Aevum testnet yet.
- Contracts: `PayerRegistry`, `ShaidaDepositor` (gasless EIP-3009 + standard deposit), `ShaidaLedger` (vouch and
  sweep leaves, one vouch per payment, `lateVouch` repair for a front-run pay: DECISIONS D9), on Gloam's pool with its
  final-ceremony verifiers.
- Income circuit (`packages/shaida-proofs`): 4 slots per proof, 44,687 constraints (DECISIONS D12). A pure witness
  builder splits a period into a bundle of up to 8 proofs over disjoint leaf ranges, and the pure verification core
  (PRD §5) checks bundles. Tested with honest cases, the circuit cheats of EVAL_DESIGN (X04–X09 and
  public-signal tampering), the bundle refusals (X14–X18) and property tests. Each proof's threshold share is
  rounded down to whole tUSD8 (D13).
  Circuit tests and timings use a **throwaway local key**.
- Ceremony (step 3): done. Two contributions (Kene, Gunroar) and a beacon from Aevum block 3772100, verified; final
  zkey sha256 `cbcb06fe…` as release asset `ceremony-v1` ([ceremony/TRANSCRIPT.md](ceremony/TRANSCRIPT.md)). The
  throwaway key (`NEXT_PUBLIC_SHAIDA_INCOME_KEY=throwaway`) works on local chains only and is refused on Aevum 44005
  (D21).
- `IncomeVerifier` (on-chain check of one proof: tUSD8, known ledger root, gas guard, Groth16; optional attest), over
  the ceremony's verifier: part of the fork deploy, which refuses a verifier that rejects a final-key proof or
  accepts a throwaway-key one (D24). Not deployed on Aevum testnet.
- Tests: `make test` (contracts, circuit, witness builder) and `make test-fork` (real tUSD8 on a fork, including
  deposit → vouched pay → sweep with real proofs). Gas: [evidence/fork-gas.md](evidence/fork-gas.md).
  Issuer and front-running limits: [LIMITS.md](LIMITS.md).

- Indexer (`packages/shaida-index`, `/api/index`): pool and ledger leaf snapshots from chunked `eth_getLogs` (≤ 999
  blocks a page, retry with backoff, persisted cursor, reads pinned to one block); the browser recomputes both roots
  and checks `isKnownRoot` on chain, refusing with `UnknownRoot`.
- Relayer (`packages/shaida-relay`, `/api/relay/<fn>`): one route per contract function (deposit, vouched-pay,
  late-vouch, sweep, memo), rails before simulation, a daily gas budget, persisted records, unknown outcomes never
  resent (D19, D20).
- Pay and inbox (`/pay`, `/inbox`, `packages/shaida-pay`): gasless deposit, vouched private pay with a sealed memo,
  inbox and sweep, proofs made in the browser with Gloam's final keys, secrets in an encrypted browser vault with an
  exportable backup (D21).
- PRD §11 acts 2–3 on the fork: [evidence/acts-2-3-fork.md](evidence/acts-2-3-fork.md) (script, tx hashes) and
  [evidence/ui-fork/](evidence/ui-fork/report.md) (the same flow through the UI at 390 px).

Not built yet: the income-proof pages (prove, share, verify), the final income key (ceremony), deployment on Aevum
testnet, `make gate`.

## Commands
```bash
make install      # submodules + pnpm
make build        # forge build + Shanghai opcode check (ours and Gloam's) + income circuit compile (circom 2.2.3)
make test         # unit tests: contracts, circuit, witness builder
make test-groth16 PTAU_PATH=<Hermez 2^17 ptau>   # full Groth16 proofs with a throwaway local key (local only)
make bench-circuit PTAU_PATH=<…>                 # writes evidence/income-circuit.md
make test-fork    # tests against the real tUSD8 (needs https://rpc-test.qday.info)
make fork         # local Aevum fork, chain 440050 on 127.0.0.1:8555
make deploy-fork  # deploy the stack to the fork; writes deployments/fork.json
make deploy-aevum ACCOUNT=<keystore> ATTESTOR=0x...   # real deploy (clean committed tree only); writes deployments/aevum.json
pnpm --filter @shaida/gloam-fixtures gen:fork-flow    # regenerate the fork test's Gloam proofs (final keys)
```
