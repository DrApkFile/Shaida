#!/usr/bin/env bash
# DRY RUN of the ceremony with test entropy, in the scratchpad. Never the real ceremony.
set -euo pipefail
REPO=<repo>
S=<scratch>
export CEREMONY_DIR=$S/dry
export PTAU_PATH=$REPO/powers/powersOfTau28_hez_final_17.ptau
rm -rf "$CEREMONY_DIR"; mkdir -p "$CEREMONY_DIR"
C="pnpm --silent --filter @shaida/ceremony"
cd $REPO
echo "== prepare"; time $C prepare-setup
echo "== contribute 1 (our script)"; CEREMONY_TEST_ENTROPY="dry run one, not a ceremony $(date +%s%N)" $C contribute --in work/income_0000.zkey --out work/income_0001.zkey --name "dry builder"
echo "== verify 1"; time $C verify --zkey work/income_0001.zkey
echo "== contribute 2 (plain snarkjs CLI, as CONTRIBUTE.md)"
cd $CEREMONY_DIR/work
OUT=$(node $REPO/ceremony/node_modules/snarkjs/build/cli.cjs zkey contribute income_0001.zkey income_0002.zkey --name="dry outsider" -e="dry run two $(date +%s%N)")
echo "$OUT"
HASH=$(echo "$OUT" | grep -A4 "Contribution Hash" | tail -4 | tr -d ' \t\n' | sed 's/.*\]//')
echo "reported hash: $HASH"
cd $REPO
echo "== verify 2 --expect"; $C verify --zkey work/income_0002.zkey --expect "2:$HASH"
echo "== beacon announce (0.02 h, real Aevum RPC)"; BEACON_DELAY_HOURS=0.02 $C beacon announce
echo "== beacon apply too early (must refuse)"; if $C beacon apply; then echo "UNEXPECTED: applied early"; exit 1; fi
sleep 170
echo "== beacon apply"; $C beacon apply
echo "== verify final"; $C verify --zkey work/income_final.zkey
echo "== finalize"; time $C finalize
echo "DRY RUN COMPLETE"
