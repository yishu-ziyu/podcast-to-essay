# AGENTS.md

Working rules for AI coding agents in this repository. Keep this file short: it is a map plus the invariants that must not break. Details live in the linked docs.

## What this is

誊清 (repo `podcast-to-essay`): a web app that imports a video/podcast (link or file), transcribes it with StepFun ASR in ~3-minute chunks, and rewrites the draft into a structured, verifiable article. Code lives in `web/` (React + Vite front end, zero-dependency Node server). Production: <https://lcw.yishuziyu.cn>.

## Source of truth

Each area has one authoritative doc. When behavior or a contract in that area changes, update the doc **in the same commit** — never code alone.

| Area | Authoritative doc |
|---|---|
| System shape, modules, job pipeline | [docs/architecture.md](docs/architecture.md) |
| HTTP API (routes, auth, errors) | [docs/api.md](docs/api.md) |
| On-disk data (`raw/`, `cleaned/`, `jobs/`) | [docs/data.md](docs/data.md) |
| Why things are the way they are | [docs/decisions/](docs/decisions/README.md) |
| Known problems and next work | [docs/backlog.md](docs/backlog.md) |
| Acceptance contracts and E2E runs | [docs/evals/](docs/evals/README.md) |
| Production deploy and server state | [deploy/REDEPLOY.md](deploy/REDEPLOY.md) |

Start at [docs/README.md](docs/README.md) for the full map.

## Invariants

- A failed step never masquerades as success: no `cleaned/<slug>.md` unless the article passed validation; failed deletes/imports surface an error.
- Replacing an episode's audio clears everything derived from the old audio (drafts, `chunks/`, ASR/transcription state); `transcribe.mjs` reuses `chunks/` if present.
- Titles and durations come only from each episode's `raw/<slug>/source-meta.json`.
- Every step is started by the user; nothing auto-transcribes or auto-rewrites.
- `raw/` and `cleaned/` are user data. Do not delete, move, or rewrite them without explicit approval for the exact paths.

## Commands

```bash
cd web
npm test                 # server (node --test) + front-end lib tests
npx tsc --noEmit -p .    # type check
npm run build            # vite build
npm run dev              # vite :5173 + server :8787 (repo-root .env.local is loaded)
```

Port 5173/8787 are often taken by other local projects. Start the pieces directly instead:
`IS_DEV=1 PORT=<api> node server/index.mjs` and `API_PORT=<api> node node_modules/vite/bin/vite.js --port <web> --strictPort`.
Server code changes need a server restart; the front end hot-reloads.

## Testing

- Unit tests and intercepted/mocked browser checks are supporting evidence only.
- Every change that touches a user flow gets an **end-to-end run on the real path**: the real UI, real inputs — real Bilibili / YouTube / Douyin / podcast links, share text with a link inside, unfamiliar or unsupported URLs, real files. Record links tried and observed results in `docs/evals/` (see its README).
- Transcription and article generation spend StepFun quota: use short clips, and delete test episodes through the UI afterwards.
- Check guest mode as well as owner mode; the public site is guest-first.

## Commits

- Format: `<type>(web): <中文描述>` with a body explaining why; types feat, fix, refactor, docs, test, chore, perf, ci.
- **Never** add `Co-Authored-By` or any agent attribution (Claude, Cursor, etc.). The author is the user's own git identity.
- Stage only files you changed; the working tree often holds unrelated user data (`raw/`, `cleaned/`, `miniprogram/`).

## Deploy

Follow [deploy/REDEPLOY.md](deploy/REDEPLOY.md). Production changes need the user's go-ahead. Before restarting, confirm no job in `/data/jobs` is queued/running/paused. Build with `nohup` in the background; if the server cannot reach GitHub, ship commits with `git bundle`. Verify on the public URL in guest mode afterwards.
