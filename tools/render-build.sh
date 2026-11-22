#!/usr/bin/env bash
# The build Render runs (DEPLOY_RENDER.md): from a clone with submodules, produce `next build` output that serves
# only checked, final proving files. Also runs locally (`bash tools/render-build.sh`) to measure it.
#   1 circom 2.2.3 (official release binary, sha256-pinned, as in CI) unless the same one is on PATH
#   2 pnpm from package.json's packageManager (corepack), frozen lockfile
#   3 compile the income circuit (its r1cs must be the ceremony-bound one; copy-income-artifacts.mjs checks)
#   4 next build for Aevum testnet only; prebuild copies Gloam's final keys and the income final key, each refused
#     unless its sha256 matches the pins (the income zkey is fetched from release ceremony-v1)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
t0=$(date +%s)
step() { echo; echo "━━ render-build: $1 ($(( $(date +%s) - t0 )) s)"; }

[[ "${NEXT_PUBLIC_NETWORKS:-}" == "aevum" ]] || { echo "render-build: NEXT_PUBLIC_NETWORKS must be exactly 'aevum' (got '${NEXT_PUBLIC_NETWORKS:-}')"; exit 1; }
[[ -f contracts/lib/gloam/LICENSE ]] || { echo "render-build: contracts/lib/gloam is empty: the clone has no submodules"; exit 1; }

CIRCOM_SHA256=85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3
BIN="$PWD/.render-bin"
mkdir -p "$BIN"
export PATH="$BIN:$PATH"

step "circom"
if ! echo "$CIRCOM_SHA256  $(command -v circom || echo /nonexistent)" | sha256sum -c --status - 2>/dev/null; then
  curl -sSfL --retry 3 -o "$BIN/circom" https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64
  echo "$CIRCOM_SHA256  $BIN/circom" | sha256sum -c -
  chmod +x "$BIN/circom"
fi
circom --version

step "pnpm"
if ! command -v pnpm >/dev/null || [[ "$(pnpm -v)" != "$(node -p 'require("./package.json").packageManager.split("@")[1]')" ]]; then
  corepack enable --install-directory "$BIN" pnpm
fi
pnpm -v
pnpm install --frozen-lockfile

step "income circuit"
pnpm --filter @shaida/proofs compile
node tools/check-artifacts.mjs

step "next build"
pnpm --filter web build

step "done"
du -sh web/.next web/public/gloam web/public/circuits | sed 's/^/  /'
