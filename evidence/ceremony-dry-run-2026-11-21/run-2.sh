#!/usr/bin/env bash
set -euo pipefail
export CEREMONY_DIR=<dry-run-2-dir> PTAU_PATH=<repo>/powers/powersOfTau28_hez_final_17.ptau
cd <repo>
C="pnpm --silent --filter @shaida/ceremony"
echo "== wrong hash"; if $C verify --zkey work/income_0002.zkey --expect "2:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; then echo UNEXPECTED; exit 1; fi
echo "== right hash"; $C verify --zkey work/income_0002.zkey --expect "2:2ad1a7e97792a98ee880b87314f57f0937066931b8111111e17205ccf8af87be7861067576f7e2b528a97b3271801adb3635d4230d7e55dbb3afee328e59e04a"
ls -1 $CEREMONY_DIR/logs; head -2 $CEREMONY_DIR/logs/*.txt
echo "== hidden prompt through a pty (short entropy, must refuse)"
if printf 'tooshort\r' | script -qec "pnpm --silent --filter @shaida/ceremony contribute --in work/income_0002.zkey --out work/income_0003.zkey --name pty-test" /dev/null; then echo UNEXPECTED; exit 1; fi
echo "== hidden prompt through a pty (long entropy)"
printf 'kq3j4h5gk2j3h4g5kj23h4g5kj2h3g4k5jh23g4k5jh2g3k4j5h2g3k4jh5g2k3j4h5g\r' | script -qec "pnpm --silent --filter @shaida/ceremony contribute --in work/income_0002.zkey --out work/income_0003.zkey --name pty-test" /dev/null
test -f $CEREMONY_DIR/work/income_0003.zkey && echo "0003 written"
echo DONE
