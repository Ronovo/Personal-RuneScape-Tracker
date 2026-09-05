# Contributing

A personal project, so this is mostly a note to my future self.

## The loop

```bash
npm install
npm run typecheck      # server + client, no output written
npm run lint           # ESLint, type-aware
npm test               # builds, then runs both node:test suites
npm start              # build and run (npm run stop frees the port)
```

`npm run typecheck` is the baseline check and is fast. Run it before every
commit; CI runs `typecheck`, `lint`, `test` and `npm audit --omit=dev` on every
push.

There is **no watch script**. After changing anything under `src/client/`, run
`npm run build:client` before reloading the page — the browser loads the
compiled output in `public/client/`, not the TypeScript.

## Where code goes

See [docs/architecture.md](docs/architecture.md). The short version:

- Both sides need it → `src/shared/`
- Server only → `src/lib/`
- Browser only → `src/client/`
- `src/lib/` may import `src/shared/`. Neither may import `src/client/`.

## House style

- **Comments explain why, not what.** A comment that restates the code is worse
  than none, because it has to be re-verified on every change. If a comment
  describes behaviour, it is a claim that has to stay true.
- **Escape before `innerHTML`.** Everything renders as markup; every value that
  came from data goes through `escapeHtml`.
- **Never build a filesystem path from user input** without a validator that
  rejects separators and dot-segments. `storageKey()` does this for player
  names; email addresses are hashed instead.
- **Errors carry a status.** Throw `httpError(message, status)`; `jsonErrors` in
  `app.ts` turns it into a response. 4xx messages reach the client, 5xx never do.
- **A new column, filter or tab is one declaration.** `flipColumns.ts`,
  `filterRow.ts` and `loadSyncedTab` exist because those things used to be
  spelled out in five or six places and had drifted apart.

## Tests

`node:test`, no framework. Server tests live beside their module as
`*.test.ts`; client tests only cover the pure modules, since the page scripts
are top-level DOM wiring.

- A test that only exercises a helper nothing else calls is not coverage.
  If a test needs a function to exist, production should call that function too.
- `npm run test:coverage` prints a per-file report.

Worth testing first: anything that parses untrusted input, anything that builds
a path, and any fallback that real data never exercises (a metadata miss, a
corrupt file, an empty section).

## Compiler settings and lint

`tsconfig.base.json` runs `strict` plus `noUnusedLocals`,
`noUnusedParameters` and `noUncheckedIndexedAccess`. The last one is why indexed
access is guarded rather than asserted. Don't turn them off to make an error go
away.

`eslint.config.mjs` is deliberately narrow — tsc already covers dead code and
unchecked indexing, so lint carries the rules it can't express, chiefly
`no-floating-promises`. A page script that drops a promise drops the error with
it. Where firing and forgetting is the intent, say so with `void`.

## Refreshing the offline metadata

```bash
npm run scrape:quests
npm run scrape:combatachievements
npm run import:leagues -- <path to the plugin's leagues_tasks.json>
```

Each script has a `--check` mode that verifies the current data still decodes
every name in `data/sync/`. They are deliberately not part of `npm run build`,
which stays offline.
