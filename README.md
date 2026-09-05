# OSRS Tracker

A lightweight LAN dashboard for Old School RuneScape. It combines character
hiscores, quest, achievement diary, combat achievement, and collection log
progress synced from RuneLite, Grand Exchange market views, item charts, and
a Flip Helper in one responsive app.

The server and browser code are TypeScript compiled with `tsc`. The backend uses
Node/Express; the frontend is framework-free HTML, CSS, and ES modules.

## Features

### Character

Look up a player's Jagex hiscores by username:

- Combat level, total level, and total XP
- Skill levels, XP, and ranks
- Boss kill counts, minigame scores, and other ranked activities

The **Quests**, **Diaries**, **Combat Achievements**, and **Collection Log**
tabs are the exception: Jagex's hiscores don't expose any of them, so all four
read the state the RuneLite plugin syncs instead.

- **Hiscores**
- **Boss Kills
- **Quests** 
- **Achievement Diaries** 
- **Combat Achievements** 
- **Collection Log**

See [Plugin sync](#plugin-sync) if any of those tabs have no data.

### Leagues Tasks

Browse a player's completed tasks from the Leagues Task Plugin (Coming Soon), synced the same
way as Quests and the Collection Log above:

The Leagues Task Plugin is a fun way to spice up your OSRS journey by completing tasks from a list compiled from all the previous OSRS Leagues events. 
See [Plugin sync](#plugin-sync) if the page has no data.

### Grand Exchange

Browse and filter Wiki market data. 

- 24-hour risers and fallers with clearly labeled price changes
- High Volume and Random quick views
- F2P toggle on the view toolbar, plus a collapsible filter drawer with price, daily-volume, freshness (incl. max trade age), membership, and sorting controls
- Item-name search with direct links into the Flip Helper
- Responsive item-count choices for desktop and mobile

Each item page includes current high/low prices, a range-aware SVG history
chart, daily volume, trade freshness, after-tax margin, ROI, buy-limit profit,
capital requirements, and alchemy values.

### Flip Helper

Scan the market for buy-low/sell-high opportunities. Mark items on a wishlist that you want to Every scan method here
ranks by profit, so this is where the more specific searching happens:

- After-tax profit, ROI, buy-limit profit, GP/hr, capital, volume, age, and confidence
- Penny Arcade, High Margin, Best ROI, GP / Hour, Best Overall, Fits My Bankroll, and Watchlist presets
- F2P toggle on the preset toolbar, and a collapsible filter drawer
  - Bankroll, pPice, Volume, Profit, ROI, Margin Vs. 24h Average, Trade Age, Membership)
- A calculator that can load any result and return to its original page

GE tax is 2% of the sale price, floored and capped at 5,000,000 gp. Known
tax-exempt items and charged/dosed variants are handled server-side.

Confidence flags combine volume, trade age, and how unusual the current margin
is compared with its 24-hour average.

> The Wiki API reports completed trades, not live offers. Always verify the
> actual in-game GE offer box before committing money.

## Plugin sync

Jagex publishes skills and kill counts, but not which quests you have finished,
what achievement diary tiers you've completed, your combat achievement tasks,
or what is in your collection log. All of those come from the Leagues Tasks
RuneLite plugin, which posts to dedicated `/api/sync/*` endpoints. **Sync
Everything** uses `/api/sync/leagues` and may include every section; each
other sync button posts to its own route and carries only that section.
Whichever sections a full-sync request omits are left untouched, keeping
whatever that player last synced for them.

Configure the URL and token first, in the plugin's **Sync Settings** card
(see [Authentication](#authentication-two-postures-one-token-type)), then from the **Sync Progress** panel:

- **Sync Tasks** — posts to `/api/sync/tasks` with only your completed league tasks.
- **Sync Quests** — posts to `/api/sync/quests` with only your quest states.
- **Sync Collection Log** — there is no sidebar Collection Log button. Open
  the in-game **Collection Log** and click **Sync** in its top-right corner.
  That posts to `/api/sync/collectionlog`. If the log is not open and nothing
  has ever been captured, the plugin tells you to open it first.
- **Sync Achievement Diary** — posts to `/api/sync/diaries` with only achievement diary tier completion.
- **Sync Combat Achievements** — posts to `/api/sync/combatachievements` with only combat achievement task completion
  and total CA points.
- **Sync Everything** — posts to `/api/sync/leagues` with every section in one request. Collection log
  is included only if it was already captured (open the log and use its Sync
  button first); otherwise that section is omitted so the server keeps the last dump.

A player who has never synced a given section (or is syncing for the first
time altogether) simply has that section stay empty/absent until a sync
includes it — no sync ever wipes a section by leaving it out. The same
protection covers a re-installed plugin that sends an explicit **empty**
array for completed tasks (its local store has nothing to send yet): that's
still treated as "nothing to update," not as "clear what's stored," so a
reinstall can't silently wipe a player's synced history either.

## Run locally

```bash
npm ci      # or: npm install
npm start
```

Node 24+ (see `.nvmrc`; `nvm use` picks it up). Open `http://localhost:4123`.

The server binds to `0.0.0.0`, so another device on the same LAN or Tailscale
network can open `http://<computer-address>:4123`.

`npm start` builds both TypeScript targets and then runs `dist/server.js`. Set
the `PORT` environment variable to override port 4123.

### Authentication (two postures, one token type)

Every credential is a JWT signed with `JWT_SECRET`. There is no separate shared-secret
path. `LAN_MODE` picks the deployment posture:

| Env | Posture | Behaviour |
|---|---|---|
| `JWT_SECRET` + `LAN_MODE=1` | **LAN** | Server mints one stable wildcard token (any player, no account) and prints it on startup. |
| `JWT_SECRET` only | **Public** | Per-player accounts; each personal token is scoped to that player's RSNs. |
| neither | **Guest** | Hiscores + Grand Exchange only. Sync POSTs fail closed with 401. |

#### LAN / friend group

```powershell
$env:JWT_SECRET = "a-long-random-secret"
$env:LAN_MODE = "1"
npm start
```

```bash
JWT_SECRET=a-long-random-secret LAN_MODE=1 npm start
```

The server prints the token on startup:

```
LAN mode — stable plugin/browser API token:
  eyJhbGciOiJIUzI1NiJ9...
```

- **Browser** — open the tracker on the LAN host; it stores the token automatically.
- **RuneLite** — paste the printed token (or click **Copy plugin token** in the header) into **Sync Settings → API Token**.

The token is the same every restart as long as `JWT_SECRET` is unchanged.
`SYNC_ALLOWED_USERS=zezima, other` still limits which RSNs it can sync or read.

**Never set `LAN_MODE` on an internet-exposed host** — `GET /api/auth/status`
returns the wildcard token to any caller. Use public posture there.

#### Public website

```powershell
$env:JWT_SECRET = "a-long-random-secret"
npm start
```

Use HTTPS in production. Registration and sign-in are enabled; the wildcard token
is not mintable. Sign in stores a personal JWT in the browser automatically. The
app emits `Strict-Transport-Security` on HTTPS responses automatically — set
`TRUST_PROXY=1` so it fires when TLS is terminated at a reverse proxy.

Each player:

1. Opens the tracker and uses **Sign in** / **Register** in the header (Playing as is hidden until then)
2. Clicks **Copy plugin token** and pastes it into RuneLite **Sync Settings → API Token**
3. Logs into OSRS and syncs. The first sync binds that Jagex account and claims the character name. Alts on the same Jagex account claim automatically when you sync them with the same token. A different Jagex account needs a different site login.

That JWT is scoped to RSNs bound this way — syncing or reading another player's data returns 403. Tokens last ~90 days; sign in again and copy a fresh one from **Copy plugin token**. Playing as only chooses whose data you are viewing; it does not grab a name.

**RSN ownership is first-come-first-served.** Sync binds a character name using
the `accountHash` in the request body, which the RuneLite plugin derives from
the logged-in Jagex account — but the server has no Jagex-side proof of
ownership. A direct API caller could bind an *unclaimed* name to their own
login; the real owner would then get a 403 until an admin deletes
`data/users/rsn-claims/<rsn>.json` (and the `hash-claims` / user record
entries). Claimed names are safe. If you run a public instance, know this
tradeoff; a future version may cross-check the name against Jagex hiscores.

#### Plugin settings (both postures)

- **Server URL** — base URL only (`http://localhost:4123` or `https://your-host`). Only `http://` and `https://` are accepted.
- **API Token** — the value from **Copy plugin token** in the tracker header (the printed token on a LAN host; a personal token after sign-in on a public host)

Hiscores and Grand Exchange stay public. Character plugin tabs, Leagues Tasks, and Flip watchlist require auth when `JWT_SECRET` is configured.

Optional hardening:

- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` — in-process cap on `/api/*` (default 120/min per IP). Set `RATE_LIMIT_MAX=0` to disable.
- `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS` — stricter cap on `/api/auth/{login,register,token}` (default 10/min), keyed by IP + submitted email so login guessing is throttled per account.
- `TRUST_PROXY` — set to `1` (or a preset like `loopback`) **only** when a reverse proxy actually terminates connections in front of the app. It makes rate limiting key on the real client IP and lets HSTS fire behind the proxy. Leave it unset for a direct LAN host — trusting `X-Forwarded-For` when nothing sets it lets clients spoof their IP.
- `WIKI_API_CONTACT` — contact string added to the outbound User-Agent on OSRS Wiki API calls. Defaults to the project repo URL.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, CSP (wiki icons only cross-origin), and `Strict-Transport-Security` on any response served over HTTPS.

## API

Player GETs and watchlist writes require Bearer auth when `JWT_SECRET` is
configured. Sync POSTs always require it.

Every `/api` response is JSON, including errors: `{ "error": "..." }` with the
status code. 5xx bodies are always the generic `Internal error` — internal text
(filesystem paths, parser messages) is never sent to a client.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Uptime check; ahead of the rate limiter, used by the Docker `HEALTHCHECK` |
| GET | `/api/auth/status` | none | Posture (`guest`/`public`/`lan`) + the LAN token |
| POST | `/api/auth/register` | none | Create account (public posture only) |
| POST | `/api/auth/login` | none | Sign in, returns personal JWT (public posture only) |
| POST | `/api/auth/token` | JWT bearer (public) / none (LAN) | Mint a plugin token |
| GET | `/api/auth/me` | JWT bearer | Current account + claimed RSNs |
| GET | `/api/hiscores/:username` | none | Jagex hiscores lookup |
| GET | `/api/collectionlog/:username` | bearer if auth configured | Collection log from the last plugin sync |
| GET | `/api/ge/movers` | none | 24h GE risers/fallers |
| GET | `/api/ge/item/:id` | none | Item detail + price history |
| GET | `/api/ge/search` | none | Item name search |
| POST | `/api/sync/leagues` | bearer | Full plugin sync (all sections) |
| POST | `/api/sync/tasks` | bearer | Completed league tasks only |
| POST | `/api/sync/quests` | bearer | Quest progress only |
| POST | `/api/sync/collectionlog` | bearer | Collection log only |
| POST | `/api/sync/diaries` | bearer | Achievement diary tiers only |
| POST | `/api/sync/combatachievements` | bearer | Combat achievements only |
| GET | `/api/quests/:username` | bearer if auth configured | Quest progress from the last plugin sync |
| GET | `/api/diaries/:username` | bearer if auth configured | Achievement diary tier progress from the last plugin sync |
| GET | `/api/combatachievements/:username` | bearer if auth configured | Combat achievement progress from the last plugin sync |
| GET | `/api/leagues/:username` | bearer if auth configured | Leagues task progress from the last plugin sync |
| GET | `/api/ge/flips` | none | Flip Helper scanner |
| GET | `/api/watchlist/:username` | bearer if auth configured | Flip Helper watchlist for this character |
| PUT | `/api/watchlist/:username` | bearer if auth configured | Replace this character's Flip Helper watchlist |

## Run it with Docker

```bash
docker build -t osrs-tracker .
docker run -d \
  --name osrs-tracker \
  --restart unless-stopped \
  -p 4123:4123 \
  -e JWT_SECRET=a-long-random-secret \
  -e LAN_MODE=1 \
  -e SYNC_ALLOWED_USERS= \
  -v osrs-tracker-data:/app/data \
  osrs-tracker
```

The image sets `NODE_ENV=production`. Outside Docker, set it too on any host
that is not a local dev box — the app has its own JSON error handler, but
`NODE_ENV` is what stops Express's fallback from ever adding a stack trace.

`docker logs osrs-tracker` shows the printed LAN token. Drop `LAN_MODE=1` for a
public host (accounts instead of a shared token).

The `-v` flag keeps player data — synced tasks, quests, collection log, and
Flip Helper watchlists — in a named Docker volume, outside the container.
Without it, all of it lives only inside the container and is lost the next
time it's removed — including by the update steps below.

To rebuild a checked-out copy after pulling updates:

```bash
git pull origin main
docker build -t osrs-tracker .
docker rm -f osrs-tracker
docker run -d --name osrs-tracker --restart unless-stopped -p 4123:4123 -e JWT_SECRET=a-long-random-secret -e LAN_MODE=1 -v osrs-tracker-data:/app/data osrs-tracker
```


## Development

```bash
npm run typecheck      # Check server and client without writing output
npm run lint           # ESLint, type-aware (see eslint.config.mjs)
npm run build          # Build dist/ and browser JavaScript
npm run build:server   # Build the Express server and copy its JSON asset
npm run build:client   # Compile src/client/*.ts into public/client/*.js
npm test               # Build server and client, run both node:test suites
npm run test:coverage  # Same, with a per-file coverage report
npm start              # Build, then run the server (see npm run stop below)
npm run stop           # Free the port by killing whatever is listening on it
npm run restart        # stop, then start - for picking up a fresh build/config
npm run scrape:quests  # Refresh src/lib/quest-metadata.json from the wiki
npm run scrape:combatachievements  # Refresh combat achievement metadata from the wiki
npm run import:leagues -- <path>   # Refresh leagues-task-metadata.json from the plugin's leagues_tasks.json
```

## Data sources

- [Jagex Hiscores](https://secure.runescape.com/m=hiscore_oldschool/) for character data
- The Leagues Task Randomizer RuneLite plugin for quests, league tasks, and the collection log
- [OSRS Wiki Real-time Prices](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices) for Grand Exchange data
- [OSRS Wiki](https://oldschool.runescape.wiki/) for collection log item icons

These services are public and keyless; no API keys are required.

The two bundled fonts (Cinzel and Rubik, subset to latin) are self-hosted under
SIL OFL 1.1 — see [public/fonts/README.md](public/fonts/README.md) and the
`OFL-*.txt` licence files beside them.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
