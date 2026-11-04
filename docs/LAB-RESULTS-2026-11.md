# Balance Lab results, night of 4 November 2026

Measurement only: nothing in the game changed. Every match is the game's own AI against itself, refereed like a
ranked server match (tools/balance-lab.js: Standard map, 5 package offers, no Blixten), on main at acd160c (Sun Priest
lock-on change of 4 November included). These are AI results, not human win rates: the AI's drafting shapes them.
Win rates "when fielded" or "when bought" are descriptive, not causal.

Intervals are 95% Wilson intervals. z = how many standard errors a rate is from 50%. With 12 leaders and 6 towers
tested at once, treat |z| < 2.5 as noise.

Files: merged summaries in tools/lab-runs/2026-11-04/*summary*.json and the probe in probe-new.json. Raw shard reports
(about 12 MB per 330 matches) are not committed. Tools: tools/lab-merge.js, lab-tables.js, lab-hoard.js,
lab-probe-new.js.


## Run 1: leaders, towers, side bias (1000 matches, --no-mirror, seeds 800000-800999)

1000 of 1000 finished, 8.9 rounds on average, 93,034 moves accepted, 0 refused, 0 desyncs.

Side bias: side 0 won 490, side 1 won 510. Side 0 49.0% (46-52), z = -0.63. The 56/44 at n=200 was noise.

Leaders (games = side-matches with that leader)

    Leader                  games   win%   95% CI     z
    Enzo                      157   82.8   76-88    8.22
    Yot-Yot                   174   56.9   50-64    1.82
    Frickolas Cage            150   56.7   49-64    1.63
    Felix                     176   55.7   48-63    1.51
    Phil                      166   51.2   44-59    0.31
    Matteo                    176   49.4   42-57   -0.15
    Zoe                       170   48.2   41-56   -0.46
    Emile                     172   45.9   39-53   -1.07
    Otto                      168   40.5   33-48   -2.47
    Mubarak                   164   39.6   33-47   -2.65
    Wilhelm                   146   38.4   31-46   -2.81
    Noah                      181   36.5   30-44   -3.64

Towers

    Tower                   games   win%   95% CI     z
    Sniper tower              316   83.9   79-88   12.04
    Bank tower                344   56.1   51-61    2.26
    Slime tower               355   45.4   40-51   -1.75
    Keep                      336   44.3   39-50   -2.07
    Mage tower                347   38.0   33-43   -4.46
    Bastion                   302   33.1   28-39   -5.87

Enzo and the Sniper tower are separate effects, not one effect counted twice:

    Enzo + Sniper tower        32 games, 32 wins (100%)
    Enzo, other tower         125 games, 98 wins (78%)
    Other leader, Sniper tower 284 games, 233 wins (82%)
    Neither                  1559 games, 637 wins (41%)

Clear signals
- Sniper tower (84%, z 12) and Enzo (83%, z 8) are far out of line. Tower types are picked at random among the
  offers, so the tower number is the cleanest in the lab.
- Bastion (33%) and Mage tower (38%) are weak.
- Noah (37%) is low. Wilhelm, Mubarak and Otto (38-41%) are borderline, because the rest of the field is pulled down
  by Enzo's 83%.

Noise
- Yot-Yot, Cage, Felix, Phil, Matteo, Zoe, Emile: all within the intervals of 50%.
- Side bias: none.

Caveat on Enzo: his ability (no skill buying; each unit type's first skill free with 2+ squads) may suit the AI
better than a human. The AI buys skills at random (50% per eligible skill) and wastes gold on weak ones. Enzo gets
them free and can't waste gold on them.

Questions
1. Sniper tower at 84%: is it too strong, or is the AI bad at playing against it? The AI does nothing special
   against any tower. Would a human-vs-AI test, or replaying ranked matches, show the same?
2. Enzo at 83%: is free skills plus "can't misspend" worth that much to humans too? Or is this the AI's random skill
   buying making every other leader look worse?
3. Bastion and Mage tower at 33-38%: are they weak, or does the AI just never use what they offer (walls, mage
   generals)?
4. Noah at 37% and roughly four leaders at about 40%: is this worth a look after Enzo is settled? Removing Enzo's
   pull will raise everyone else by a few points.


## Run 2: new units and skills

### From run 1 (AI drafts)

    Unit          buy%   squads  matches fielded  win% fielded  dmg/squad-round  survival
    Sniper        61.7     2493     1481           48.1          825             0.35
    Spiders        5.1      103      103           63.1 (54-72)   96             0.01
    Water Mage     2.1       53       41           41.5 (28-57)  483             0.09
    Sun Priest     0          0        0           -              -              -

buy% = share of the 2000 side-matches that bought at least one squad.

Skills bought (side-matches, win% of those)

    Sniper: Ranger scope              845   44.0
    Sniper: Deadeye                   621   44.6
    Sniper: Awaken (Hunter)           495   37.4
    Sniper: Assaultgunner             299   41.1
    Water Mage: Summon water elem.      6   33.3
    Water Mage: other skills           14   -
    Spiders: any skill                  0   -

- Sun Priest: the AI never bought one in 1000 matches (500 gold plus a 150 unlock), so the lab can't rate it from AI
  drafts. Water Mage (2%) and Spiders (5%) are too rare to say much. The Spiders 63% is on 103 matches, with no skill
  ever bought, and is descriptive only.
- Hunter: sides that fielded Snipers and awakened one won 37.4% (185 of 495). Sides that fielded Snipers and did not
  awaken won 53.5% (528 of 986). The gap holds whatever round the first awakening came in (rounds 5-8: 35-43%), so it
  is not simply "bought when already behind". This is still descriptive. Run 2b below tests it with a paired A/B.

### Probe: each variant against every roster unit (tools/lab-probe-new.js)

Counter-table settings (one unit type a side, distance 42, innate skills on), 28 opponents, the engine's battle score
(-1..+1, positive = the variant wins). Paid = the skill's price comes out of the variant's gold; free = it doesn't.
Hunter: one awakened Sniper squad among plain Snipers, marking one enemy squad.

                                              1500 gold            3000 gold
    Variant                                   score  wins/28       score  wins/28
    Sniper                                    +0.26   17           +0.25   15
    Sniper + Hunter, 1 squad (paid)           +0.01   11           +0.21   16
    Sniper + Hunter, 1 squad (free)           +0.33   20           +0.34   19
    Water Mage                                -0.10   12           +0.00   13
    Water Mage + water elemental (paid)       +0.03   15           +0.24   19
    Water Mage + water elemental (free)       +0.29   21           +0.31   21
    Spiders                                   -0.38    5           -0.43    4
    Spiders + Poisonous fangs (paid)          -0.25    8           -0.33    8
    Spiders + Spiderlings (paid)              -0.09   15           -0.04   16
    Spiders + Cavestalkers (paid)             -0.29    6           -0.26    7
    Spiders + Web-shots (paid)                -0.42    5           -0.45    5
    Sun Priest                                +0.15   19           -0.02   14
    Sun Priest + Split beam (paid)            -0.10   13           -0.04   12
    Sun Priest + Shortsight (paid)            -0.14   13           -0.10   13

(Free versions of the Spiders and Sun Priest skills are in probe-new.json.)

Caveat: gold buys whole squads, so a price can cost a whole squad or nothing. Sun Priest (500) at 1500 gold drops
from 3 to 2 bodies when a 100-gold skill is paid. The paid Sun Priest rows mostly measure that lost squad, not the
skill. The 3000-gold column is the fairer one for the 500-gold units.

Clear signals
- Spiders are the weakest of the four with or without skills. Only Spiderlings brings them to about even (-0.04 at
  3000). Web-shots does not pay for itself in a one-type fight (its slows probably matter more in mixed armies).
- The water elemental is a large upgrade: +0.24 over plain Water Mage at 3000 gold, after its price.
- Hunter on one squad is worth about its price at 3000 gold (+0.21 paid vs +0.25 plain) and less early. This is in
  the counter-table setting, where the mark is always on a squad in reach.
- Sun Priest after the lock-on change: about even at 3000 gold (-0.02), positive at 1500.

Noise and limits
- One unit type a side, no towers, placement or leaders. These numbers say what a skill does in a fight, not whether
  the AI uses it well.

Questions
1. Hunter: run 2b (below) says whether the 16-point gap in AI matches is caused by Hunter. If it is, is the problem
   the 300-gold price or the AI's choice of mark?
2. Spiders: is Spiderlings meant to be the only viable build? The other three skills leave them well below even.
3. Water elemental: +0.24 for 300 gold in a straight fight. Is that intended, given the AI almost never builds Water
   Mages?
4. Sun Priest and the other 500-gold units: does it matter that the AI never drafts them? Should the lab get an AI
   option that drafts them (lab-only, as with the hoarder) so they can be measured in matches?


## Run 2b: Hunter A/B (paired)

(pending: 1000 matches on run 1's seeds; one side's AI never sees Hunter)


## Run 3: carry cap and hoarding (300 matches per setup, seeds 810000-810299, mirrored offers)

Tool: tools/lab-hoard.js. No change to src/: the hoarder is the game's own AI shown less than it has, and its moves
still go through the referee one by one.
- Rounds 1-3: its view shows only the gold above "keep", for deploying and for level-ups. Pure: keep everything
  (it fields only free package squads). Keep 500: spend what is above 500, so the carry stays at the cap.
- From round 4: one pass where its view leaves out every tier 1-2 unit (so it buys tier 3-4), then a normal pass
  for whatever is left.
- Cap off: after each fight the lab gives back what CARRY_CAP took, the same as no cap for these matches.
- The hoarder plays side 0 on even seeds and side 1 on odd seeds. The opponent is the normal AI. The same seeds are
  used in every setup.

    Setup                       hoarder wins   win%   95% CI    z      capLost per match
    Pure hoarder, cap on        152 / 300      50.7   45-56     0.23   453 (in all 300 matches)
    Pure hoarder, cap off       233 / 300      77.7   73-82     9.58   0 (the cap would have taken 503)
    Keep-500 hoarder, cap on    191 / 300      63.7   58-69     4.73   73 (in 296 matches)

capLost for the normal AI: 0 in every setup.

When the hoarder spikes (pure hoarder; round-win % for the hoarder, gold at round start H / N, army value H / N)

    Round   cap on: win%  gold        army         cap off: win%  gold        army
    1        4            250/250     300/478      4              250/250     300/478
    2        0            550/313     300/663      0              550/313     300/663
    3        0            900/430     307/866      0              950/430     307/866
    4       34           1031/544     971/1108     69            1483/544    1321/1108
    5       54            746/666    1502/1420     82             802/682    1869/1422
    6       59            797/823    2068/1885     77             778/830    2433/1905
    7       65            886/897    2742/2397     74             869/899    3109/2471
    8       65            976/998    3452/3009     71             967/990    3809/3105

(Army value: squad prices on the board, each level +50%.) In rounds 1-3 the hoarder takes 9 + 16 + 22 = about 47
damage while the bot takes almost none. It spikes in round 4. With the cap off it arrives with about 1480 gold, wins
69% of round 4 and 82% of round 5, and its army stays bigger for the rest of the match. With the cap on it loses about
450 gold at the end of round 3 (and 50 at the end of round 2). It arrives with about 1030 and only draws level.

Clear signals
- The cap does what it is meant to against pure hoarding. Without it, banking 3 rounds is worth +27 points of match
  win rate against the normal AI (77.7% vs 50.7%, the same seeds). With it, pure hoarding is break-even.
- Keep-500 hoarding (spend what is above the cap, never lose gold to it) still wins 63.7% (z 4.7) with the cap on.
  The cap does not stop "float 500 and spike in round 4".
- Part of every hoarder's edge may be the tier 3-4 dump itself rather than the saving. See the control below.

Noise and limits
- 4-5 of 300 matches per setup had a desync, and one had a refused move. All of them involve the hoarder playing Otto.
  His slot-machine goblin picks a tier 1 unit not left out of the match, and the hoarder's view leaves tier 1-2 out.
  So that one move went differently on the referee than the AI expected. It's a lab artefact, at most 1.7% of matches.
- The opponent is the AI, which does not react to a hoarder (it sees the hoarder's empty board and spends as usual).
  A human seeing an empty board in round 2 might punish it or save too.

Control: the same tier 3-4 preference with no hoarding (--hoard-rounds 0, cap on)

(pending)

Questions
1. Keep-500 hoarding beats the normal AI 64% with the cap on. Is "save 500, spike in round 4" a strategy you want
   to exist? If not, is the lever the cap's size, or the income curve?
2. Pure hoarding takes about 47 damage in 3 rounds, nearly half a player's health, and still breaks even. Is the
   35-per-round damage cap (MAX_ROUND_DMG) making early losses too cheap?
3. Does the normal AI under-buy tier 3-4 units? (The control answers this; if it does, the AI's drafting rather than
   the economy is part of what this run measures.)


## Run 4: maps (--map random, --no-mirror)

(pending)
