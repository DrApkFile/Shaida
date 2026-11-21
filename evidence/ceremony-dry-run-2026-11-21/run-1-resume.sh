#!/usr/bin/env bash
# DRY RUN of the ceremony with test entropy, in the scratchpad. Never the real ceremony.
set -euo pipefail
REPO=<repo>
S=<scratch>
export CEREMONY_DIR=$S/dry
export PTAU_PATH=$REPO/powers/powersOfTau28_hez_final_17.ptau
C="pnpm --silent --filter @shaida/ceremony"
C="pnpm --silent --filter @shaida/ceremony"
cd $REPO
echo "== verify 2 with a WRONG reported hash (must refuse)"; if $C verify --zkey work/income_0002.zkey --expect "2:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; then echo "UNEXPECTED: accepted a wrong hash"; exit 1; fi
echo "== contribute to a stale input (must refuse)"; if CEREMONY_TEST_ENTROPY=x $C contribute --in work/income_0000.zkey --out work/stale.zkey --name stale; then echo "UNEXPECTED"; exit 1; fi
echo "== verify 2 --expect"; $C verify --zkey work/income_0002.zkey --expect "2:2ad1a7e97792a98ee880b87314f57f0937066931b8111111e17205ccf8af87be7861067576f7e2b528a97b3271801adb3635d4230d7e55dbb3afee328e59e04a"
echo "== beacon announce (0.02 h, real Aevum RPC)"; BEACON_DELAY_HOURS=0.02 $C beacon announce
echo "== beacon announce again (must refuse)"; if $C beacon announce; then echo "UNEXPECTED"; exit 1; fi
echo "== beacon apply too early (must refuse)"; if $C beacon apply; then echo "UNEXPECTED: applied early"; exit 1; fi
sleep 170
echo "== beacon apply"; $C beacon apply
echo "== verify final"; $C verify --zkey work/income_final.zkey
echo "== finalize"; time $C finalize
echo "DRY RUN COMPLETE"
