#!/bin/bash
# After run 4: run 2b, a paired A/B on the Sniper's Hunter (one side's AI never sees it), seeds as run 1.
cd "$(dirname "$0")/../../.."
D=tools/lab-runs/2026-11-04
until grep -q "run4 done" $D/queue.log 2>/dev/null; do sleep 20; done
node tools/lab-hoard.js --matches 334 --seed 800000 --hoarder none --no-mirror --ban-skill Sniper:hunter --out $D/run2b-shard0.json > $D/run2b-shard0.log 2>&1 &
node tools/lab-hoard.js --matches 333 --seed 800334 --hoarder none --no-mirror --ban-skill Sniper:hunter --out $D/run2b-shard1.json > $D/run2b-shard1.log 2>&1 &
node tools/lab-hoard.js --matches 333 --seed 800667 --hoarder none --no-mirror --ban-skill Sniper:hunter --out $D/run2b-shard2.json > $D/run2b-shard2.log 2>&1 &
wait
echo "$(date -u +%T) run2b done" >> $D/queue.log
