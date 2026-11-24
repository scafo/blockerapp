#!/bin/zsh
# fronte livello minuti runs
cd "$(dirname $0)/../.."
OUT=docs/econ/out; mkdir -p $OUT
cat <<'L' | xargs -P 8 -L 1 zsh -c 'npx vite-node docs/econ/simecon.ts $0 $1 $2 $3 $4 > docs/econ/out/f$0-l$1-m$2-$4.jsonl 2>docs/econ/out/f$0-l$1-m$2-$4.err'
0 0 20 3 a
0 0 20 3 b
0 0 10 4 a
0 0 30 3 a
1 0 20 3 a
1 1 20 3 a
2 0 20 3 a
2 1 20 3 a
3 1 20 3 a
3 2 20 3 a
4 2 20 3 a
5 2 20 3 a
L
