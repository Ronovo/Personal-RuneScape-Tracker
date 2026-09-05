# UI fonts

Two self-hosted variable fonts, wired up in `style.css` via `@font-face`:

| File | Family | Axis | Used for |
|---|---|---|---|
| `cinzel-latin.woff2` | Cinzel | `wght` 400–900 | headings, section labels, the OSRS Tracker wordmark (`--font-display`) |
| `rubik-latin.woff2` | Rubik | `wght` 300–900 | body, labels, tables, buttons (`--font-ui`) |

Both are the **latin subset** variable woff2 from Google Fonts — one file per family
covers every weight the CSS asks for (~61 KB total).

**License:** SIL Open Font License 1.1 — `OFL-Cinzel.txt`, `OFL-Rubik.txt`. Free to
bundle, redistribute, and use commercially.

`public/` is served as-is by `express.static` and copied verbatim by the Dockerfile,
so there's no build step — edit `style.css` and hard-refresh.

## Swapping a font

Drop the new `.woff2` here and update the matching `@font-face` block + the
`--font-display` / `--font-ui` var at the top of `public/style.css`.
