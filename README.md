# Shaida

Private income proofs on Aevum Testnet (chain 44005, tUSD8): get paid privately in stablecoins, then prove
you earn enough to one named reader, and show nothing else.

Based in part on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Private payments run on [Gloam](https://github.com/gloamtrade/gloam) (MIT), a pinned submodule. See [NOTICE.md](NOTICE.md).

## Status
Build steps 1 and 2 of PRD §11 are done locally; nothing is deployed on Aevum testnet yet.
- Contracts: `PayerRegistry`, `ShaidaDepositor` (gasless EIP-3009 + standard deposit), `ShaidaLedger` (vouch and
  sweep leaves, one vouch per payment, `lateVouch` repair for a front-run pay: DECISIONS D9), on Gloam's pool with its
  final-ceremony verifiers.
- Income circuit (`packages/shaida-proofs`): 4 slots per proof, 44,687 constraints (DECISIONS D12). A pure witness
  builder splits a period into a bundle of up to 8 proofs over disjoint leaf ranges, and the pure verification core
  (PRD §5) checks bundles. Tested with honest cases, the circuit cheats of EVAL_DESIGN (X04–X09 and
  public-signal tampering), the bundle refusals (X14–X18) and property tests. Each proof's threshold share is
  rounded down to whole tUSD8 (D13).
  Proving keys so far are a **throwaway local key** for tests and timing only.
- Ceremony (step 3): scripts and contributor instructions are ready (`ceremony/`, `briefing/CEREMONY.md`,
  rehearsed in a dry run); **no contribution has been made yet**, so there is no final key.
- `IncomeVerifier` (on-chain check of one proof: tUSD8, known ledger root, gas guard, Groth16; optional attest):
  unit-tested with a placeholder and two throwaway verifiers. Not deployed; it waits for the ceremony's verifier.
- Tests: `make test` (contracts, circuit, witness builder) and `make test-fork` (real tUSD8 on a fork, including
  deposit → vouched pay → sweep with real proofs). Gas: [evidence/fork-gas.md](evidence/fork-gas.md).
  Issuer and front-running limits: [LIMITS.md](LIMITS.md).

Not built yet: the ceremony itself (final key), the browser prover, the chain-reading side of verification
(`isKnownRoot`, dates; injected into the pure core), indexer, Shaida relayer and UI.
`web/` and `examples/` are still the starter kit's checkout demo and will be replaced.

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
