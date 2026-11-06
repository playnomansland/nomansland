# No Mans Land – Patch notes

Newest first. Each entry says what changed for players; technical details live in the README and `docs/`.

---

## Coming up (PC focus)

Planned for the next updates (details in `docs/ROADMAP.md`):
- **Families and classes (draft):** buy a unit family, pick a class for it, and unlock classes with XP instead of levelling up (plan in `docs/CLASSES.md`, nothing decided yet). How the economy would change with it, measured against today's spending: `docs/CLASSES-ECONOMY.md`.
- **Factions in the trees:** spec into a faction through your units' skills.
- **New looks:** units change model at tree milestones (an Ent grows into a different tree depending on its spec).
- **More lore** for the world, factions and units.
- **More balancing.**
- **Damage types (idea):** physical and magic.
- **Ranked queue (later):** *Find ranked match* pairs you with someone near your level, once there are enough players (plan in `docs/LOBBY.md`).
- **Watch a friend's match (design):** from the friends list, straight into a friend's match as a spectator. Plan in `docs/FRIENDS.md`.
- **Free-for-all (design):** four players on a Fia med knuff board (a centre square and one arm per player), everyone in one battle each round. Plan and open questions in `docs/FFA.md`.
- **Player profile:** tap any username to see their title, skins, ranked record, recent matches and favourite units, with Add friend and Watch.

---

## 6 November 2026 – A licence for the game

Nothing changes in the game.

- **The repository now has a `LICENSE` file:** No Mans Land is all rights reserved. The code is public only so the game can be hosted; copying, rehosting or reusing the code, art, music or design needs permission. Third-party parts (three.js, PeerJS, the CC0 model and icon packs, Google Fonts) keep their own licences, listed in the file.

---

## 6 November 2026 – Developers: a triangle budget for 3D unit models

Nothing changes in the game.

- **How many triangles a unit model may have**, measured instead of guessed: `docs/RENDER-BUDGET.md`. Every model's triangle count, the biggest board in 40 AI matches (173 bodies in round 11), and how the 3D board draws units. Units are instanced already, so the limit is triangles, not draw calls.
- **A stress test page for phones** (developers only, nothing links to it): `tools/tri-budget/stress.html` plays that biggest fight with test models of a set size and measures the frame rate at each size.
- **Measured on Vilhelm's iPhone:** that fight held 60 fps even with 30× today's unit triangles (714k), so unit models have plenty of room. The budget: 500,000 triangles for all units on the board, at most 2,890 a body (or by squad size: up to 4,600 a body for single units, down to 990 for a 12-body swarm). No model today comes close.
- Tools in `tools/tri-budget/`: `count.js` (triangles per model and squad), `worst.js` (the biggest board in a Balance Lab batch).

---

## 5 November 2026 – New skin (coming later): Ember Robe Fire Mage

- **Ember Robe Fire Mage:** a Fire Mage in a long robe with an ember hem, cuffs and chest stripe, a fire gem on a belt in your team colour, long dark red hair and a flame held in each hand. 3D board only (the 2D board keeps the Fire Mage's symbol). It's a cosmetic skin and the Fire Mage's normal look stays the same.
- Nobody has it yet: it's saved for later, and how to earn it is still to be decided.

---

## 5 November 2026 – 2v2: ride your ally's horse

2v2 is still a developer test.

- **You can put your squads in your teammate's horse.** Pick a unit in the shop and tap their horse, or move one of your squads onto it. It costs the same as boarding your own horse, and stepping out again is free. Their horses with room get the gold outline too.
- **The squad stays yours:** your gold, levels, skills, selling and XP. The horse stays theirs.
- **Both of you see it:** a small badge on the horse, ringed in the colour of the player whose squad it is. Tap the horse to see what it carries. If it's your squad, there's a **Step out** button. Opponents never see what rides inside.
- **If your teammate moves the horse, your squad goes along. If they sell it, your squad steps out on that tile.** Nothing else they do can remove it.
- **One rider per horse.** Whoever gets in first holds it. The second try is refused. The horse's one squad in and one out per round count for the whole team.
- **In the fight** your squad rides inside the horse and jumps out where it is destroyed, just like with your own horse. Its damage counts as yours.
- 1v1 is unchanged.

### To check with Vilhelm
- **No consent needed:** you can get into your teammate's horse without them agreeing. They can only get you out by selling or taking back the horse.

---

## 5 November 2026 – Leader draft, fairer online play, horse limit, 2v2 without a treasury

### Leader draft
- **Starting packages no longer come with a leader.** Round 1 is units and gold only.
- **After the first fight, both players draft a leader from the same five.** The **winner of round 1 picks first**; the other player picks from the rest, so **you can never have the same leader as your opponent**. A draw in round 1 is a coin flip.
- Both picks are open: you see what your opponent took (and they see yours).
- The deploy clock waits for the draft. Online, each pick has **30 seconds**; take longer and you get the first leader left.
- Against the computer it works the same: if the AI won round 1 it has already picked when your round 2 starts.
- Leaders still work all match, from round 2 on. Factions, 2v2, the tutorial and the puzzles are unchanged.

### Fairer online play
- **Undo all no longer gives the Mark Bounty mark back for free.** After an Undo all the mark costs its 50 gold again.
- **A tap sent twice is handled once.** On a bad connection a resent action (a spin, a bribe, an extra deployment) could be paid twice; the server now ignores the copy.
- **A loan is paid back on the terms you took it on.** Borrowing before picking the Bank and then picking it no longer charges you 300 for a 100-gold loan.
- The server refuses impossible numbers (negative squad or unit numbers) before they reach the rules. Nobody could gain anything from it, it just stops errors.

### Just a horse
- **Each horse lets one squad out and one squad in per round.** Before, a rider could hop in and out of horses without limit and reposition for free. Squads placed this round still move freely, and a squad that goes back where it was gives its places back.
- A rider whose horse has already let one out says so in its sheet.

### 2v2
- **No treasury in 2v2 for now.** A new building system for 2v2 is coming.

### To check with Vilhelm
- The draft pool is 5 leaders (in ranked: 5 of the Standard pack's 6), and a pick has 30 seconds online.
- A draw in round 1 is a seeded coin flip for who picks first.
- Both picks are visible to both players right away (a draft can't work otherwise for the second picker; the first picker also sees the second pick before the fight).
- The horse limit counts only squads from earlier rounds; a squad placed this round can go in and out freely.

---

## 5 November 2026 – Medium tutorial puzzles

- **Three new puzzles, level Medium.** The Tutorial puzzles list is now split into **Easy** and **Medium**, each with its own "solved" count, and the coach line says which one you're on ("Medium 2 of 3"). Finishing the last Easy puzzle offers **On to Medium**. Each Medium puzzle teaches something new:
  - **Hold the line:** two Spider nests charge your back line. Put something tough in front: an **Ent** with the Fire Mages right behind it. Fire Mages in front lose.
  - **The long way round:** the Out of reach army tucked into one corner, and no Snipers this time. Squads march down their own side of the board, so **Goblin Swarms on the far side** run past the Brute and reach the Fire Mages. Goblins facing the Brute lose every time.
  - **Through the wall:** a Brute and an Ent in front of a Fire Mage, with a Leaf Wizard on the wing. Snipers alone can't break the wall; the new **Earth Wizard** throws stones that go through the first target. Two Snipers and an Earth Wizard, facing them.
- **Initiate title:** still for the three Easy puzzles. The Medium ones are extra practice, so nobody who has the title loses it.
- **Fix:** a puzzle's enemy army now always shows in full, also when it has more squads than one round's deployments.
- Every answer was checked in simulated fights: it wins 80–93% of the time from where its hint points, and the tempting wrong answers almost always lose.

---

## 5 November 2026 – Exploit bot (developers)

- **Developer > Exploit bot:** pick one of six tactics the exploit hunt found (Flank snipers, Steel Wizard flank, Necromancer home guard, Back-line wizards, Hoarder, Arrow rush) and the AI opponent plays it in any match against the computer, so you can feel each exploit from the other side of the board. Off is the normal AI.
- Developers only: nobody else sees the picker, and standard and ranked matches can't get it. Every move goes through the game's normal rules, so the bot never cheats.
- Checked on today's engine: win rates against the normal AI from 40% (Back-line wizards) to about 90% (Steel Wizard flank), with no refused moves in 180 matches.

---

## 5 November 2026 – Sniper tower: paratroopers, and marked squads say so

### Sniper tower: paratroopers
- **Drop paratroopers** replaces Deploy airship (still 400 gold, the tower's second skill). **3 seconds into each fight, 3 paratroopers drop into the enemy base**, just in front of their tower, and hit every enemy within 3 m as they land. Then they fight on.
- A paratrooper is a Wisp (as your Wisps are, without skills or levels) whose shots land instantly.
- Until they land, both boards show **where they'll come down**: a shadow growing in a ring on each spot.
- The airship is gone, and with it the **+30 hit for Snipers and the tower** that came with it.
- In 2v2 the team's tower drops them once, at the other team's tower.
- An old match with the airship plays on with paratroopers.

### Marked squads say so
- A squad of yours the opponent has marked now has a **"You are marked"** box in its sheet: one line on what the mark does; **press and hold** it for the rules. Mark Bounty and a Hunter's mark each get their own box.
- A squad of theirs that you marked says **"Marked by you"**, in gold.
- A mark placed this round stays hidden from its target until the fight, as before.

### To check with Vilhelm
- Drop paratroopers keeps the airship's price, 400 gold.
- The +30 hit for Snipers and the tower is removed along with the airship (it came with that skill).
- Landing spots: a triangle about one tile in front of the enemy tower, toward the middle; the landing hit (the Wisp's hit, 3 m) doesn't reach the tower itself.
- The bot never bought the second tower skill and still doesn't; the Claude opponent sees the new name and text.

---

## 5 November 2026 – Music anywhere, chat typing fix, Omni-Per Brute

### Music anywhere
- A **music button** (a note) sits next to the Settings cog in a match, top right in the waiting room, the draft and the tournament screens, and next to Sort on the Rooms list. It opens the playlist with the full player: play / pause, back, next, shuffle, repeat and the song list. It hides during the fight itself.
- **Pick any song in a match** and it plays through deploy *and* battle instead of the map's music, carrying on into the next songs of the list (with your shuffle and repeat). **Map music** at the top of the list goes back to the map's music. Every new match starts on the map's music again.
- Outside a match the menu player works as before. Music Off in Settings still silences everything, and Play turns it back on.

### Chat typing fix
- Typing in chat (or any text box: messages, bug report, username, match code) no longer turns the 3D camera or triggers other keys. A Q held down stops turning when you click into the chat line.
- **On PC** the chat button is always in the top left corner of the screen, in every phase of an online match, and the chat opens right under it. The names and health bars move over to make room.

### New skin: Omni-Per Brute
- A chrome war machine with a power fist: polished silver plating, a helmet with one glowing teal visor slit, a hydraulic power fist with pistons, a glowing core in the chest, exhaust stacks on the back and stripes in your team colour on the shoulders. 3D board only (the 2D board keeps the Brute's square).
- Nobody has it yet: how to earn it is still to be decided.
- You can wear one Brute skin at a time: wearing one takes the other off.

### To check with Vilhelm
- My music keeps playing on the match-over screen too (it isn't cut off as the match ends); leaving the match goes back to the menu music, and the next match starts on the map's music.
- In a match, Pause in the player pauses the match's music (yours or the map's) until you press Play, for that match only.
- The song list in a match has every song (the map songs and the not-yet-assigned ones too); the menu list is unchanged.

---

## 5 November 2026 – 2v2: see whose unit is whose

- **Tap any unit to see its sheet**, in every phase: yours, your teammate's and the opponents'. The sheet says whose it is: **Yours**, **Name's (teammate)** or **Name's (opponent)**. A teammate's sheet is complete (stats, level, XP, skills, awakening, direction) but read only. The opponents' sheets hide this round's buys, as in 1v1. In a fight, the card of a tapped unit says whose it is too.
- **A colour per player:** every squad has a circle in its player's colour under it, in deploy and in the fight. You are light cyan and your teammate blue; your opponents are red and orange. The top bar shows the four colours by the players' names.
- **Your teammate's direction arrows** show on your board, thinner, in their colour. The opponents still don't see arrows until the fight.
- **Damage stats: My units / Team units.** Team units lists both players' units, each tagged with its player, with a total for each player. Your choice is kept until you close the page.
- **Pings fade faster:** 3 seconds instead of 8, in the colour of the player who pinged.
- **New tower and treasury spots:** the tower stands 5 squares right of the middle and the treasury 4 squares left, mirrored for the other team.

**To check with Vilhelm**
- In a fight, tapping a unit opens its battle card (as in 1v1), now with whose it is, rather than the full sheet. The full sheet opens with a tap after the fight.
- The team's tower, guards and airship are listed under Team units as the team's, not under one player.

---

## 5 November 2026 – 2v2: tower portal and Mechites

2v2 is still a developer test.

### Tower portal
- **Take the other team's tower and a portal opens where it stood.** It leads straight back to your own tower. "It's just a transporter."
- Every unit of your team (yours and your teammate's) heads for the portal, unless an enemy is close enough to see. Then it fights first and goes back to the portal afterwards. A unit that steps in comes out in front of your own tower and fights on from there.
- Buildings, towers, the tower's airship and units that never move don't use it. Units riding inside another unit go through with it, and a charge is finished first.
- Each unit goes through once per fight.
- 1v1 and ranked are unchanged.

### Mechites in 2v2
- **Rollers, Cog Builder and Mechite Guards** are in the 2v2 shop, by tier, and can come in packages like any other unit. The Altar of Build is not.
- The Cog Builder's **Factory** works as in the Factions test: buy it, then builders build it, then buy a construct each round. Its tile is your team's: your teammate can't place anything on it either.
- The AI players in 2v2 buy them too, Factory included.
- 1v1, ranked and tournaments keep the usual units.

### To check with Vilhelm
- **Once per fight:** each unit can use the portal only once per fight, so it can't loop home → portal → home.
- **When both towers fall,** each team gets its own portal at the other team's tower spot.
- **Awareness:** "an enemy in awareness range" uses each unit's own sight (its range + the sight distance, at least the minimum sight).
- **Exit spot:** units come out two to four tiles in front of their own tower, spread out so they don't stack. If your own tower has fallen too, they still come out there.
- **Mechites in 2v2 have no faction bonus** (they're plain units there, open to everyone). Their AI ratings against the built-in units come from the Factions table where it has both units, otherwise "even".

---

## 5 November 2026 – Balance: Mammoth and Spiders

- **War Mammoth:** 2650 health (was 2450).
- **Spiders, Cavestalkers:** besides stealth, now also +25% hit.

---

## 4 November 2026 – Treasury gold on the board, and tidier rooms

- **The gold a treasury hands over shows on the board.** Break the enemy's treasury and **"+150 gold"** floats up from it in gold while the fight goes on; when yours is broken, **"−150 gold"** floats up from it in red. It's the same raid the results screen lists, now where it happens. On both the 2D and the 3D board, and it stays up long enough to read at any fight speed.
- **Rooms close when nobody is in them.** A room everyone has left (a waiting room, or one whose match is over) closes by itself about a minute later: it leaves the Rooms list and its code stops working, instead of hanging about for a day. A match that has started is never closed this way — it plays on and ends by itself, as before, so a phone that lost its connection can come back.
- **You can't be in the same room twice.** Opening your own room on a second phone or in another tab no longer puts you on the other side of it: it says so and leaves the room as it was. Your own phone still comes straight back to its own side after a reload or a lost connection. **Quick play** never hands you your own room either.
- **No notification for messages you wrote yourself.** The chat badge in a match counted your own lines as unread. It now counts only what came in.

---

## 4 November 2026 – Ranked needs a login

- **Ranked is for logged-in players only.** Both players need to be logged in with Google. Guests can still play Standard matches with friends and against the AI.
- Picking **Ranked → Play vs Friend** (or making a Ranked room) without a login opens **Log in to play ranked**. Log in there and the ranked room opens straight away. A guest keeps its username and match history when it logs in.
- A friend who opens a ranked link without a login gets the same screen, and joins the match as soon as they've logged in.

---

## 4 November 2026 – Friends, game invites and private messages

### New: a friends list
- A **Friends** button (people icon) sits next to Profile at the top of the main menu, and in a match under the cog. A **red badge** counts friend requests, unread messages and invites.
- **Add a friend** by typing their **username** (any capitals), or tap a player's name in a match or on the leaderboard and pick **Add friend**. They get a request to **Accept** or **Decline**. If you both ask, you're friends at once.
- **Remove friend** (under ⋯, tap twice). It's silent: they aren't told, and your messages with them are deleted.
- Friends stay friends when someone changes their username.
- For players signed in with Google. Guests see "Sign in to add friends".

### See who's online
- A **green dot** by a friend's name means they're online, a **grey dot** that they're offline. Next to it: *Online*, *In a room*, *In a match · round 4*, or *Last seen 2 h ago*. Online friends come first.

### Invite a friend into a match
- **Invite** by an online friend makes a private room and sends them the invite. Inside a waiting room, **Invite friend** sends that room.
- Your friend gets a banner: "**Ann** invites you to a Standard match" with **Join** and **Decline**. If they're in a match, they only see the badge, and the banner comes when their match is over.
- An invite lasts 5 minutes, and goes away if you leave the room. If the room has already filled or started, joining says so.

### Private messages
- **Message** opens a chat with that friend. Messages are kept on the server (the last 100 per friend), so you see them on any phone. Unread messages show on the friend's row and the Friends button.
- During a match messages only add to the badge, nothing pops up.
- **Mute messages** (under ⋯) hides a friend's messages without removing them. **Report** sends the last 20 messages to the moderators.

---

## 4 November 2026 – Online lobby, chat and emotes

### New: Rooms, a list of games to join
- **PLAY → Online · Rooms** shows every open public game: Standard and Ranked together.
- Each room shows the host's name and title, the map, how many players are in, the round if it has started, and how many are watching. **Join** a waiting room, or **Watch** one that's playing.
- **Sort** the list by name, date/time (newest first, the default), category (Standard / Ranked) or mode. Tap the active one again to flip the order. Your phone remembers it.
- **Quick play** puts you in the oldest open Standard room, or makes one and waits for someone to join.
- **Create room:** Standard or Ranked, public (in Rooms) or private (code only), spectators on or off. You still pick the map, look and leaders in the room before you start.
- Codes and links work as before.

### New: spectators
- **Spectating is on** for every room unless the host turns it off: in the waiting room, or in Settings during the match.

### New: chat and emotes in online matches
- The **speech bubble** (in the shop row while you deploy, on the board otherwise) opens three emotes and a chat line.
- **Emotes:** the Flame Wizard shouting *BABABABA!*, a happy Ether Golem and a shell-shocked Sniper. They pop up by your name and over your side of the board. No sounds.
- **Chat** is for players signed in with Google. Guests can read it and send emotes.
- **Spectators** chat among themselves while the match runs, so nobody can tip off a player. When the match ends, the players see what they said and everyone chats together. A rematch splits the chats again.
- Tap your **opponent's name** to mute their emotes or their chat (separately), or to **report** their chat to the moderators.
- **Settings:** turn Chat or Emotes off for every match.
- Not in phone-to-phone matches.

### Developer
- 2v2 rooms show in Rooms for developers only, with Team / All chat. The server key `lobby_duo` opens them to everyone when 2v2 is ready.
- Server: `LobbyRoom` at `/lobby`, rooms report their own listings. Details in the README and `docs/SERVER.md`.

---

## 4 November 2026 – GG, Replay a round and your match history

### New: Say GG
- After an online match, the match-over screen has **Say GG**. Your opponent sees "*you* said GG" on theirs.
- **New title: Good sport** (pale sky blue). When opponents have said GG to you **10 times**, it's yours for good. Only finished online matches between two accounts count, with at least 3 rounds and nobody leaving, and at most 3 GGs from the same player. The **Rewards** sheet shows how many you have.

### New: Replay a round
- **Look at board** on the match-over screen is now **Replay a round** (2v2 and spectators keep Look at board).
- Pick a round and play it again from its start: your gold and army as they were, and your opponent's army **as it fought**, all in plain sight. Deploy differently, press **Fight** and see how it would have gone, next to how it went in the match.
- **Try again**, pick **another round**, or go **Back to results**. It's only a learning tool: the match result never changes, and an online opponent's rematch request waits until you're back.

### Match history: your own matches, with replays
- **Profile → Match history** now opens on **My matches**: one card per online match with your **opponent's username**, the result, rounds, health, damage dealt and taken, the map and both leaders.
- Open a match for every round (both armies) and a **Replay** button that plays that fight again.
- Replays now keep the units the fight was played with, so they play back the same after balance changes.
- The old lists are still there as **All online** and **Phone-to-phone**.

---

## 4 November 2026 – Direction arrows for melee units

### New: point your melee squads where to go
- Every **melee squad** (range 5 m or less: Brute, Goblin Swarm, Spiders, Ether Golem, War Mammoth and the rest) gets **Set direction** in its sheet. Tap where it should walk first, or drag the arrow out of the squad. Ranged squads don't get one.
- An arrow is at most **5 tiles** long. Aim further and it's cut down along the same line. The dashed ring while you aim shows how far it can reach.
- **In the fight the squad walks the arrow first and ignores sight and awareness on the way**, so it walks past enemies it would normally turn to. Each body keeps its place in the formation. It still fights an enemy that comes **into its reach**, then walks on once that enemy is gone. From the end of the arrow on it fights as usual.
- If it can't get there (a wall, a crowd) it gives up after a while and fights as usual.
- **Free**, and it stays from round to round until you change it or tap **Clear direction**. It moves with the squad when you move it.
- **Your opponent doesn't see your arrows** until the fight. Your arrows show on the board while you deploy, and the squad's sheet says *Direction: walks its arrow first*.
- Works in every match type: server matches, tournaments and phone-to-phone.

---

## 4 November 2026 – New music

- **Eyes in the front 2** is in the menu playlist (the whole song).
- Three new deployment and battle songs are in the game but not on any map yet: **Evening**, **S4knandet** and a battle cut of **Eyes in the front 2** that loops its middle part. They don't play in the menu.
- The new songs are levelled to the same loudness as the rest of the music.

---

## 4 November 2026 – Report a bug

### New: Report a bug from inside the game
- **Settings** (the cog in a match, or Settings on the main menu) has a **Report a bug** button.
- Write what happened; the **game version, match id and round** (plus map, 2D/3D board, device and your username) are **filled in for you**.
- **Post the report** makes a new post in **#bug-reports** on our Discord, titled by your first line, and gives you a link to it so you can add screenshots or a video.
- If the game can't post it, the whole report is **copied** and **Open Discord** takes you there to paste it.

### Developer
- The page now carries a version stamp (newest patch notes date plus a short hash of the build), also used in bug reports.
- Server: `POST /account/bug`, posting through a Discord webhook (`DISCORD_BUG_WEBHOOK` GitHub secret). Off until the webhook is added.

---

## 4 November 2026 – Balance: Sun Priest, Earth Wizard, Bullhead

### Sun Priest: slow to switch, deadly once locked on
- The beam now **starts weak and ramps hard**: hit 15 (was 38), growing 175% a second on the same target up to **8× (120 a hit)** (was 50% a second up to 3×). Its attack speed still winds up to 3×. Against one big target it reaches about the same damage as before, a little later.
- **Lock-on:** after its first target, it takes **0.5 s to lock onto each new one**, and the ramp starts over after that.
- Together: a goblin now takes **about a second** instead of half a shot, so swarms and archers are its counter, while giants (Brute, Ether Golem, War Mammoth) still melt. Split beam still helps it against crowds, but much less than before.

### Earth Wizard
- **Pierce 3** (was 5): each shot goes through 3 bodies behind its target instead of 5.

### Brute: Bullhead
- **Longer charge cooldown:** it charges on its **1st, 6th, 11th...** attack (was every 3rd: 1st, 4th, 7th...), about every 4.5 s instead of every 2.7 s.

### Developer
- Two new unit fields, also in Counter Lab: **Lock-on (s)** and **Damage spin-up top (×)**.

---

## 3 November 2026 – Puzzles, tower perks, a stealth fix and a fairer leaderboard

### New: Tutorial puzzles (replace the tutorial)
- The guided tutorial is **switched off** for now. In its place, one **Tutorial puzzles** tile on the main menu (new players also get a big *New here? Try the tutorial puzzles* button until they solve one). Three one-fight puzzles: you see the **whole enemy army**, get a set amount of gold and a small shop, and have to **win the fight**.
  - **The horde:** two Goblin Swarms and Skeleton Archers, 200 gold.
  - **Two giants:** two Brutes, 300 gold.
  - **Out of reach:** two Fire Mages behind a Brute, 300 gold.
- Stuck? **Hint** on the coach line. A loss offers the hint and **Try again**; a win is saved as solved and takes you to the next puzzle.
- The **✕** on the puzzle's line only hides it so you can see the board; the **Puzzle** button brings it back. Leave through the menu.
- **Solve all three and you earn the light blue Initiate title.** It goes under your name like the other titles (pick which one shows in Profile), and the Rewards card on the main menu counts your solved puzzles. Puzzles solved before you had an account count once you make one, so nothing is lost. The game server replays every win itself, so the title can't be faked.

### Towers
- **Bastion: March order.** One **free move every round**. No button to press: just drag an older squad and the free move is used first (before the paid one). Its sheet says *Move · free*.
- **Mage tower: Muster.** +1 deployment every round, for free, like the Keep.

### Leaders
- **Otto's horseshoe** now lasts the whole match: three horseshoes give, at random, **+1 deployment every round** or **+1 free move every round**. You can own one of each; the next horseshoe always gives the one you don't have, and with both it pays **200 gold** instead.
- **Zoe:** tap a starred buff tile to see its **current bonus**, how many fights you've used it in, and what it grows to next. A squad standing on one shows the same line on its sheet.

### Fixes
- **Stealth: a Sniper could hide between its own shots.** Stealth came back 1.5 s after an attack, and a Sniper reloads for 4 s or more, so it was almost never hittable. A stealthed unit now hides again only once it has **stopped attacking** (1.5 s, or its reload plus 0.5 s for slow shooters). Fast attackers play as before; slow ones (Sniper with Hunter, the Assassin) stay visible a little longer between hits.
- **Leaving a match while your opponent is disconnected** no longer counts as your loss: they went away first, so it's theirs (in ranked too). The leave prompt tells you so.

### Leaderboard
- The order is now a **score out of 100: 75% wins, 25% win share**. Wins count against the most wins on the board (the leader in wins gets the full 75), and win share counts a tie as half a win. A player with 1 win and no losses no longer tops someone with 20 wins. The score shows in its own column. This also decides the monthly Legend top 5.

### Developer
- **DEVTESTLATEGAME** always plays on the Standard map (with treasuries), whatever map is picked.

---

## 3 November 2026 – Rewards: invite a friend, join the Discord

A new **Rewards** card sits on the main menu, right under Play, with a picture of each reward. Tap it to see how to get them.

### Invite a friend: the Aquamarine Ether Golem
- **A limited skin** you can only get by inviting a friend: an Ether Golem cut from sea-green crystal, with crystal spires and a white-hot core. Looks only, never stats; you see it on the 3D board, and so do your opponents in online matches.
- **How:** sign in with Google, open Rewards and send your **invite link** (Copy or Share). Your friend opens it, makes a **new account** and **signs in with Google**, then **finishes an online match** (3 or more fights, against anyone, without leaving). Then the skin is yours.
- The sheet shows every friend who used your link and what they still need to do. The skin comes once, however many friends you bring.
- A friend who opens your link sees a "A friend invited you!" note on the welcome screen.

### Join the Discord: the BABABABA title
- **An orange BABABABA title** under your name for everyone who joins the No Mans Land Discord.
- **How:** open Rewards, tap **Join the Discord**, then **I've joined: Check**. Discord asks you to let the game see who you are and which servers you're in; the title is yours as soon as it confirms. Pick which title shows in Profile.
- **Join here:** https://discord.gg/TBpDKSBWsY

---

## 3 November 2026 – 2v2 on one shared board (developer test)

2v2 is now played on **one big board** instead of two boards side by side. This also fixes the screen glitches: the second board that flickered, squeezed or showed the wrong size is gone.

### The board
- **One wide board (24 × 18 tiles)** for all four players. Team A deploys at the bottom, team B at the top.
- **You and your teammate share one zone.** Place your squads anywhere in it, even right next to theirs. A tile your teammate holds is taken, just like one of your own.
- **Double flanks:** each edge has **two columns** of flank tiles (from round 3, as in 1v1).
- **No leaders** in 2v2: packages give free squads and gold only.

### Shared tower and treasury
- **Each team has one tower and one treasury**, in the middle of its back rows.
- **Vote for your tower in round 3.** You and your teammate each pick a tower type from the same offer. Same pick: that's your tower. Different picks: a coin flip decides (against an AI teammate, your vote wins). You see your teammate's vote on the cards and in the bar above the board, and a line tells you which tower won.
- **Tower upgrades are shared.** Whoever buys a tower skill, walls, Fortify or a mage general pays for it, and it works for the whole team. Only the one who bought it can take it back. The Bank's Major investment stays your own.
- **The treasury pays both of you** when it survives a fight, and a raid on it steals from both of you.
- A fallen tower costs the team health once.

### Still your own
- **Your own gold, shop, unlocks, skills, levels and deployments**, as in 1v1. Your teammate's squads are drawn in your colour with a small ring on their tile, so you can tell them apart.
- **Hidden info as in 1v1:** you see your teammate's squads the moment they place them, but never what either opponent deployed this round.

### Fights, health and talk
- **One fight on the one board**, the same on every phone and PC (2D and 3D). The team's shared health is still **200**.
- **Pings and Say…** work as before: tap **?**, **!** or **⚔**, then a tile, and your teammate sees it on the same spot of the same board.

---

## 3 November 2026 – Balance study: what makes a unit strong

No gameplay changes in this one: it's the groundwork for the next balance passes. Over 10,000 simulated fights in the game's own engine, plus 200 Balance Lab matches, measured how much each stat is worth in gold. Full write-up in `docs/STAT-LEVERS.md`.

- **Health × damage is one stat.** A unit's raw power is the square root of health times damage per second, per gold. Trade them 1 : 1 in percent.
- **Range is the strongest stat:** each metre is worth about 5% gold. A melee unit needs about twice the health and damage of a 14 m unit to break even, and in Balance Lab matches long-range squads survive fights 35% of the time against 1% for melee.
- **Speed only helps units that have to walk.** Doubling it is worth +20% at 14 m and almost nothing for artillery.
- **Armor and ward are counters, not power:** armor beats many small hits, ward beats a few big ones.
- **Splash under 2.5 m does nothing**, because units always stand at least 2.45 m apart. From 3 m it's worth about +30%. Earth Wizard, Steel Wizard and Ent currently have 2 m splash.
- **Hidden costs:** slow projectiles (about −10%) and wind-up (−16% for 1 s).
- **A level-up is the best deal in the game:** about +50% gold's worth compared with buying more squads.
- **A baseline unit** for future units to be measured against: 100 gold, 3 bodies, 147 health, 19 hit at 1 attack a second, 14 m range, 3 m/s. It scores even against the roster, early and late.

---

## 3 November 2026 – Unit skins: the Champion Brute

- **Skins are here.** A skin changes how one of your units looks, never how it plays.
- **Champion Brute** (unique, for **Gubbolas Cage**): a crowned Brute in gold-trimmed armour, with spiked pauldrons, a cape in your team colour and a great war hammer. It shows on the 3D board; on the 2D board the Brute keeps its usual square.
- **Your opponent sees it too** in online matches (friends and ranked), and so do spectators. Against the AI you always see your own. Not shown in tournaments or 2v2 yet.
- **Profile → Skins** lists the skins you own, with **On / Off**. A skin you just received gets its own popup on the main menu.
- Skins are given, never sold, and they stay with your account if you change your username.

---

## 3 November 2026 – DEVTESTLATEGAME (developer test mode)

A new test mode in the Developer menu, for trying out the late game with friends:
- **Play it vs a friend or vs the AI.** DEVTESTLATEGAME → vs Friend gives you a link and code like a normal friend match (the game server referees it, and your friend doesn't need developer access). vs AI is there for quick tries.
- **130 health each** (30 more than a normal match), so matches last longer and reach the big armies.
- **At most 5 squads of the same tier 3 or tier 4 unit.** For example: at most 5 Flame Wizards, but you can have 5 Frost Wizards at the same time, and the same goes for each tier 4 unit. Shop cards for those units show how many you have (like 3/5) and grey out at 5. Selling a squad, or taking back one you just placed, frees a spot.
- Normal and ranked matches are unchanged.

---

## 3 November 2026 – 3D board for everyone

- **Everybody starts on the 3D board.** If your phone or computer had been stuck on 2D (from an older version, or because 3D once ran too slowly), it switches to 3D the next time you open the game. This happens once: if you then pick 2D in Settings, it stays 2D.
- **Too slow now only lasts one visit.** When fights run too slowly in 3D, the board still drops to 2D, but only until you close the game. Next time it tries 3D again.
- Devices that can't run 3D at all still use 2D, with a line on the board saying so.

---

## 3 November 2026 – Faster Counter Lab

- **Counter Lab tables build faster.** Big swarm fights (Goblin Swarm, Skeleton Archers and the like) now simulate up to about 3× faster, so a custom unit set's counter table is ready sooner on your phone.
- **Every fight plays out exactly as before:** same targets, same moves, same winner. Only the work the game skipped changed, not the rules.
- Behind the scenes: the Balance Lab (our test bench for bot-vs-bot matches) now plays exactly like a ranked server match: the same map and rules, the same counter table, every bot move checked by the game server's referee, and the bots level up like the in-game AI. It starts in seconds instead of half an hour, and its reports show what each side bought, gold per round, and how leaders, towers, skills and units do.

---

## 3 November 2026 – Spiders rework, sniper tower, Snow storm

### Spiders (rework)
The Spiders' skill tree is new:
- **Poisonous fangs** (100 gold): hits poison, the same as Poison shot.
- Then pick one (200 gold each): **Spiderlings** (as before) **or** **Cavestalkers** (stealth).
- **Web-shots** (Master skill, 300 gold, needs Spiderlings or Cavestalkers): once a fight, every spider shoots a web at an enemy within 10 m. Webs deal no damage, but they slow the target and weaken its attacks, and they stack. Hold the skill on the unit sheet for the exact numbers: each stack is 10% slower and 5% less damage, up to 90% of each, and lasts 3 seconds from the newest stack. A web also brings the spider's poison and slows, like a bite would.

### Sniper tower
- **Mark Bounty now works for all your units**, not just Snipers: every unit deals the marked squad +15% damage and sees it through stealth, and the +100 gold bounty pays when any of your units takes its last body.
- **Eagle eye** now helps your whole army: **all your units get +1.5 m range and +5% attack speed**. Snipers and the tower get double (+3 m, +10%), the same as before.

### Frost Wizard
- **Snow storm** reaches 2 m further (8 → 10 m).

### Unit sheets
- A skill with a short description now keeps its full rules in the hold-to-read-more text (press and hold the skill row).

---

## 3 November 2026 – Sniper Hunter, Water Elemental

### Sniper – Hunter (new Awaken skill, replaces Overwatch)
- **Overwatch is gone from the Sniper** (no more garrisoning the tower or watchtowers). Its 4th skill is now **Hunter**, an **Awaken** skill: bought for one squad at a time, 300 gold, needs Deadeye or Assaultgunner first.
- **Place a mark:** open an awakened Sniper's sheet and tap **Place mark**, then tap an enemy squad from an earlier round. It's free, stays for the rest of the match, and **Move mark** puts it on another squad any round (**Undo mark** takes back this round's move). If the marked squad is sold, mark another.
- **In the fight** a Hunter **always shoots a marked enemy in its range first**, deals it **double damage**, and sees it through stealth. A squad marked by any of your Hunters counts for all of them.
- **Stealth:** Hunters are hidden until they fire their first shot.
- Marks show as small dashed crosshairs on the board. Your opponent sees a mark only once the round it was placed has been fought (a moved mark shows on its old squad until then).

### Water Mage – Summon water elemental (new Master skill)
- New 4th skill, a **Master** skill (300 gold, for all your Water Mages, needs Pool shaper or Flow state first).
- At the start of every fight each Water Mage summons a **Water Elemental 1.5 tiles in front of her**. It walks **as fast as she does**, has **600 health** and **attacks like a level 2 Ember Imp**. It **grows with her level**.
- When it dies it leaves a **pool**: it hurts enemies standing in it and heals and speeds up your units, for the rest of the fight.

### Fixes
- Pools from both sides can now overlap, and a unit standing in pools of both sides gets both effects. Before, whichever side's pool came first blocked the other, which slightly favoured the host in mirror fights.

---

## 3 November 2026 – Legend title

- **New title: Legend** (gold). Finish a month in the **top 5 of the leaderboard** and it's yours to keep. Months follow Swedish time, so November ends at midnight on 30 November.
- The leaderboard shows how many days are left this month, marks the top 5 in gold and draws a line under 5th place.
- Pick it in Profile like any other title. If you haven't picked one, Legend shows before Day 1.

---

## 2 November 2026 – 2v2 (developer test)

The first version of **2v2** (developer accounts only): two Standard boards side by side, one pair of players on each, one shared team health of 200, pings and quick lines for the team, and a lobby where the host sets the teams. On 3 November it became one shared board (see above).

---

## 2 November 2026 – Balance and fixes

### Usernames
- **Usernames are now called usernames** everywhere in the game: sign-up, Profile, tournaments and match screens.

### Unit sheets
- A unit's **stats** (bodies, health, hit, attacks per second, range, speed) now sit at the **top of its sheet**, right under its name, instead of at the bottom.

### Towers
- **Mage tower – Teleport mage general:** now **150 gold** (was 100) and **lasts the rest of the match** once bought, on top of whichever general you call each round. It can be undone only in the round you buy it.
- **Sniper tower – Deploy airship (nerf):** the airship now shoots like a **level 2 Sniper** (was level 3). Instead of a paratrooper every 5 seconds, it flies straight into enemy territory and drops **3 paratroopers at once, once per fight**, then fights as before.

### Units
- **Ember Imps – Ember Mortar (nerf):** attack speed −20%, range bonus +12 m (was +18 m), and the mortar now **lobs shells at 20 m/s** instead of hitting at once, so fast units can step out of the blast.
- **Ember Imps – Summon hellfiend (nerf):** the Hellfiend has 30% less health, hit, attack speed and move speed.
- **Flame Wizard (nerf):** range −3 m (15 → 12 m; its flame cone still reaches 1.2× that) and health −10% (1700 → 1530).
- **Leaf Wizard (nerf):** range −2 m (22 → 20 m) and health −40% (185 → 111).
- **Wisps (nerf):** attack speed −15% (0.7 → 0.6 attacks a second).
- **Truespear (nerf):** attack speed −15% (0.9 → 0.77) and health −30% (1800 → 1260).
- **Shiv:** now **3 bodies** (was 4). Each knife hits harder (13 → 17.3) and each body has more health (150 → 200), so the squad deals and takes about the same as before.
- **Bleed:** stacks now top out at **4** (was 5), and each stack hits like the one above it used to: stack 1 is the old stack 2, and so on. Bleed reaches its peak faster. Anemia now stuns at 4 stacks.

### Leaders
- **Otto – The Gambler: forgiveness luck.** After 5 losing spins in a row (nothing, or skulls), the next spin always wins a prize. The slot machine shows how close you are.

---

## 2 November 2026 – Flame Wizard on the main menu

- A **Flame Wizard** now stands at the left edge of the main menu: the same 3D model as on the battlefield, blasting an orange fire cone from his staff across the screen, with a big **BABABABABA** above him in a cartoon font.
- It all stands still until you **tap him** (or the text): then the fire flickers, sparks fly and BABABABABA shakes for 1 second.
- He sits under the buttons, so clicks on the menu work as before.
- He's only on computers (with a mouse), not on phones or tablets.
- If 3D can't start on a device, he shows as the 2D Flame Wizard symbol instead.

---

## 2 November 2026 – Ranked fixes

- **Fix:** the ranked series score could reset between games (win game 1, lose game 2, and it said 0–1 instead of 1–1). The server now counts each game before it saves the match, so the score survives the pause between games.
- During a ranked match the **series score** (for example "Bo3 · 1–0") sits above the round number at the top of the screen. It changes once the fight has played out, so it never gives away the result early.

---

## 2 November 2026 – Music player

- Hover **Now playing** and it lights up; tap it to open the **playlist**. Tap any song there (or in Settings) to play it.
- The menu music now goes **in order**: after the song that's playing comes the next one in the list, also after you pick a song yourself (play song D and song E comes next).
- New **Shuffle** button: the next song is a random one instead.
- New **Repeat** button: the song playing plays again and again.
- Shuffle and Repeat are remembered on this device.
- The look preview in the PLAY menu now shows both **treasuries** on the Standard map.

---

## 2 November 2026 – Titles

- **Titles** now show under your username with a little glow: on the main menu, in your Profile, on the Leaderboard and in ranked matches.
- **Day 1** (purple): everyone who makes an account in this first week, up to and including Sunday 8 November. Accounts made earlier today get it too.
- **DEV** (pink): the developer's account.
- Pick which title shows (or none) under **Profile**.
- In a match, **You** and **Opponent** at the top are now your **usernames with your titles**. Against a friend online you see their name and title (if they have an account); against the AI it still says Enemy.
- **Usernames** can be changed **once a week** (Profile shows when you can change it next). The developer can change theirs any time. Naming a brand-new account when you sign up doesn't count.
- When you get a new title, the main menu greets you with a **"You have received a new Title!"** pop-up. Players who already had an account see it the next time they open the main menu.
- **Fix:** on wide computer screens the welcome screen's title and buttons sat off to the right. They're centred now.
- **Sign in with Google** looks better: Google's own button in its dark style, as wide as the box, with a short note that the sign-in is handled by Google. It no longer jumps around while it loads.

---

## 2 November 2026 – New home screen, ranked play and the leaderboard

### A new way in
- **Welcome screen:** the big No Mans Land title over an autumn battlefield, with **Log in**, **Play as guest** and **Sign up**.
- **Sign up** has its own screen: pick a username, then sign up with Google (keeps your account on any device) or as a guest on this one. **Log in** is Google sign-in.
- **Stay logged in?** is asked right after you make an account or log in, so the game can open straight on the menu next time. Change it any time in **Settings**. Off means you're logged out when you close the browser.

### The main menu
- One big **PLAY** button. It opens **Play vs Friend** and **Play vs AI**, with the match settings and the box for a match or tournament code.
- **Profile** and **Settings** sit in the top right corner (round icons on phones, labelled buttons on computers). Profile has your username, Google sign-in, **Match history** and **Log out**.
- **Tutorial**, **How to play**, **Encyclopedia** and the new **Leaderboard** are along the bottom, with the music player under them.
- The game has a new app icon: the wizard.

### Maps, looks and packs
- Everyone now plays on one map, **Standard** (the bigger board that used to be called Test Grid). The old 12×16 board is now **Old standard** and, like the other maps, only shows up for the developer.
- The **look** picker sits under the map and shows a preview of the look you pick. **Random** shows a slice of every look in one picture.
- Two unit packs: **Learn the game** (the old Standard pack: fewer units, leaders and towers) and **Standard** (every unit and leader except Blixten). What's in a pack can't be changed, except on the developer account.

### Ranked
- Choose **Normal** or **Ranked** in the PLAY popup. Ranked is played against a friend as a **best of 3** on the Standard map with the Standard pack, and both players pick from the **same 5 leaders** and the **same 3 towers**, like in the tournament.
- Ranked needs an account on both sides. A guest is enough, and a friend who joins without one gets a guest account on the spot.
- Win 2 games to take the series. **Next game** starts the next one; after the series, **New series** starts over. Leaving a ranked match loses the series.
- Only ranked series count on the **Leaderboard**: every player's wins, ties and losses and their win share (a tie counts as half a win).
- The developer can switch ranked on and off for everyone in Settings.
- **Tournaments:** hosting a tournament and Practice vs bots are now developer only. Anyone can still join a tournament with its code or link.

---

## 2 November 2026 – Accounts

- **Account** on the start screen. Tap **Play as a guest** to get your own username on this phone, no sign-up needed. You can change the username any time.
- **Sign in with Google** to keep your player if you change or reset your phone: sign in on another phone and you're the same player. A guest who signs in keeps their username.
- **Sign out** on one phone leaves your other phones signed in. **Delete account** (tap twice) removes your username and sign-in for good; past match results stay, without your name.
- We never store passwords, and nothing from your Google account except an id Google gives us for it: not your email, not your name.
- For now the account only holds your username. Matches and tournaments still work exactly as before; linking them to your account comes after Sunday's tournament.
- **Developer mode** for the game's developer: a Google account on the server's private developer list gets every feature, now and in anything added later. The Account sheet shows when it's on.

---

## 2 November 2026 – Match history on the server

- **Every online match is saved by the server.** Each round of every match on the game server (friends' matches and tournament matches) is saved by the server itself: map, look, leaders, both armies with levels and tiles, skills, towers, who won, damage and health. Tournament matches also keep the usernames.
- **Match history** on the start screen now reads from the server, newest first, with **Load more** for older battles. The **Phone-to-phone** tab shows the old list for phone-to-phone matches, and it is also shown if the server can't be reached.
- Saving never gets in the way of a match: it happens after the fight is sent, and if it fails the match just goes on.
- Rounds are kept for a year. The old Google Sheet is kept as an archive.

---

## 2 November 2026 – Our own game server: tournaments and live matches

No Mans Land now has its own game server. Tournaments and live matches against friends run on it.

### The server is the referee
- **No more cheating in live matches.** Until now the host's phone ran the match and simply believed what the other phone said about its gold and army. Now the server keeps the match: your phone only says what you do (place, move, sell, level up, buy a skill, unlock, spin...), and the server checks every action against the rules before it counts. A changed game can't give itself gold, units it hasn't unlocked or squads on tiles it may not use.
- **Secrets stay secret.** The server only sends your phone what you're allowed to see: your opponent's new squads, upgrades, sales, moves and picks stay hidden until the fight, and so do their leader and packages in round 1. Before, the host's phone had everything.
- **Both players are equal.** Nobody has to be the host who keeps the page open. The server runs the deploy clock and the fight; it waits for a player who drops out (up to 2 minutes), and a reloaded phone goes straight back into the match (the link, or **Back to match** on the menu).
- **Play a friend** now gives a `play=` link. Your opponent opens it, or types the 5-letter code on the start screen.
- **Tournament matches** start by themselves once both players are in, and the result goes from the server straight to the tournament, so nobody can report a fake result. Spectators watch through the server too.

### Tournaments live on the server
- **Tournaments keep going without the organizer.** The tournament lives on the server, not on the organizer's phone. The organizer can close the page or run out of battery, and everything is still there when they come back. Players stay connected the whole time.
- **Safer:** every player (and the organizer) gets a private key when they join. Nobody can report a result for someone else's match or use the organizer's buttons.
- **Practice vs bots:** the server plays the bot-against-bot matches, so they finish even if your phone goes to sleep.
- Tournaments are removed from the server when the organizer ends them, or after two weeks without use. Old tournaments from before this update can't be resumed.

### Phone to phone still works
- The old phone-to-phone matches stay as a backup: **Factions** matches, your own **Counter Lab units**, old `join=` links, and the **Phone to phone instead** button in the lobby. If the server can't be reached at all, a new match goes phone to phone by itself. Organizers can switch a tournament's matches to phone to phone in its settings (**Matches run on**).
- vs AI, solo and the Counter Lab work without the server, as before.
- Next: accounts with "Sign in with Google" (and Apple), and later ranked play once there are enough players for short queues.

---

## 1 November 2026 – Leafblade and Hellfiend balance

- **Leaf Wizard – Leafblade:** homing missile damage reduced from 150 to 100 per missile. Dash now has a 1.5-second cooldown per body between dash starts.
- **Ember Imps – Summon hellfiend:** portal channel increased from 3 to 4 seconds, giving opponents more time to defeat the imps before the Hellfiend emerges.

---

## 31 October 2026 – Selling stays secret until the fight

- **Fix:** you could see the moment your opponent sold a squad while you were both deploying: it vanished from their side of the board. Now a squad they sell stays on your screen, as it was, until the fight starts, just like their new squads stay hidden. This works both ways in live matches, for spectators and against the AI.
- A squad that steps out of a sold horse also stays hidden until the fight.

---

## 31 October 2026 – New unit pictures

Every tier 1 unit now has its own picture on the board, in the shop and in the encyclopedia, instead of a plain shape:

- **Skeleton Archers:** a skull in front of two crossed arrows (was a triangle).
- **Fire Mage:** a ball of fire with flames rising off it (was a hexagon, shared with other wizards).
- **Sniper:** a scope crosshair (was a cross).
- **Wisps:** a round eye (was a ring).
- **Ent:** a big, fat walking tree (was a square).
- **Rollers** (Mechites): a spoked wheel (was a circle).

Goblin Swarm and Ember Imps already had theirs. Sunken Deep's units are still placeholders and keep their shapes for now. The new pictures are also in the Counter Lab's shape list.

---

## 31 October 2026 – Tournaments

### Host a tournament
- New on the start screen: **Host a tournament**. Send the invite link (or the 4-letter code) to your friends. They open it, pick a **username**, and wait in the lobby. Works for any number of players; 6 to 12 is the sweet spot.
- Formats: **Swiss + playoffs** (everyone plays every round against someone on the same score, then the top 4 play semifinals and a final) or **Knockout**.
- Each round, your match shows on the tournament screen: tap **Start match** (if you host) or **Join match**. The match starts by itself when you are both in, and the result is sent by itself when it ends.
- **Standings**, **Matches** and a **Bracket** for the playoffs, live on every phone. The organizer can also share a **big-screen link** for a TV or laptop.
- Your opponent's username shows at the top of the screen during the match.

### Organizer tools
- **Settings:** format, Swiss rounds, playoff size, map (fixed, or a random one each round that everyone plays), look, Standard pack or All units, which leaders and units are in, **how many leaders to choose from (2 to 5)**, deploy timers (round 1 and later rounds) and the results screen timer.
- **Same rolls for both** (on by default): both players get the same leaders, starting units and tower choices to pick from.
- Set or change any result, replay a match, swap who hosts, rename or drop a player, undo a round's pairings.
- **Change who plays who:** in Matches (or Bracket → Change who plays who), tap **Change pairings**, tap a player, then the player they trade places with. Works in Swiss rounds and in the bracket, can move the bye to someone else, and in the playoffs can bring in a player from outside the cut. Only matches nobody has played yet can change; matches that change get new codes.
- If a game was already going on a match you move, both players get a **Match moved** screen and are sent to their new match; that game's result never counts.
- The tournament survives a reload of the organizer's page; everyone reconnects by themselves.

### Practice vs bots
- New on the start screen: **Practice vs bots** makes a tournament of you and **7 bots** (Bot Rusty, Bot Sprocket and friends), so you can try the whole thing alone.
- Bots play each other by themselves on the organizer's phone: real matches, played out by the AI with the tournament's rules, so the standings make sense.
- When you're drawn against a bot, tap **Play vs Bot …**: it's a normal match against the AI on your phone, with the tournament's map, timers and leader rules, and the result goes in by itself.
- In any tournament lobby the organizer can **Add a bot** (or **Remove bots**), for example to fill an odd number of players.

### Best of 3, 5 or 7
- New setting: **Knockout matches: best of 1, 3, 5 or 7** (in Swiss + playoffs it's for the playoff matches; Swiss rounds stay single games).
- Each game is its own match: after a game, your tournament screen shows **Game 2 · 1–0 · first to 2**, and you tap Start or Join again. A drawn game doesn't count.
- The organizer can add a game to either player, undo the last game, or restart the series.

### The bracket
- A real **bracket picture**: every round, winners moving on, TBD slots for what's still to come, series scores, the matches being played right now (gold) and the champion.
- It comes up by itself on your phone between playoff rounds, and there's a **Bracket** button on the tournament screen.
- Before the playoffs it shows the **projected** bracket: what the standings would give if the Swiss rounds ended now.
- The **big-screen link** now shows the bracket across the whole screen with the standings under it, made for a TV or laptop.

### Spectating
- Not playing right now? Open **Matches** and tap **Watch** next to a match. You see the board while they deploy (squads placed this round stay hidden until the fight, so no one can tip anyone off), every fight live, and who took each round.
- Works from the big screen too. When a game of a series ends, **Watch the next game** takes you along.

---

## 31 October 2026 – Balance

- **Slime Wizard:** splash 6 m → **5 m**, health 700 → **620**.
- **Flame Wizard:** health 2000 → **1700**, damage 12 → **11** per hit.
- **Truespear:** health 2000 → **1800**, range 25 m → **23 m**.
- **Frost Wizard:** now has **4 armor**.
- **Spiders:** 5 → **6** spiders per squad.

---

## 29 October 2026 – Balance

- **Tower falls:** a fallen tower still costs up to 10 health, but a round now costs at most **35 in all**, the tower included. A round that already did 35 damage costs nothing more for the tower; one that did 30 costs 5 more.
- **Necromancer:** hit 56 → **52**.
- **Meteor Caller:** splash 6 m → **5.5 m** (the mage tower's meteors too).
- **Obelisk – Evolve:** Eye of the Obelisk isn't bought any more. An Obelisk **evolves by itself, for free**, after the fight that fills its Glut (15), and keeps the Eye for the rest of the match. Enzo's Obelisks evolve too, and it doesn't use up your one awakened unit type.
- **Keep:** if you bought the +1 deployment before picking the Keep, you get the 50 gold back (Muster gives it for free).
- **Sniper tower:** can't hit anything within **1 tile** (6 m) of it.
- **Ember Imps:** health 110 → **90**. Ember Mortar: −0.2 attack speed (now −0.1 attacks/s instead of +0.1).
- **Wisps:** health 80 → **65**, attack speed 0.8 → **0.7**/s. Keep Guards (Wisps) follow.

---

## 29 October 2026 (late night) – Otto - The Gambler

### New leader: Otto - The Gambler
- Otto has a **slot machine**. Tap **Slots** in the tray: each spin costs **50 gold**, up to **3 spins a round**.
- Three of a kind pays out (or hurts):
  - 💀 **Skulls (12%):** −5 health. A skull never takes you below 1 health.
  - **Horseshoes (12%):** a free Move and +1 deployment this round. The free Move comes on top of your normal one.
  - 🪙 **Coins (12%):** +100 gold.
  - **Goblins "T1" (3%):** a random tier 1 squad at level 2, placed for you. Its unit is unlocked too, and it doesn't use a deployment.
  - 🧰 **Chest (1%):** +500 gold. Jackpot!
  - Anything else (60%): nothing.
- On average the machine loses money. Otto isn't meant to be strong, he's meant to be fun.
- Spins can't be undone, and your opponent sees what you rolled (from round 2, once leaders are revealed).
- The AI and Claude spin now and then when they play Otto.

### Looks
- **Goblin Swarm** has a new symbol on the board: a goblin head with big pointy ears.
- **Enzo's** crest is now a gift box (his free skill). Otto's crest has the dice.

---

## 29 October 2026 (late night) – Quality of life

### Deploying
- The deploy clock is now **1:30** every round (it was 1:00).
- **Keep tower – Muster:** you simply get **1 extra deployment every round**. There's no "+1" button to press any more.
- **Just a horse:** taking a squad out of a horse is **free**. It doesn't use your once-a-round Move, and the squad can keep moving (or get back in) for free that round.

### Sounds
- Using the **Move ability** now plays the purchase sound, so you hear that 50 gold was spent.
- Trying to drag an older squad you can't move (not enough gold, or you already moved one this round), or tapping a tile it can't go to, plays the "can't do that" sound.

### Board and menus
- The **tilted camera view** sits further back, so the enemy tower, its flag and its health bar are always on screen.
- **Path arrows** (Draw path) now show the squad's movement speed written along the arrow.
- The **Unlock** list shows a short description for every unit. Frost Wizard and the faction units used to show only a dot.
- Choosing **All units** in the main menu now also puts every leader back into the draw.

---

## 29 October 2026 (night) – Gold cap and shutdown bounty

### Gold carry cap
- You can carry at most **500 gold** into the next round. Anything above that is lost when the fight starts.
- If you press Fight or Ready with more than 500 gold, a warning tells you how much you'd lose, so you can keep shopping or go anyway.
- This stops "save everything, then flood the board with tier 4" from being the best plan.

### Shutdown bounty
- Win 3 rounds in a row and a 🔥 with your streak appears next to your health.
- The opponent who breaks the streak earns **+100 gold**, plus **+50** for each win past 3 (4 in a row pays 150, 5 pays 200).
- A draw ends both streaks without paying anything.
- The loser's +50 gold (from round 3) stays as it was.

---

## 29 October 2026 (late evening) – Main menu: map looks

### Looks
- The Frost look is now called **Darkwoods**, and its board no longer has the pale snow patches, snow caps and snowflakes painted on it.
- The board behind the title on the start screen now shows the map you picked in Match settings, in the look you picked. Change the map or the look and the board changes with it, while the title card fades back for a couple of seconds so you can see it properly.
- The Look picker wraps onto two lines instead of stretching out of the panel, so clicking through the looks no longer resizes the whole screen.

### Music follows the look
Deployment and battle music now belong to the look of the match, not the map:

| Look | Music |
|---|---|
| Darkwoods, Autumn | Mushroom Cavern combo |
| Snow | Icy Peak combo |
| Meadow, Desert, Forest (placeholder) | Standard combo |

Maps keep the music of their own look, so Mushroom Cavern and Frozen Peak sound as before, and Test Grid (whose own look is Darkwoods) now plays the Mushroom Cavern combo.

---

## 29 October 2026 (evening) – Music player on the start screen

- The start screen now has a **music player** under the menu buttons: the song playing, plus **Back**, **Play / Pause** and **Next**.
  - Back goes to the start of the song, or to the previous song if you press it in the first few seconds.
  - Next skips to another menu song. If you had picked one song in the Sound sheet, Next goes back to playing all menu songs.
  - Pause stops the menu music until you press Play. Turning music fully off is still done in the Sound sheet.
- The player's icons come from Kenney's Mobile Controls pack (CC0).

---

## 29 October 2026 (evening) – Fixes and tuning

### Fixes

- **PC: dragging units from the shop works again.** On a PC the board sits to the left of the panel, so dragging a card toward the board starts sideways, and the game took that as scrolling the shop. Sideways drags now pick up the card on a PC (the mouse wheel still scrolls the shop).

### Camera

- **PC: the tilted view (the second camera angle) sits a little further out**, so more of the enemy side is in view.

### Sound

- Sound effects now start at **45% volume** for new players (was 70%). If you had the old default, it moves to 45% too.
- The **UI click** (menus and in-match buttons) and the **Battle start** sound are a little quieter than the other effects.

---

## 29 October 2026 – Sound effects

The game now has sound effects, made by Snetänd.

### What makes a sound

| Sound | When it plays |
|---|---|
| Press unit in deployment | Pressing a unit card in the tray |
| Drop unit | A new squad lands on the board (also buildings and walls) |
| Press or drag in battlefield | Pressing one of your squads on the board |
| Drop or release in battlefield | Letting go of a squad you dragged to a new tile |
| Nope | A card or squad dropped where it can't go, a tile you can't place on, a locked card |
| Sell | Selling a squad |
| Undo action | Taking back a squad, a skill, a level, a move, an unlock or anything else bought this round |
| Level up | Leveling a squad or a building |
| Upgrade skill | Buying a skill (unit, tower or building) or unlocking a unit |
| Evolve / Master / Awaken | Buying a Master skill or awakening a squad |
| Battle start | The fight begins |
| Press UI button | Any other button during a match |
| Menu UI click | Any button in the menus |
| Go back to menu | Leaving a match for the main menu |

Only your own actions make sounds; the AI and your opponent stay quiet. The most frequent sounds shift pitch slightly each time so repeats don't grate.

### Settings

- The menu's Music button is now called Sound.
- The Sound sheet (and the in-match Settings) has Sound effects On/Off and an Effects volume slider (45% to start), separate from the music. Your choice is saved on the device.

---

## Earlier (summary)

- **28 Oct – Economy and towers.** Treasury and raids on Test Grid, loans for everyone, a once-per-match Major investment, loser bonus only from round 3, a fallen tower costs 10 health. Tower traits: Keep's Muster, Sniper's Mark Bounty and Airship, Bastion's Fortify and Vault. New Encyclopedia on the start screen.
- **27 Oct – Roguelike plan.** Enemy-only units and new fight mechanics (death zones, banner auras, walls, regrowing Hydra heads, Mirror Wraith, the Lich) for a future solo mode.
- **26 Oct – UI 2.0.** The deploy panel became a tray that never covers the board: drag cards straight onto the board, drag squads back to the tray to take back or sell.
- **23 Oct – Factions devtest.** Faction draft, lesser buildings, Powers, spells, the Mechites, and a Miro board synced from the game data.
- **15 Oct – Characters and bigger zones.** Four leaders (Frickolas Cage, Zoe, Emile, Wilhelm), fixed towers, 6-row zones, 60 health, new prices (100/200/300/500), Split beam and Forward planting skills.
- **12–14 Oct – Live multiplayer, skills and selling.** Play a friend over a link, two skill slots per unit, selling older squads for half price.
