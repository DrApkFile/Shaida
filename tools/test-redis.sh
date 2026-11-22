#!/usr/bin/env bash
# Runs the relayer store conformance suite (RS01–RS05) against a real Redis through Upstash's REST protocol: Redis
# 7.4.1 behind serverless-redis-http (the local stand-in for Upstash's REST API), with the same @upstash/redis client
# production uses. This executes the Lua scripts; the unit tests run their emulation. Writes evidence/kv-redis.md.
# Needs docker. Starts two containers on a private network and removes them on exit. Usage: make test-redis
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REDIS_IMAGE=redis:7.4.1-alpine
SRH_IMAGE=hiett/serverless-redis-http:0.0.10
TOKEN="local_test_token_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
NET="shaida-kv-$$"
PORT="${SHAIDA_KV_TEST_PORT:-8079}"
cleanup() { docker rm -f "$NET-redis" "$NET-srh" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$NET-redis" --network "$NET" "$REDIS_IMAGE" >/dev/null
docker run -d --name "$NET-srh" --network "$NET" -p "127.0.0.1:$PORT:80" -e SRH_MODE=env -e SRH_TOKEN="$TOKEN" \
  -e SRH_CONNECTION_STRING="redis://$NET-redis:6379" "$SRH_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  curl -s -m 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/ping" | grep -q PONG && break
  sleep 1
done

log="$(mktemp)"
set +e
SHAIDA_KV_TEST_URL="http://127.0.0.1:$PORT" SHAIDA_KV_TEST_TOKEN="$TOKEN" pnpm --silent --filter @shaida/relay test:redis >"$log" 2>&1
code=$?
set -e
digest() { docker image inspect --format '{{index .RepoDigests 0}}' "$1"; }
{
  echo "# Relayer store on a real Redis (RS01–RS05)"
  echo
  echo "Written by \`make test-redis\` (tools/test-redis.sh). Do not edit by hand."
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| Date (UTC) | $(date -u +%Y-%m-%dT%H:%M:%SZ) |"
  echo "| Commit | \`$(git rev-parse HEAD)\`$( [[ -n "$(git status --porcelain --untracked-files=no -- . ':!evidence/kv-redis.md' ':!tools/test-redis.sh')" ]] && echo ' (uncommitted changes present)') |"
  echo "| Redis | \`$(digest "$REDIS_IMAGE")\` |"
  echo "| REST layer | \`$(digest "$SRH_IMAGE")\` (serverless-redis-http: Upstash's REST protocol, not Upstash itself) |"
  echo "| Client | @upstash/redis $(node -p 'require("./packages/shaida-kv/node_modules/@upstash/redis/package.json").version'), node $(node -v) |"
  echo "| Result | $([[ $code == 0 ]] && echo PASS || echo "FAIL (exit $code)") |"
  echo
  echo "Not covered: Upstash's own service (no account was used); this shows the Lua and the client calls on Redis 7.4."
  echo
  echo '```'
  grep -E '^(✔|✖|﹣|  ✔|  ✖|  ﹣|ℹ (tests|pass|fail|skipped))' "$log" | sed -E 's/ \([0-9.]+ms\)$//'
  echo '```'
} > evidence/kv-redis.md
rm -f "$log"
cat evidence/kv-redis.md
exit $code
