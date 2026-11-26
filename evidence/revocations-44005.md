# Revocations on Aevum testnet 44005 (D35)

Deployed by the builder with `make deploy-revocations-aevum ACCOUNT=shaida-deployer` from the clean tree at
`67993b7`; `tools/write-revocations.mjs` read it back and wrote `deployments/aevum.json`. Checked again by the agent,
read-only, on 2026-11-26.

| | |
|---|---|
| Address | [`0x3b19c8f3e2f65030ccddebec776c3be32090f2e4`](https://explorer-test.qday.info/address/0x3b19c8f3e2f65030ccddebec776c3be32090f2e4) |
| Tx | [`0x0f836c20…`](https://explorer-test.qday.info/tx/0x0f836c2031c775e718d8133cf1ec51a72207bb3c7fb5700adac480c324d9e159), block 4135878 |
| Receipt | status 1, legacy (type 0), 1 gwei, from the deployer `0x5f8066E6…69698` |
| Gas | 237,696, the same as the fork's deploy (evidence/revocations-gas.md); 0.000237696 tQDAY |
| Over | PoseidonT3 `0x1e771073ac7703772c3717650ca0577e103dfaaf`, the stack's (deployments/aevum.json) |
| State read back | `saltOf(1)` = Poseidon(4, 1) (5705809496…923005, the poseidon-lite value); `revokedAt(1)` = 0 |
| Deployer after | 0.924300969 tQDAY (0.924538665 before, minus the deploy's gas exactly) |

## Explorer verification (one attempt, as S10)
```
forge verify-contract 0x3b19c8f3e2f65030ccddebec776c3be32090f2e4 src/Revocations.sol:Revocations \
  --chain-id 44005 --verifier blockscout --verifier-url https://explorer-test.qday.info/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" 0x1e771073ac7703772c3717650ca0577e103dfaaf) --watch
```
Result: `Pass - Verified` (GUID `3b19c8f3e2f65030ccddebec776c3be32090f2e46b0790d5`). Read back from
`/api?module=contract&action=getsourcecode`: ContractName `Revocations`, CompilerVersion `v0.8.24+commit.e11b9ed9`,
OptimizationUsed `true`, EVMVersion `shanghai`, SourceCode present.
