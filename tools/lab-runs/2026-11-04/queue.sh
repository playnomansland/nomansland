#!/bin/bash
# Overnight queue: waits for run 1, then run 3 (hoarder, 3 conditions in parallel), then run 4 (random maps, 3 shards).
cd "$(dirname "$0")/../../.."
D=tools/lab-runs/2026-11-04
while pgrep -f "balance-lab.js --matches 33[34] --seed 800" >/dev/null; do sleep 20; done
echo "$(date -u +%T) run1 done" >> $D/queue.log
node tools/lab-hoard.js --matches 300 --seed 810000 --cap on  --out $D/run3-pure-capon.json  > $D/run3-pure-capon.log 2>&1 &
node tools/lab-hoard.js --matches 300 --seed 810000 --cap off --out $D/run3-pure-capoff.json > $D/run3-pure-capoff.log 2>&1 &
node tools/lab-hoard.js --matches 300 --seed 810000 --cap on --keep 500 --out $D/run3-keep500-capon.json > $D/run3-keep500-capon.log 2>&1 &
wait
echo "$(date -u +%T) run3 done" >> $D/queue.log
node tools/balance-lab.js --matches 500 --seed 820000 --map random --no-mirror --out $D/run4-shard0.json > $D/run4-shard0.log 2>&1 &
node tools/balance-lab.js --matches 500 --seed 820500 --map random --no-mirror --out $D/run4-shard1.json > $D/run4-shard1.log 2>&1 &
node tools/balance-lab.js --matches 500 --seed 821000 --map random --no-mirror --out $D/run4-shard2.json > $D/run4-shard2.log 2>&1 &
wait
echo "$(date -u +%T) run4 done" >> $D/queue.log
