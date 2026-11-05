# Handoff E2: 2v2, put your units in your ally's horse

Branch `duo-horse`. Start after group D (`docs/HANDOFF-DUO-VIEW.md`) is on main: you build on its `ownerOf` helper, ally sheets and the `m.team` data. Read `docs/HANDOFFS-1105.md` first. Test ports 8772-8773.

Vilhelm: "You can drop units in allies' horses."

## How carriers work now (src/game.js ~1026)

A carrier squad (Just a horse, `units[ui].carrier`) holds one squad of another unit. The rider is an ordinary squad with `sq.in` = the carrier's squad id, on the carrier's tile, hidden from the opponent (`hiddenFromFoe`). `boardable(m, side, col, row, ui)` finds a carrier with room; `riderOf`, `carrierOf`, `freeOut` (stepping out is free), the move code (~1733-1780) moves riders with their carrier. In a fight the rider stays inside until the carrier dies (engine). `src/duo.js` ~105 already re-points `b.inside` between lanes for Overwatch in the shared tower/treasury.

The catch: in 2v2 each player is a separate lane (a separate 1v1 match through the referee), so the horse and the rider live in different matches.

## Rules

- You can place a new squad onto your teammate's horse, or move one of yours into it (same costs and limits as boarding your own horse: deployment, the move rules, `freeOut` to step out).
- The horse must have room (one rider). Your squad must be a unit that may ride (same unit rules as now).
- The rider stays yours: your gold, your levels, skills, selling, XP, survivor damage. The horse stays theirs.
- Your teammate sees the rider on their horse (in your colour from group D's rings, with a small badge), opponents never do (same hiding as a normal rider).
- If the teammate moves the horse, your rider goes with it. If they sell it, your rider steps out on that tile (as when your own horse is sold; `outRound`). They can't remove your rider otherwise. (Claude's reading of "no consent needed"; put it under "To check with Vilhelm".)
- In the fight: the rider is inside the teammate's horse body and comes out when it dies, exactly as with your own horse.
- One rider per horse total, so the two of you can't both fill it: whoever is first holds it this round (the referee decides on the server; the second gets a refusal and the sync puts their squad back).

## Plumbing (suggestion)

- Store the cross-lane link on the rider: `sq.in = { lane: 1, id }` or a separate `sq.inMate = carrierId` (pick one, keep `isRider` true for it so hiding, moving and selling paths keep working). The rider's match needs to know the carrier's tile: read it from `m.team` (teammate's army), so moving the horse in lane B moves the rider's tile in lane A on the next sync.
- Server (`server/src/duo.js`): the DuoRoom sees both lanes. When a lane changes a horse (move, sell, a rider boards), fix the riders in the other lane in the same step, and include it in both players' syncs. The referee's per-lane checks (`Referee.act`) need a hook to ask "is there room in the teammate's horse at (col,row)?" (pass the teammate's army in, as `m.team` already does for tile sharing).
- Fight: `Duo.fight` builds all bodies of both lanes; set the rider body's `inside` to the teammate's horse body (as at ~105). `laneResult` splits back by lane as now.
- Page: dropping a squad on the teammate's horse tile = board it (today dropping on a teammate's tile is refused); the horse's sheet (teammate's, read-only) shows "Carries your X" with Step out.
- Bot teammate: it doesn't need to use this, but must not break when a human rides its horse (selling/moving its horse).

## Tests

- `tools/tests/duo.js` (headless): board an ally's horse; opponent's view hides it; teammate moves the horse -> rider follows; sells it -> rider steps out; both try to board the same horse in one round -> one wins; the fight: rider comes out when the horse dies, damage credited to its owner's lane.
- `tools/tests/horse-out.js` still passes (1v1 untouched).
- Browser `tools/tests/duo-horse-ui.js` (port 8772): drag a card onto the ally's horse; the badge on both teammates' boards.
- `cd server && npm test`.

PATCH-NOTES entry: "2v2: ride your ally's horse".
