# OSRS Tracker

A lightweight OSRS hiscores, collection log, and Grand Exchange tracker. Node/Express backend, plain HTML/CSS/JS frontend, no build step.

## Features

### Character

Look up a player's OSRS hiscores by username: combat level, total level, and total XP, plus a full skill-by-skill breakdown (level/XP/rank) and tabbed views for boss kill counts, minigame scores, and other tracked activities (clue scrolls, etc.).

### Collection Log

Look up a player's synced collection log via TempleOSRS: overall items obtained, categories completed, and collections hiscores rank, browsable by group (Bosses, Raids, Clues, etc.) and category, with each item shown as obtained or missing. See [Setting up TempleOSRS sync](#setting-up-templeosrs-sync) below if a lookup comes back empty.

### Grand Exchange

Browse the day's biggest risers and fallers on the Grand Exchange (filterable by volume, price, margin, ROI, freshness, and members/F2P), or search for a specific item to see its current buy/sell price, range-aware history chart, trade volume, flip margin after tax, ROI, profit at buy limit, and alch values.

### Flip Helper

Scan the Grand Exchange for buy-low/sell-high opportunities ranked by profit after the 2% GE tax (capped at 5m gp, with tax-exempt items handled). Filter by volume, price, margin, ROI, price age, and members/F2P; use presets (high volume, high margin, best ROI, F2P, cheap flips, fits-my-bankroll); pin a per-player watchlist; and run a client-side flip calculator. Confidence dots flag stale or unusually wide margins — the wiki API reports completed trades, not live offers, so always check the in-game GE before committing.

## Setting up TempleOSRS sync

The Collection Log tab reads from [TempleOSRS](https://templeosrs.com), not Jagex directly — Jagex doesn't expose collection log contents through any official API, so a player only shows up here if they've synced their log at least once:

1. Make sure you have a profile on [templeosrs.com](https://templeosrs.com) for your name (search your name there and press Update if it says none exists).
2. Keep that data updating automatically going forward by enabling RuneLite's built-in [**XP Updater**](https://github.com/runelite/runelite/wiki/XP-Updater) plugin (this is a separate, core RuneLite plugin — not a Plugin Hub install). In RuneLite's plugin list, find **XP Updater**, open its settings, and turn on the **TempleOSRS** toggle ("Automatically updates your stats on templeosrs.com when you log out"). Without this on, your XP/KC tracker data will keep going stale over time and step 2 will need to be repeated manually.
3. In RuneLite, open **Configuration** (wrench icon) → **Plugin Hub**, search "**TempleOSRS**", and install the (separate) TempleOSRS plugin — this one handles collection log sync specifically.
4. Open your in-game **Collection Log** interface and click the sync button in its top-right corner (the plugin also has an auto-sync setting, but manual sync is needed to get accurate item quantities).

Once synced, searching that username on the Collection Log tab here will pull the data in.

## Run it

```
npm install
npm start
```

Serves on `http://localhost:4123` (override with `PORT=xxxx npm start`).

## Run it with Docker

```
docker build -t osrs-tracker .
docker run -p 4123:4123 osrs-tracker
```

No API keys or environment variables needed — the OSRS hiscores, OSRS Wiki prices, and TempleOSRS APIs it talks to are all public and keyless.
