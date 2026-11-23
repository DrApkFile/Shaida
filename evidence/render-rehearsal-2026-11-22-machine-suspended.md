# Render free rehearsal: next start under 512 MB and 0.1 CPU

Written by `bash tools/render-rehearsal.sh <clone>`. Do not edit by hand. This is a local rehearsal, not Render:
the limits are a systemd scope (MemoryMax=512M, CPUQuota=10%) on this machine, Redis is 7.4.1 behind
serverless-redis-http (Upstash's REST protocol, not Upstash), and the chain is the real Aevum testnet 44005.

| Field | Value |
|---|---|
| Date (UTC) | 2026-11-22T23:38:17Z |
| Commit (fresh clone, built by tools/render-build.sh with Render's env only) | `14b5310416825a2c2f316869217fa88f828a7c76` |
| Machine | Intel(R) Core(TM) i3 CPU M 370 @ 2.40GHz, 4 threads, 7.5 GiB; node v24.19.0 |
| Startup refusal (no Upstash env, RENDER=true) | exit 78 after 12 s: `StoreNotConfigured: the relayer and index store is Redis (production), but UPSTASH_REDIS_REST_URL (an https:// URL) and UPSTASH_REDIS_REST_TOKEN are not set.` |
| Ready (first /api/health answer) | 37103 s |
| Memory: idle after start | 60 MB |
| Memory: after all checks | 134 MB |
| Memory: peak (cgroup memory.peak) | 135 MB of 512 (highest 1 s sample 134 MB) |
| OOM kills | 0 |
| Redis keys written | `shaida:v1:index:44005 ` |

| Check | Result | Seconds | Detail |
|---|---|---:|---|
| /api/health (commit, 44005, redis) | PASS | 0.0 | {"ok":true,"commit":"14b5310416825a2c2f316869217fa88f828a7c76","networks":[{"key":"aevum","chainId":44005}],"store":"redis","at":"2026-11-22T23:37:19.130Z"}  |
| / landing, logged out | PASS | 0.8 | See a live proof example link present  |
| /app dashboard | PASS | 0.3 | HTTP 200  |
| /v verify page | PASS | 0.3 | HTTP 200  |
| /api/index synced to the head of 44005 | PASS | 43.5 | behind 0 blocks, complete true 6 13 (ledger leaves, pool leaves) after 7 requests  |
| /api/index again (served from this process, Redis written at most once a minute) | PASS | 3.0 | HTTP 200  |
| /api/relay (no relayer key here: refuses as unavailable) | PASS | 0.2 | {"enabled":false,"relayer":null,"functions":["deposit","vouchedPay","lateVouch","sweep","memo","unshield"],"reason":{"code":"RelayerUnavailable","message":"Gasl |
| /gloam/shield.wasm | PASS | 0.5 | 1835706 bytes, header 58157ec90f8a…, body 58157ec90f8a…  |
| /gloam/shield_final.zkey | PASS | 0.1 | 250049 bytes, header 3054877c35e2…, body 3054877c35e2…  |
| /gloam/transfer.wasm | PASS | 0.2 | 2208203 bytes, header 081929509c34…, body 081929509c34…  |
| /gloam/transfer_final.zkey | PASS | 0.4 | 3689145 bytes, header bdbae966705b…, body bdbae966705b…  |
| /gloam/unshield.wasm | PASS | 0.2 | 2201696 bytes, header 84ac0942b161…, body 84ac0942b161…  |
| /gloam/unshield_final.zkey | PASS | 0.4 | 3270201 bytes, header 5a12073f3f84…, body 5a12073f3f84…  |
| /circuits/income/income.wasm | PASS | 0.3 | 2421509 bytes, header 8fb36f38c220…, body 8fb36f38c220…  |
| /circuits/income/income_final.zkey | PASS | 4.3 | 26563438 bytes, header cbcb06fecdf7…, body cbcb06fecdf7…  |
