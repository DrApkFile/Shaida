# Public hosting: the live site, checked logged out

Written by `bash tools/check-hosting.sh https://shaida.onrender.com`. Do not edit by hand. Read-only: GET requests as a logged-out
visitor, one eth_blockNumber and one eth_call (Check on-chain) on Aevum testnet; no transaction.

| Field | Value |
|---|---|
| Site | https://shaida.onrender.com (Render free web service, Frankfurt; state in Upstash Redis; UptimeRobot on /api/health every 5 min, as set up by the builder per DEPLOY_RENDER.md) |
| Date (UTC) | 2026-11-23T02:55:21Z |
| origin/master | `1263fe24f1fba42f06e9d51dd345f42e25998fee` |
| Checked from | Intel(R) Core(TM) i3 CPU M 370 @ 2.40GHz; node v24.19.0; Chromium 153.0.8010.52 Arch Linux |

| Check | Result | Seconds | Detail |
|---|---|---:|---|
| /api/health (commit = origin/master, 44005, redis) | PASS | 0.6 | {"ok":true,"commit":"1263fe24f1fba42f06e9d51dd345f42e25998fee","networks":[{"key":"aevum","chainId":44005}],"store":"redis","at":"2026-11-23T02:54:25.000Z"}  |
| / landing, logged out | PASS | 0.6 | See a live proof It expires 22 Dec 2026 example link present  |
| /app dashboard | PASS | 0.5 | HTTP 200  |
| /v verify page | PASS | 0.5 | HTTP 200  |
| /gloam/shield.wasm | PASS | 1.4 | 1835706 bytes, header 58157ec90f8af891…, body 58157ec90f8af891…  |
| /gloam/shield_final.zkey | PASS | 0.9 | 250049 bytes, header 3054877c35e2e0e9…, body 3054877c35e2e0e9…  |
| /gloam/transfer.wasm | PASS | 1.5 | 2208203 bytes, header 081929509c3477ee…, body 081929509c3477ee…  |
| /gloam/transfer_final.zkey | PASS | 1.9 | 3689145 bytes, header bdbae966705bc85e…, body bdbae966705bc85e…  |
| /gloam/unshield.wasm | PASS | 1.4 | 2201696 bytes, header 84ac0942b1618c61…, body 84ac0942b1618c61…  |
| /gloam/unshield_final.zkey | PASS | 1.8 | 3270201 bytes, header 5a12073f3f84b52f…, body 5a12073f3f84b52f…  |
| /circuits/income/income.wasm | PASS | 1.4 | 2421509 bytes, header 8fb36f38c220edb2…, body 8fb36f38c220edb2…  |
| /circuits/income/income_final.zkey | PASS | 6.2 | 26563438 bytes, header cbcb06fecdf72b47…, body cbcb06fecdf72b47…  |
| /api/relay?chainId=44005 (enabled, relayer 0xF4945dD57C8de1C637966179df5b631689901422) | PASS | 0.5 | {"enabled":true,"relayer":"0xF4945dD57C8de1C637966179df5b631689901422","functions":["deposit","vouchedPay","lateVouch","sweep","memo","unshield"],"reason":null}  |
| /api/index?chainId=44005 synced to the head | PASS | 8.5 | behind 0 blocks, complete true, syncedTo 3883813 (chain head 3883815), 6 ledger leaves, 13 pool leaves, after 3 requests  |
| Bola opens the example link in headless Chromium at 390 px: VALID, Check on-chain | PASS | 28.8 | Bola on https://shaida.onrender.com (Aevum testnet 44005): VALID Paid at least 3 tUSD8 in 3 payments from registered pay Check on-chain: IncomeVerifier.check passed for 1 proof at block 3883841. Nothi |

Browser report and screenshot: [evidence/hosting-ui/report-390.md](hosting-ui/report-390.md).
