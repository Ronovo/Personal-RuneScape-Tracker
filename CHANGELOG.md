# Changelog

## 1.0.0 — 2026-08-29

- Single JWT auth: `JWT_SECRET` signs every token. `LAN_MODE=1` mints one stable
  wildcard token (any player, no account) that the server prints on startup and
  the browser adopts automatically — replaces `SYNC_TOKEN`.
- **BREAKING:** `SYNC_TOKEN` removed; the server refuses to start if it is still
  set. Use `JWT_SECRET` + `LAN_MODE=1` for a LAN host. The token value changes.
  Existing ~90-day personal JWTs keep working.
- JWT plugin sync auto-claims the in-game RSN and binds one Jagex `accountHash` per site login (alts share that hash).
  Claiming happens only through that sync — the `POST /api/auth/claim-rsn` endpoint is gone, since a browser
  cannot prove ownership of a character name. The session bar now shows claim state as a readout, not a button.
- Require a Bearer token for player GETs and Flip watchlist writes when `JWT_SECRET` is configured
- Optional `SYNC_ALLOWED_USERS` allowlist (applies to the LAN wildcard token), security headers, and `/api` rate limiting
- Session-bar sign-in for public hosts; LAN hosts show a one-click copy-plugin-token button
- Hardening: stricter per-account rate limit on `/api/auth/{login,register,token}`
  (`AUTH_RATE_LIMIT_MAX`, default 10/min), email/password length caps, `TRUST_PROXY`
  opt-in for reverse-proxy deployments, HSTS on HTTPS responses, `WIKI_API_CONTACT`
  in the outbound User-Agent, and 5xx responses no longer echo internal error text
- `GET /api/health` for uptime checks and the Docker `HEALTHCHECK`; `SIGTERM`/`SIGINT`
  graceful shutdown
