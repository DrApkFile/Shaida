# Spike S10: explorer contract verification on Aevum testnet

One attempt, as planned (briefing/REALITY_SPIKES.md S10). Run on 2026-11-22T06:32:54Z from `contracts/`, forge Version: 1.10.0.

```
forge verify-contract 0xce43B77AdC82Db336D07f03bd84c3834FD9c5215 src/PayerRegistry.sol:PayerRegistry \
  --chain-id 44005 --verifier blockscout --verifier-url https://explorer-test.qday.info/api/ \
  --constructor-args $(cast abi-encode "constructor(address)" 0x5f8066E6E18f6381a0fF593BB6B1A036c5a69698) --watch
```

Output:

```
Start verifying contract `0xce43B77AdC82Db336D07f03bd84c3834FD9c5215` deployed on 44005
Constructor args: 0x0000000000000000000000005f8066e6e18f6381a0ff593bb6b1a036c5a69698

Verifying on blockscout...
Submitting verification for [src/PayerRegistry.sol:PayerRegistry] 0xce43B77AdC82Db336D07f03bd84c3834FD9c5215.
Submitted contract for verification:
	Response: `OK`
	GUID: `ce43b77adc82db336d07f03bd84c3834fd9c52156b028b96`
	URL: https://explorer-test.qday.info/address/0xce43b77adc82db336d07f03bd84c3834fd9c5215
ce43b77adc82db336d07f03bd84c3834fd9c52156b028b96	https://explorer-test.qday.info/address/0xce43b77adc82db336d07f03bd84c3834fd9c5215

Waiting for blockscout verification result...
Contract verification status:
Response: `OK`
Details: `Pass - Verified`
Contract successfully verified
exit=0
```

Read back from the explorer's API (`/api?module=contract&action=getsourcecode`): ContractName `PayerRegistry`,
CompilerVersion `v0.8.24+commit.e11b9ed9`, OptimizationUsed `true`, EVMVersion `shanghai`, SourceCode present.

Result: verification **works** on explorer-test.qday.info (the docs say it does not). Only PayerRegistry was
submitted; the other 15 contracts of deployments/aevum.json are not verified yet.
