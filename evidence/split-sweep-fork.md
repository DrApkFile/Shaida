# Split sweep on the fork (D32 F4)

Run 2026-11-25T03:46:08.480Z on `make fork` (chain 440050, real tUSD8), through the web app at http://localhost:3100; Gloam's final keys and the income FINAL key. Demo personas.
Command: `pnpm --filter @shaida/pay split-sweep:fork`. Raw: [split-sweep-fork.json](split-sweep-fork.json).

## Result
- incomeCandidates: 3 countable (2 tUSD8, sweep note 1; 1.5 tUSD8, sweep note 1; 1 tUSD8, sweep note 1), 0 not countable
- Proof A: ≥ 2 tUSD8 from 1 payment(s) (amounts 2; sweep notes 1): proved in 19793 ms; snarkjs verify true; IncomeVerifier.check true
- Proof B: ≥ 4 tUSD8 from 3 payment(s) (amounts 2 + 1.5 + 1; sweep notes 1 + 1 + 1): proved in 19999 ms; snarkjs verify true; IncomeVerifier.check true
- The fresh address received 1.5 tUSD8 in 2 withdrawals (1 + 0.5); no withdrawal equals P2's 1.5

## Transactions
| What | Tx | Block | Gas used |
|---|---|---:|---:|
| Acme deposits 5 tUSD8 | `0xf51de946577bb72caf4c0e73a81125c402bdfe1ba3e6b000d16ed49f6fd63887` | 4057187 | 1,254,026 |
| P1: Acme → Ada 2 tUSD8 (vouched) | `0x5ab55f94c25c2d7c21bf22b3a19841f23169d31827b5ae6e6ab165f12bd02df8` | 4057188 | 2,729,023 |
| memo 1 | `0xf3bdda40af611db5c5838d4b3c3e5fed6075d990c94223d568515cc68b58095a` | 4057189 | 44,923 |
| P2: Acme → Ada 1.5 tUSD8 (vouched) | `0xff0a38a395905ac92c292e2e5dc630fe8c3569529287b734ff54727bde337d0d` | 4057190 | 2,689,545 |
| memo 2 | `0x67a9a3a47a109181dbbbefdc578e7878658d7e02aef2585c214699890f5120a1` | 4057191 | 44,923 |
| P3: Acme → Ada 1 tUSD8 (vouched) | `0x2702a40ad45ce00ba2a79849b1cfd61de693c8c6428d2a88365cbe908faef6dc` | 4057192 | 2,684,606 |
| memo 3 | `0x3c31a32af8f43e7872ab9117b2e84518074d19d667ac8d2a54b454d86288b1aa` | 4057193 | 44,923 |
| Ada sweeps P1 (2 tUSD8), split 1 + 1 | `0x1954095f6e397d008d7a34171a650ced43eee6c9a42bfe806197fa96697ed8c4` | 4057194 | 2,644,453 |
| Ada sweeps P2 (1.5 tUSD8), split 1 + 0.5 | `0xc6d5a3cfe4d4ed3ae1eee1c73857ecb1c4ebb4d7259f3447709c7670fa6bb69f` | 4057195 | 2,644,780 |
| Ada sweeps P3 (1 tUSD8), whole | `0x91b00ed8545b2f09e8e869bc72286df2ce2af1c74456399b9d36e5083537b73f` | 4057196 | 2,639,478 |
| attest proof B (own gas) | `0xab3cb8005a47d0fb83228c10be56f6db7e6bce2dd0501ab3ddc85243e6172d24` | 4057197 | 267,029 |
| withdraw a 1 tUSD8 note of P2 to a fresh address | `0x3ff2b762710a63c2c445423e652d0e63d3c700fe5c3d7d5de27996a2b0645c1a` | 4057198 | 343,686 |
| withdraw a 0.5 tUSD8 note of P2 to a fresh address | `0x414404325c56d404b4ce1712344f6947a74575c33ef57e4324883d4a9d0e6a99` | 4057199 | 326,598 |
