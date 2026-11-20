# Shaida

Private income proofs on Aevum Testnet (chain 44005, tUSD8): get paid privately in stablecoins, then prove
you earn enough to one named reader, and show nothing else.

Based in part on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Private payments run on [Gloam](https://github.com/gloamtrade/gloam) (MIT), a pinned submodule. See [NOTICE.md](NOTICE.md).

## Status
Build step 1 of PRD §11 is done on a fork; nothing is deployed on Aevum testnet yet.
- Contracts: `PayerRegistry`, `ShaidaDepositor` (gasless EIP-3009 + standard deposit), `ShaidaLedger` (vouch and
  sweep leaves), on Gloam's pool with its final-ceremony verifiers.
- Tests: `make test` (unit) and `make test-fork` (real tUSD8 on a fork, including deposit → vouched pay → sweep with
  real proofs). Gas: [evidence/fork-gas.md](evidence/fork-gas.md). Issuer risks: [LIMITS.md](LIMITS.md).

Not built yet: the income circuit, IncomeVerifier, indexer, Shaida relayer and UI. `web/` and `examples/` are still the
starter kit's checkout demo and will be replaced.

## Commands
```bash
make install      # submodules + pnpm
make build        # forge build + Shanghai opcode check (our contracts and Gloam's)
make test         # unit tests
make test-fork    # tests against the real tUSD8 (needs https://rpc-test.qday.info)
make fork         # local Aevum fork, chain 440050 on 127.0.0.1:8555
make deploy-fork  # deploy the stack to the fork; writes deployments/fork.json
make deploy-aevum ACCOUNT=<keystore> ATTESTOR=0x...   # real deploy (clean committed tree only); writes deployments/aevum.json
pnpm --filter @shaida/gloam-fixtures gen:fork-flow    # regenerate the fork test's Gloam proofs (final keys)
```
