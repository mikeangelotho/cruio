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
- SQLite via `@libsql/client` + Drizzle (file at `data/cruio.db`, created on boot;
  schema applied via hand-maintained boot DDL + an idempotent `migrate()` step
  in `src/db/index.ts` — no drizzle-kit)
- Uploads stored on disk at `data/uploads/`
- Auth via [better-auth](https://better-auth.com) with the organization plugin:
  email+password sign-in, multi-workspace (org) switching, roles
  **owner / admin / member / guest**. Guests are external reviewers scoped to
  the projects they've been shared into (`project_shares`); invites are
  copyable links (`/invite/[id]`). Access is enforced server-side on every
  `"use server"` function (`src/lib/guard.ts`, `src/lib/permissions.ts`) —
  client-side checks only hide affordances.

## Develop

```bash
bun install
bun run dev        # http://localhost:3000 (PORT env respected)
```

Required env var: `BETTER_AUTH_SECRET` (any random string). The app boots
without it in development with a warning, but refuses to start in production
(`NODE_ENV=production`) — never deploy without setting it. Optional:
`BETTER_AUTH_URL` if the app isn't reachable at the request's inferred origin.

## Using it

| Where | Action |
| --- | --- |
| Workspace | `N` / double-click — new deliverable · drop images anywhere — new deliverable + v1 · drag cards to arrange · click card — review |
| Review | click image — pin + thread · `U` / drop — next version · `1–9` — versions · `← →` — next deliverable · `Tab` — threads panel · `Esc` — back |
| Anywhere | `⌘/Ctrl K` — command palette · `F` — fit to screen · scroll — zoom · middle/left-drag — pan |

Approve / Request revisions live in the top bar in review mode. Approve is
disabled until every thread on the version is resolved.

The left side of the top nav (workspace switcher + entity selector) scopes
everything on the right (Projects / Tasks / Library) to the selected
**entity** — a client company or internal department that projects belong to,
managed at `/settings/entities`. Entity selection persists per-workspace
across reloads and navigation.

**Library** lives at two levels: an overarching workspace library, plus one
folder per project (auto-created with the project, deleted only when the
project is deleted — archiving a project does not touch its folder). Every
deliverable version is mirrored into its project's folder automatically;
standalone files (PDFs, video, audio, fonts, zips, office docs — see
`src/lib/filetypes.ts` for the safelist and size caps) can also be uploaded
directly. Canvas/deliverable uploads remain image-only.

**Tasks** are real records — title, assignee, due date, status, optionally
linked to a project/deliverable — scoped by the active entity like everything
else. Members and above only; guests don't see the Tasks nav item.

## Layout

- `src/lib/canvas/` — camera (pan/zoom/flyTo), dot-grid renderer, world geometry
- `src/lib/store.ts` — optimistic client store over server functions (`src/lib/api.ts`)
- `src/components/ProjectCanvas.tsx` — the single canvas: workspace + review modes
- `src/components/ScopeProvider.tsx` — workspace + entity selection context (cookie-persisted)
- `src/components/AppNav.tsx` — shared top nav (workspace switcher, entity selector, Tasks/Projects/Library links)
- `src/lib/guard.ts` / `src/lib/permissions.ts` — server-side authorization wall + the isomorphic role/resource access-control matrix
- `src/lib/validate.ts` — shared valibot input schemas for every `"use server"` function
- `src/lib/library-api.ts`, `src/lib/library.ts`, `src/lib/filetypes.ts` — Library server functions, version-mirroring helpers, upload safelist
- `src/lib/task-api.ts` — Tasks server functions
- `src/routes/library.tsx`, `src/routes/tasks.tsx` — Library and Tasks pages
- `src/routes/api/` — multipart upload (canvas + library) + auth-gated file serving
- `src/db/` — Drizzle schema + bootstrap DDL + `migrate()`
