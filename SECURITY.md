# Security Policy

## Supported versions

This project follows the latest release on `main`. Fixes land there; the `1.x`
line is the only supported version.

## Reporting a vulnerability

Please report suspected vulnerabilities privately — do **not** open a public
issue.

- Preferred: open a [private security advisory](https://github.com/Ronovo/Personal-RuneScape-Tracker/security/advisories/new)
  on GitHub.
- Alternative: email the maintainer (address on the GitHub profile).

Include the affected version/commit, reproduction steps, and impact. Expect an
acknowledgement within about a week, and a fix or mitigation plan once the
report is confirmed.

## Scope

This is self-hosted software. Each deployer runs and secures their own
instance. Notes that matter for a public deployment:

- **RSN ownership is first-come-first-served.** The first sync for a character
  name binds it to that login; there is no Jagex-side ownership proof. See the
  README "Authentication" section.
- Run behind HTTPS and set `TRUST_PROXY` so rate limiting keys on the real
  client IP.
- Never set `LAN_MODE` on an internet-exposed host — it hands the wildcard
  token to any caller of `GET /api/auth/status`.
