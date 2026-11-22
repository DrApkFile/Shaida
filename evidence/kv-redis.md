# Relayer store on a real Redis (RS01–RS05)

Written by `make test-redis` (tools/test-redis.sh). Do not edit by hand.

| Field | Value |
|---|---|
| Date (UTC) | 2026-11-22T12:54:27Z |
| Commit | `48872c3509b2ca5641d5e05335454cde57db5fef` |
| Redis | `redis@sha256:c1e88455c85225310bbea54816e9c3f4b5295815e6dbf80c34d40afc6df28275` |
| REST layer | `hiett/serverless-redis-http@sha256:65128347949bca511e448fd7238780d624573d74c22b79155a7563db19e9b678` (serverless-redis-http: Upstash's REST protocol, not Upstash itself) |
| Client | @upstash/redis 1.41.0, node v24.19.0 |
| Result | PASS |

Not covered: Upstash's own service (no account was used); this shows the Lua and the client calls on Redis 7.4.

```
  ✔ RS01 claim writes a record and its key only while the key's holder is the expected one
  ✔ RS02 put replaces an existing record and refuses to create one
  ✔ RS03 the day's committed gas sums the day's records (limit while in flight, gasUsed once mined)
  ✔ RS04 hit counts a sliding one-minute window per bucket
  ✔ RS05 the chain lock serializes two processes' tasks and is released after each, also after a failure
✔ RS store conformance on in-memory fake
  ✔ RS01 claim writes a record and its key only while the key's holder is the expected one
  ✔ RS02 put replaces an existing record and refuses to create one
  ✔ RS03 the day's committed gas sums the day's records (limit while in flight, gasUsed once mined)
  ✔ RS04 hit counts a sliding one-minute window per bucket
  ✔ RS05 the chain lock serializes two processes' tasks and is released after each, also after a failure
✔ RS store conformance on Redis via REST at 127.0.0.1:8079
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0
```
