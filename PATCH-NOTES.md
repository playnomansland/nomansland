# No Mans Land – Patch notes

Newest first. Each entry says what changed for players; technical details live in the README and `docs/`.

---

## 2 November 2026 – New home screen, ranked play and the leaderboard

### A new way in
- **Welcome screen:** the big No Mans Land title over an autumn battlefield, with **Log in**, **Play as guest** and **Sign up**.
- **Sign up** has its own screen: pick a gamertag, then sign up with Google (keeps your account on any device) or as a guest on this one. **Log in** is Google sign-in.
- **Stay logged in?** is asked right after you make an account or log in, so the game can open straight on the menu next time. Change it any time in **Settings**. Off means you're logged out when you close the browser.

### The main menu
- One big **PLAY** button. It opens **Play vs Friend** and **Play vs AI**, with the match settings and the box for a match or tournament code.
- **Profile** and **Settings** sit in the top right corner (round icons on phones, labelled buttons on computers). Profile has your gamertag, Google sign-in, **Match history** and **Log out**.
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

- **Account** on the start screen. Tap **Play as a guest** to get your own gamertag on this phone, no sign-up needed. You can change the gamertag any time.
- **Sign in with Google** to keep your player if you change or reset your phone: sign in on another phone and you're the same player. A guest who signs in keeps their gamertag.
- **Sign out** on one phone leaves your other phones signed in. **Delete account** (tap twice) removes your gamertag and sign-in for good; past match results stay, without your name.
- We never store passwords, and nothing from your Google account except an id Google gives us for it: not your email, not your name.
- For now the account only holds your gamertag. Matches and tournaments still work exactly as before; linking them to your account comes after Sunday's tournament.
- **Developer mode** for the game's developer: a Google account on the server's private developer list gets every feature, now and in anything added later. The Account sheet shows when it's on.

---

## 2 November 2026 – Match history on the server

- **Every online match is saved by the server.** Each round of every match on the game server (friends' matches and tournament matches) is saved by the server itself: map, look, leaders, both armies with levels and tiles, skills, towers, who won, damage and health. Tournament matches also keep the gamertags.
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
- New on the start screen: **Host a tournament**. Send the invite link (or the 4-letter code) to your friends. They open it, pick a **gamertag**, and wait in the lobby. Works for any number of players; 6 to 12 is the sweet spot.
- Formats: **Swiss + playoffs** (everyone plays every round against someone on the same score, then the top 4 play semifinals and a final) or **Knockout**.
- Each round, your match shows on the tournament screen: tap **Start match** (if you host) or **Join match**. The match starts by itself when you are both in, and the result is sent by itself when it ends.
- **Standings**, **Matches** and a **Bracket** for the playoffs, live on every phone. The organizer can also share a **big-screen link** for a TV or laptop.
- Your opponent's gamertag shows at the top of the screen during the match.

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
