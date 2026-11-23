#!/usr/bin/env bash
# Runs a `tools/render-build.sh` output the way Render's free instance would: `next start` in a systemd user scope
# capped at 512 MB (MemoryMax, OOM-killed above it) and 10% of one CPU (CPUQuota), state in a real Redis behind
# Upstash's REST protocol (docker), reading Aevum testnet 44005. Logged-out checks: /api/health, /, /app, /v, the
# example link, /api/index synced to the head, /api/relay, every proving file with its pinned sha256. Also the
# startup refusal: the same server without Redis env must exit. Writes evidence/render-rehearsal.md.
# Usage: bash tools/render-rehearsal.sh <built clone>   (the clone must have run tools/render-build.sh)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$(cd "${1:?usage: render-rehearsal.sh <built clone>}" && pwd)"
PORT=3300
SRH_PORT=8078
NET="shaida-rehearsal-$$"
TOKEN="local_test_token_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
OUT="$REPO/evidence/render-rehearsal.md"
SAMPLES="$(mktemp -p "${XDG_CACHE_HOME:-$HOME/.cache}")"
LOG="$(mktemp -p "${XDG_CACHE_HOME:-$HOME/.cache}")"
SAMPLER=""
cleanup() {
  # one unit per call: `systemctl stop A B` stops neither when B has already exited
  for u in shaida-rehearsal-app.scope shaida-rehearsal-refuse.scope; do systemctl --user stop "$u" >/dev/null 2>&1 || true; done
  [[ -n "$SAMPLER" ]] && kill "$SAMPLER" 2>/dev/null || true
  docker rm -f "$NET-redis" "$NET-srh" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -f "$SAMPLES" "$LOG"
}
trap cleanup EXIT
base="http://127.0.0.1:$PORT"
if ss -ltn | grep -q ":$PORT "; then echo "render-rehearsal: port $PORT is taken (a previous run still up?)"; exit 1; fi
commit="$(git -C "$APP" rev-parse HEAD)"
start_env=(HOME="$HOME" PATH="$PATH" RENDER=true PORT="$PORT" TRUSTED_IP_HEADER=cf-connecting-ip)

# 1 startup refusal: production, Render, no Upstash env → the process exits on its own with StoreNotConfigured
t0=$(date +%s)
set +e
systemd-run --user --scope --quiet --unit=shaida-rehearsal-refuse -p MemoryMax=512M -p CPUQuota=10% \
  env -i "${start_env[@]}" bash -c "cd '$APP/web' && exec timeout 120 ./node_modules/.bin/next start" >"$LOG" 2>&1
refuse_code=$?
set -e
refuse_s=$(( $(date +%s) - t0 ))
refuse_line="$(grep -o 'StoreNotConfigured: [^.]*\.' "$LOG" | head -1)"

# 2 Redis behind serverless-redis-http
docker network create "$NET" >/dev/null
docker run -d --name "$NET-redis" --network "$NET" redis:7.4.1-alpine >/dev/null
docker run -d --name "$NET-srh" --network "$NET" -p "127.0.0.1:$SRH_PORT:80" -e SRH_MODE=env -e SRH_TOKEN="$TOKEN" \
  -e SRH_CONNECTION_STRING="redis://$NET-redis:6379" hiett/serverless-redis-http:0.0.10 >/dev/null
for _ in $(seq 1 60); do curl -s -m 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$SRH_PORT/ping" | grep -q PONG && break; sleep 1; done

# 3 the app under Render free's limits
t0=$(date +%s)
systemd-run --user --unit=shaida-rehearsal-app --scope --quiet -p MemoryMax=512M -p CPUQuota=10% \
  env -i "${start_env[@]}" UPSTASH_REDIS_REST_URL="http://127.0.0.1:$SRH_PORT" UPSTASH_REDIS_REST_TOKEN="$TOKEN" \
  bash -c "cd '$APP/web' && exec ./node_modules/.bin/next start" >"$LOG" 2>&1 &
cg=""
for _ in $(seq 1 120); do
  cg=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value shaida-rehearsal-app.scope 2>/dev/null)
  curl -s -m 5 -o /dev/null "$base/api/health" && break
  sleep 1
done
ready_s=$(( $(date +%s) - t0 ))
( while [[ -e "$cg/memory.current" ]]; do echo "$(date +%s) $(cat "$cg/memory.current")" >>"$SAMPLES"; sleep 1; done ) &
SAMPLER=$!
mem_now() { awk '{print int($1/1048576)}' "$cg/memory.current"; }
idle_mb=$(sleep 5; mem_now)

rows=()
check() { # name, command → a table row; never stops the script, so every check is recorded
  local name="$1"; shift
  local t=$(date +%s.%N) out ok
  if out="$("$@" 2>&1)"; then ok=PASS; else ok=FAIL; fi
  rows+=("| $name | $ok | $(printf '%.1f' "$(echo "$(date +%s.%N) $t" | awk '{print $1-$2}')") | $(echo "$out" | tr '\n|' ' /' | cut -c1-160) |")
}
status_is() { local code; code=$(curl -s -m 120 -o /dev/null -w '%{http_code}' "$base$1"); echo "HTTP $code"; [[ "$code" == "$2" ]]; }
health() { local j; j=$(curl -s -m 30 "$base/api/health"); echo "$j"; echo "$j" | grep -q "\"commit\":\"$commit\"" && echo "$j" | grep -q '"chainId":44005' && echo "$j" | grep -q '"store":"redis"'; }
landing() { local h; h=$(curl -s -m 120 "$base/"); echo "$h" | grep -o 'See a live proof' | head -1; echo "$h" | grep -q 'href="/v#ey' && echo "example link present"; }
index_synced() {
  local j behind=1 n=0
  while :; do
    n=$((n + 1))
    j=$(curl -s -m 300 "$base/api/index?chainId=44005")
    behind=$(echo "$j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.error){console.log("ERR "+j.error.code);process.exit(0)}console.log(j.behind+" "+j.complete+" "+j.snapshot.ledgerLeaves.length+" "+j.snapshot.poolLeaves.length)})')
    [[ "$behind" == ERR* || $n -ge 20 ]] && { echo "$behind after $n requests"; return 1; }
    [[ "${behind%% *}" -lt 50 ]] && { echo "behind ${behind%% *} blocks, complete ${behind#* } (ledger leaves, pool leaves) after $n requests"; return 0; }
  done
}
relay_info() { local j; j=$(curl -s -m 30 "$base/api/relay?chainId=44005"); echo "$j"; echo "$j" | grep -q '"enabled":false'; }
pinned() { # path, sha256
  local hdr got
  hdr=$(curl -s -m 300 -D - -o "$LOG.bin" "$base$1" | tr -d '\r' | grep -i '^x-shaida-sha256:' | awk '{print $2}')
  got=$(sha256sum "$LOG.bin" | cut -d' ' -f1)
  echo "$(stat -c %s "$LOG.bin") bytes, header ${hdr:0:12}…, body ${got:0:12}…"
  rm -f "$LOG.bin"
  [[ "$hdr" == "$2" && "$got" == "$2" ]]
}

check "/api/health (commit, 44005, redis)" health
check "/ landing, logged out" landing
check "/app dashboard" status_is /app 200
check "/v verify page" status_is /v 200
check "/api/index synced to the head of 44005" index_synced
check "/api/index again (served from this process, Redis written at most once a minute)" status_is "/api/index?chainId=44005" 200
check "/api/relay (no relayer key here: refuses as unavailable)" relay_info
while read -r path sha; do check "$path" pinned "$path" "$sha"; done < <(node -e '
  const g=require(process.argv[1]+"/packages/shaida-pay/gloam-artifacts.json"), i=require(process.argv[1]+"/packages/shaida-pay/income-artifacts.json");
  for (const c of ["shield","transfer","unshield"]) for (const k of ["wasm","zkey"]) console.log(`/gloam/${g[c][k].file} ${g[c][k].sha256}`);
  for (const k of ["wasm","zkey"]) console.log(`/circuits/income/${i[k].file} ${i[k].sha256}`);' "$APP")
keys=$(docker exec "$NET-redis" redis-cli --scan --pattern 'shaida:*' | sort | tr '\n' ' ')
sleep 3
end_mb=$(mem_now)
peak_mb=$(awk '{print int($1/1048576)}' "$cg/memory.peak")
max_sampled=$(awk 'BEGIN{m=0}{if($2>m)m=$2}END{print int(m/1048576)}' "$SAMPLES")
oom=$(grep -E '^oom_kill ' "$cg/memory.events" | awk '{print $2}')

{
  echo "# Render free rehearsal: next start under 512 MB and 0.1 CPU"
  echo
  echo "Written by \`bash tools/render-rehearsal.sh <clone>\`. Do not edit by hand. This is a local rehearsal, not Render:"
  echo "the limits are a systemd scope (MemoryMax=512M, CPUQuota=10%) on this machine, Redis is 7.4.1 behind"
  echo "serverless-redis-http (Upstash's REST protocol, not Upstash), and the chain is the real Aevum testnet 44005."
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| Date (UTC) | $(date -u +%Y-%m-%dT%H:%M:%SZ) |"
  echo "| Commit (fresh clone, built by tools/render-build.sh with Render's env only) | \`$commit\` |"
  echo "| Machine | $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs), $(nproc) threads, $(awk '/MemTotal/{printf "%.1f GiB", $2/1048576}' /proc/meminfo); node $(node -v) |"
  echo "| Startup refusal (no Upstash env, RENDER=true) | exit $refuse_code after ${refuse_s} s: \`${refuse_line:-none}\` |"
  echo "| Ready (first /api/health answer) | ${ready_s} s |"
  echo "| Memory: idle after start | ${idle_mb} MB |"
  echo "| Memory: after all checks | ${end_mb} MB |"
  echo "| Memory: peak (cgroup memory.peak) | ${peak_mb} MB of 512 (highest 1 s sample ${max_sampled} MB) |"
  echo "| OOM kills | ${oom:-0} |"
  echo "| Redis keys written | \`${keys:-none}\` |"
  echo
  echo "| Check | Result | Seconds | Detail |"
  echo "|---|---|---:|---|"
  printf '%s\n' "${rows[@]}"
} >"$OUT"
cat "$OUT"
grep -q '| FAIL |' "$OUT" && exit 1
[[ "$refuse_code" == 78 ]] || { echo "startup refusal: expected exit 78, got $refuse_code"; exit 1; }
exit 0
