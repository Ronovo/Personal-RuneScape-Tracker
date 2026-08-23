# OSRS Tracker

A lightweight LAN dashboard for Old School RuneScape. It combines character
hiscores, TempleOSRS collection logs, Grand Exchange market views, item charts,
and a Flip Helper in one responsive app.

The server and browser code are TypeScript compiled with `tsc`. The backend uses
Node/Express; the frontend is framework-free HTML, CSS, and ES modules.

## Features

### Character

Look up a player's Jagex hiscores by username:

- Combat level, total level, and total XP
- Skill levels, XP, and ranks
- Boss kill counts, minigame scores, and other ranked activities

### Collection Log

Browse a player's TempleOSRS collection log:

- Overall items obtained, categories completed, and collection-log rank
- Categories grouped into Bosses, Raids, Clues, Minigames, and more
- Filters for unstarted, started, and completed categories
- Obtained/missing item grids with recorded quantities

See [Setting up TempleOSRS sync](#setting-up-templeosrs-sync) if a lookup has no data.

### Grand Exchange

Browse and filter Wiki market data:

- 24-hour risers and fallers with clearly labeled price changes
- Penny Arcade, Random, Spread, and Staircase quick views
- Price, daily-volume, freshness, membership, and sorting controls
- Item-name search with direct links into the Flip Helper
- Responsive item-count choices for desktop and mobile

Each item page includes current high/low prices, a range-aware SVG history
chart, daily volume, trade freshness, after-tax margin, ROI, buy-limit profit,
capital requirements, and alchemy values.

### Flip Helper

Scan the market for buy-low/sell-high opportunities:

- After-tax profit, ROI, buy-limit profit, capital, volume, age, and confidence
- High Volume, High Margin, Best ROI, F2P, Cheap Flips, Fits My Bankroll, and Watchlist presets
- Selectable desktop columns with saved defaults and a dedicated mobile card view
- A calculator that can load any result and return to its original page
- GE "Flip" links that automatically load the linked item into the calculator

GE tax is 2% of the sale price, floored and capped at 5,000,000 gp. Known
tax-exempt items and charged/dosed variants are handled server-side.

Confidence flags combine volume, trade age, and how unusual the current margin
is compared with its 24-hour average.

> The Wiki API reports completed trades, not live offers. Always verify the
> actual in-game GE offer box before committing money.



## Setting up TempleOSRS sync

Jagex does not provide collection-log contents through an official API. The app therefore reads from 
[TempleOSRS](https://templeosrs.com), and a player only appears after syncing at least once:

1. Make sure you have a profile on [templeosrs.com](https://templeosrs.com) for your name (search your name there and press Update if it says none exists).
2. In RuneLite, open **Configuration** (wrench icon) → **Plugin Hub**, search for **TempleOSRS**, and install the plugin.
3. Open the in-game **Collection Log** and use the sync button in its top-right corner.

After syncing, search for that username on the Collection Log page.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:4123`.

The server binds to `0.0.0.0`, so another device on the same LAN or Tailscale
network can open `http://<computer-address>:4123`.

`npm start` builds both TypeScript targets and then runs `dist/server.js`. Set
the `PORT` environment variable to override port 4123.

## Run it with Docker

```bash
docker build -t osrs-tracker .
docker run -d \
  --name osrs-tracker \
  --restart unless-stopped \
  -p 4123:4123 \
  osrs-tracker
```

To rebuild a checked-out copy after pulling updates:

```bash
git pull origin main
docker build -t osrs-tracker .
docker rm -f osrs-tracker
docker run -d --name osrs-tracker --restart unless-stopped -p 4123:4123 osrs-tracker
```

If Docker Compose manages the existing container, the equivalent update is:

```bash
git pull origin main
docker compose up -d --build
```



## Development

```bash
npm run typecheck     # Check server and client without writing output
npm run build         # Build dist/ and browser JavaScript
npm run build:server  # Build the Express server and copy its JSON asset
npm run build:client  # Compile src/client/*.ts into public/*.js
```

There is no test framework or watch script. After changing browser TypeScript,
run `npm run build:client` before refreshing the page. Use `npm run typecheck`
as the baseline validation.

## Data sources

- [Jagex Hiscores](https://secure.runescape.com/m=hiscore_oldschool/) for character data
- [TempleOSRS](https://templeosrs.com/) for synced collection logs
- [OSRS Wiki Real-time Prices](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices) for Grand Exchange data

These services are public and keyless; no API keys are required.