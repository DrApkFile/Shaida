# Shaida

Private income proofs on Aevum Testnet (chain 44005, tUSD8): get paid privately in stablecoins, then prove
you earn enough to one named reader, and show nothing else.

Based in part on the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs).
Private payments run on [Gloam](https://github.com/gloamtrade/gloam) (MIT), a pinned submodule. See [NOTICE.md](NOTICE.md).

## Status
Work in progress (build step 1 of PRD §11). Built so far:
- Repo layout from the starter kit; Gloam pinned at `contracts/lib/gloam`.
- `make deploy-fork` / `make deploy-aevum`: deploys PoseidonT3, Gloam's final-ceremony verifiers, the Gloam pool and
  the pay-memo board, checks them on chain, and records them in `deployments/` from the receipts.
- Spike S9 (tUSD8 admin powers): see [LIMITS.md](LIMITS.md).

Not built yet: PayerRegistry, ShaidaDepositor, ShaidaLedger, the income circuit, IncomeVerifier, indexer, relayer, UI.
Nothing is deployed on Aevum testnet yet.

## Commands
```bash
make install      # submodules + pnpm
make build        # forge build + Shanghai opcode check (our contracts and Gloam's)
make test         # unit tests
make test-fork    # tests against the real tUSD8 (needs https://rpc-test.qday.info)
make fork         # local Aevum fork, chain 440050 on 127.0.0.1:8555
make deploy-fork  # deploy the stack to the fork; writes deployments/fork.json
make deploy-aevum ACCOUNT=<keystore>   # real deploy (clean committed tree only); writes deployments/aevum.json
```
