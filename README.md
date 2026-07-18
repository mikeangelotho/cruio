# Cruio

Creative pipeline platform — MVP of the core review loop from the
[whitepaper](docs/cruio-whitepaper.pdf).

Everything lives on one spatial canvas: deliverables are cards on an infinite
dot-grid workspace; opening one is a camera move into review mode, where the
asset gets the screen. Annotation is always on — a click on the asset places a
pin and opens a thread. Every thread resolves (approved / needs revision), and
approval is blocked while threads are open. Decisions write a permanent audit
record.

## Stack

- [SolidStart 2](https://start.solidjs.com) + Tailwind v4 + Vite
- SQLite via `@libsql/client` + Drizzle (file at `data/cruio.db`, created on boot)
- Uploads stored on disk at `data/uploads/`
- No auth (single workspace); commenter identity is a name picker in `localStorage`

## Develop

```bash
bun install
bun run dev        # http://localhost:3000 (PORT env respected)
```

## Using it

| Where | Action |
| --- | --- |
| Workspace | `N` / double-click — new deliverable · drop images anywhere — new deliverable + v1 · drag cards to arrange · click card — review |
| Review | click image — pin + thread · `U` / drop — next version · `1–9` — versions · `← →` — next deliverable · `Tab` — threads panel · `Esc` — back |
| Anywhere | `⌘/Ctrl K` — command palette · `F` — fit to screen · scroll — zoom · middle/left-drag — pan |

Approve / Request revisions live in the top bar in review mode. Approve is
disabled until every thread on the version is resolved.

## Layout

- `src/lib/canvas/` — camera (pan/zoom/flyTo), dot-grid renderer, world geometry
- `src/lib/store.ts` — optimistic client store over server functions (`src/lib/api.ts`)
- `src/components/ProjectCanvas.tsx` — the single canvas: workspace + review modes
- `src/routes/api/` — multipart upload + file serving
- `src/db/` — Drizzle schema + bootstrap DDL
