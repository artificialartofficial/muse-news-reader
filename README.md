# Muse News Reader

A personal RSS reader web app: an inbox-first feed reader with themes, a
distraction-free article reader, keyboard navigation, stars, notes,
highlights, full-text search, per-feed settings, OPML import/export, and
automatic archiving and retention.

This is the app source only. It ships with a few example feeds; add your own
subscriptions through the app's add-feed flow or by importing an OPML file.

## Stack

- **Client:** React 19 + TanStack Query, built with `client/build.mjs`
  (Bun + Tailwind).
- **Server:** TypeScript actions in `server/src/actions.ts`, built with Bun.
- **Data:** SQLite via Drizzle ORM, migrations in `drizzle/`.
- **Runtime:** the server actions are written for the Muse artifact runtime
  (`@hatch/space-sdk`, providing `defineAction`, `ctx.db`, `ctx.blobs`, …).

## Developing inside Muse

Install and typecheck with Bun (1.3+):

```sh
bun install
bun x tsc --noEmit -p client/tsconfig.json
bun x tsc --noEmit -p server/tsconfig.json
```

The app is published and run through the Muse web-artifact builder; see
`space.json` for the runtime config. The database (`app.db`) and blob storage
are managed by the runtime and are never committed.

## Developing outside Muse

The React client is a standard React app and can be worked on standalone, but
the server actions depend on `@hatch/space-sdk`, which is provided by the Muse
environment and is not published to npm. To run the full app outside Muse you
would need to stub the runtime context (`ctx.db` backed by SQLite via Drizzle,
`ctx.blobs` for image storage, and the action RPC layer in
`client/src/api.ts`). The client build (`bun ./client/build.mjs`) emits a
static bundle to `client/dist/`.

## Project layout

```
client/src/        React app (App.tsx, reader, library, organize views)
client/build.mjs   client bundler
server/src/        server actions (actions.ts) and Drizzle schema (schema.ts)
drizzle/           SQLite migrations
space.json         artifact runtime config
```

## Notes

- Reads are the unit of the app: opening an article archives it; the Archive
  view is the home for everything read.
- Articles are permanently deleted after the retention window (30 days by
  default, configurable per install) unless starred, annotated, or from a
  feed marked keep-forever.
- Feed refresh is driven by a scheduled action (`news-rss-refresh` in
  `space.json`); inside Muse this runs every 30 minutes.
