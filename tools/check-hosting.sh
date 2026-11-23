#!/usr/bin/env bash
# Read-only checks of the public deployment, logged out (DEPLOY_RENDER.md §4): /api/health (commit = origin/master,
# 44005, redis), the landing page and its example link, /app and /v, every proving file with its pinned sha256 (header
# and body), /api/relay (enabled, the funded relayer), /api/index synced to the chain head, and Bola's browser check of
# the example link at 390 px (VALID + Check on-chain, an eth_call). Sends no transaction and writes nothing to the site
# beyond what any visitor's GETs cause. Writes evidence/hosting-render.md (and evidence/hosting-ui/).
# Usage: bash tools/check-hosting.sh https://shaida.onrender.com
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="${1:?usage: check-hosting.sh <site URL>}"
SITE="${SITE%/}"
RPC=https://rpc-test.qday.info
RELAYER=0xF4945dD57C8de1C637966179df5b631689901422
OUT="$REPO/evidence/hosting-render.md"
TMP="$(mktemp -d -p "${XDG_CACHE_HOME:-$HOME/.cache}")"
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" fetch -q origin master
expected="$(git -C "$REPO" rev-parse origin/master)"

rows=()
check() { # name, command → a table row; never stops the script, so every check is recorded
  local name="$1"; shift
  local t=$(date +%s.%N) out ok
  if out="$("$@" 2>&1)"; then ok=PASS; else ok=FAIL; fi
  rows+=("| $name | $ok | $(printf '%.1f' "$(echo "$(date +%s.%N) $t" | awk '{print $1-$2}')") | $(echo "$out" | tr '\n|' ' /' | cut -c1-200) |")
}
status_is() { local code; code=$(curl -s -m 120 -o /dev/null -w '%{http_code}' "$SITE$1"); echo "HTTP $code"; [[ "$code" == "$2" ]]; }
health() {
  local j; j=$(curl -s -m 120 "$SITE/api/health"); echo "$j"
  echo "$j" | grep -q "\"commit\":\"$expected\"" && echo "$j" | grep -q '"chainId":44005' && echo "$j" | grep -q '"store":"redis"'
}
landing() {
  local h; h=$(curl -s -m 120 "$SITE/")
  echo "$h" | grep -o 'See a live proof' | head -1
  echo "$h" | grep -o 'It expires [0-9]* [A-Za-z]* [0-9]*' | head -1
  echo "$h" | grep -q 'href="/v#ey' && echo "example link present"
}
relay_info() {
  local j; j=$(curl -s -m 60 "$SITE/api/relay?chainId=44005"); echo "$j"
  echo "$j" | grep -q '"enabled":true' && echo "$j" | grep -qi "\"relayer\":\"$RELAYER\""
}
chain_head() { curl -s -m 30 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$RPC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(BigInt(JSON.parse(s).result).toString()))'; }
index_synced() {
  local j r n=0
  while :; do
    n=$((n + 1))
    j=$(curl -s -m 300 "$SITE/api/index?chainId=44005")
    r=$(echo "$j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.error){console.log("ERR "+j.error.code);return}console.log([j.behind,j.complete,j.snapshot.syncedTo,j.snapshot.ledgerLeaves.length,j.snapshot.poolLeaves.length].join(" "))})')
    [[ "$r" == ERR* || $n -ge 30 ]] && { echo "$r after $n requests"; return 1; }
    read -r behind complete synced ledger pool <<<"$r"
    if [[ "$behind" -lt 50 ]]; then
      echo "behind $behind blocks, complete $complete, syncedTo $synced (chain head $(chain_head)), $ledger ledger leaves, $pool pool leaves, after $n requests"
      return 0
    fi
  done
}
pinned() { # path, sha256
  local hdr got
  hdr=$(curl -s -m 300 -D - -o "$TMP/body" "$SITE$1" | tr -d '\r' | grep -i '^x-shaida-sha256:' | awk '{print $2}')
  got=$(sha256sum "$TMP/body" | cut -d' ' -f1)
  echo "$(stat -c %s "$TMP/body") bytes, header ${hdr:0:16}…, body ${got:0:16}…"
  [[ "$hdr" == "$2" && "$got" == "$2" ]]
}
browser() {
  node "$REPO/tools/ui-verify-live.mjs" --base "$SITE" --width 390 --out evidence/hosting-ui >"$TMP/ui.log" 2>&1 || { cat "$TMP/ui.log"; return 1; }
  grep -E '^(Bola on|Check on-chain|screenshot)' "$TMP/ui.log" | cut -c1-120
}

check "/api/health (commit = origin/master, 44005, redis)" health
check "/ landing, logged out" landing
check "/app dashboard" status_is /app 200
check "/v verify page" status_is /v 200
while read -r path sha; do check "$path" pinned "$path" "$sha"; done < <(node -e '
  const g=require(process.argv[1]+"/packages/shaida-pay/gloam-artifacts.json"), i=require(process.argv[1]+"/packages/shaida-pay/income-artifacts.json");
  for (const c of ["shield","transfer","unshield"]) for (const k of ["wasm","zkey"]) console.log(`/gloam/${g[c][k].file} ${g[c][k].sha256}`);
  for (const k of ["wasm","zkey"]) console.log(`/circuits/income/${i[k].file} ${i[k].sha256}`);' "$REPO")
check "/api/relay?chainId=44005 (enabled, relayer $RELAYER)" relay_info
check "/api/index?chainId=44005 synced to the head" index_synced
check "Bola opens the example link in headless Chromium at 390 px: VALID, Check on-chain" browser

{
  echo "# Public hosting: the live site, checked logged out"
  echo
  echo "Written by \`bash tools/check-hosting.sh $SITE\`. Do not edit by hand. Read-only: GET requests as a logged-out"
  echo "visitor, one eth_blockNumber and one eth_call (Check on-chain) on Aevum testnet; no transaction."
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| Site | $SITE (Render free web service, Frankfurt; state in Upstash Redis; UptimeRobot on /api/health every 5 min, as set up by the builder per DEPLOY_RENDER.md) |"
  echo "| Date (UTC) | $(date -u +%Y-%m-%dT%H:%M:%SZ) |"
  echo "| origin/master | \`$expected\` |"
  echo "| Checked from | $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs); node $(node -v); $(/usr/bin/chromium --version 2>/dev/null | head -1) |"
  echo
  echo "| Check | Result | Seconds | Detail |"
  echo "|---|---|---:|---|"
  printf '%s\n' "${rows[@]}"
  echo
  echo "Browser report and screenshot: [evidence/hosting-ui/report-390.md](hosting-ui/report-390.md)."
} >"$OUT"
cat "$OUT"
grep -q '| FAIL |' "$OUT" && exit 1
exit 0
