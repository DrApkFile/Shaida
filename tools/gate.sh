#!/usr/bin/env bash
# The BUILD_CONTRACT gate. `make gate` runs it in a fresh clone of HEAD (committed work only); CI, whose checkout
# is already clean, runs it in place with GATE_IN_PLACE=1.
#   1 install (frozen lockfile, Gloam artifacts sha256-pinned)   5 unit, circuit, indexer, relayer, flow, ceremony tests
#   2 forge build + Shanghai check                                6 fork tests on real tUSD8 (INCONCLUSIVE if the RPC
#   3 circuit compile + artifact hash check                         is unreachable: never a pass, never silently skipped)
#   4 typecheck + lint                                            7 claims check (README claims ⊆ PROVEN)
#                                                                 8 secret scan (gitleaks over the whole git history)
# Exit: 0 PASS, 1 FAIL (first failing step stops the gate), 3 INCONCLUSIVE (all else passed, fork tests not run).
set -euo pipefail

AEVUM_RPC="${AEVUM_RPC:-https://rpc-test.qday.info}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
declare -a RESULTS=()
started=$(date +%s)

if [[ "${GATE_IN_PLACE:-0}" == "1" ]]; then
  ROOT="$SRC"
  echo "gate: in place at $ROOT ($(git -C "$ROOT" rev-parse --short HEAD))"
else
  sha="$(git -C "$SRC" rev-parse HEAD)"
  if [[ -n "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]]; then
    echo "gate: note: uncommitted changes are NOT in the gate; it checks commit ${sha:0:12}"
  fi
  # On disk, not /tmp: a clone with node_modules and build outputs is ~2 GB, and /tmp is often RAM-backed (tmpfs).
  # Removed on exit, pass or fail; GATE_KEEP=1 keeps it for debugging.
  GATE_DIR="${GATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/shaida-gate}"
  mkdir -p "$GATE_DIR"
  ROOT="$(mktemp -d "$GATE_DIR/run.XXXXXX")"
  if [[ "${GATE_KEEP:-0}" != "1" ]]; then trap 'rm -rf -- "$ROOT"' EXIT; fi
  echo "gate: fresh clone of ${sha:0:12} in $ROOT"
  git clone --quiet --no-hardlinks "$SRC" "$ROOT"
  git -C "$ROOT" checkout --quiet "$sha"
  # Submodules come from the URLs in .gitmodules, as in any clone.
  git -C "$ROOT" submodule update --init --recursive --quiet
fi
cd "$ROOT"

summary() {
  local verdict="$1"
  echo
  echo "| Step | Result | Seconds |"
  echo "|---|---|---:|"
  for r in "${RESULTS[@]}"; do echo "$r"; done
  echo
  echo "gate: $verdict at $(git rev-parse --short HEAD) in $(( $(date +%s) - started )) s"
}

step() {
  local name="$1"; shift
  local t0=$(date +%s)
  echo
  echo "━━ $name"
  if "$@"; then
    RESULTS+=("| $name | PASS | $(( $(date +%s) - t0 )) |")
  else
    RESULTS+=("| $name | **FAIL** | $(( $(date +%s) - t0 )) |")
    summary "FAIL ($name)"
    exit 1
  fi
}

install() {
  pnpm install --frozen-lockfile
  node tools/copy-gloam-artifacts.mjs
}
forge_build() {
  (cd contracts && forge build)
  node tools/check-shanghai.mjs contracts/out
}
circuit() {
  pnpm --filter @shaida/proofs compile
  node tools/check-artifacts.mjs
}
types_and_lint() {
  pnpm -r --if-present run typecheck
  node tools/lint.mjs
}
unit_tests() {
  (cd contracts && forge test --no-match-path 'test/fork/*')
  pnpm --filter @shaida/proofs test
  pnpm --filter @shaida/kv test
  pnpm --filter @shaida/index test
  pnpm --filter @shaida/relay test
  pnpm --filter @shaida/pay test
  pnpm --filter @shaida/ceremony test
}

step "1 install" install
step "2 forge build + Shanghai check" forge_build
step "3 circuit compile + artifact hashes" circuit
step "4 typecheck + lint" types_and_lint
step "5 unit, circuit, indexer, relayer, flow tests" unit_tests

echo
echo "━━ 6 fork tests (real tUSD8 via $AEVUM_RPC)"
reply="$(curl -sS --max-time 20 --retry 2 --retry-all-errors -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$AEVUM_RPC" 2>&1 || true)"
fork="INCONCLUSIVE"
if [[ "$reply" == *'"result":"0xabe5"'* ]]; then
  t0=$(date +%s)
  if (cd contracts && forge test --match-path 'test/fork/*' --fork-url "$AEVUM_RPC"); then
    RESULTS+=("| 6 fork tests | PASS | $(( $(date +%s) - t0 )) |"); fork="PASS"
  else
    RESULTS+=("| 6 fork tests | **FAIL** | $(( $(date +%s) - t0 )) |"); summary "FAIL (6 fork tests)"; exit 1
  fi
else
  echo "INCONCLUSIVE: eth_chainId on $AEVUM_RPC did not return 0xabe5 (reply: ${reply:0:200}). Fork tests NOT run."
  RESULTS+=("| 6 fork tests | **INCONCLUSIVE** (RPC unreachable, not run) | 0 |")
fi

step "7 claims check" node tools/check-claims.mjs
secret_scan() {
  command -v gitleaks > /dev/null || { echo "gitleaks not installed (pinned: 8.21.2, see .gitleaks.toml): the secret scan cannot run"; return 1; }
  gitleaks detect --source . --config .gitleaks.toml --redact --no-banner
}
step "8 secret scan (gitleaks, whole history)" secret_scan

if [[ "$fork" == "PASS" ]]; then summary "PASS"; exit 0; fi
summary "INCONCLUSIVE (fork tests not run; everything else passed)"
exit 3
