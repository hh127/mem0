# Console (`server/console`)

Independent web console for self-hosted Mem0. It replaces the bundled
`server/dashboard` UI and talks to the same FastAPI server. Deliberately **not**
a fork of the dashboard: different stack, different layout, its own deploy path.

## Commands

```bash
pnpm install
pnpm mock          # in-memory API on :9200 (seeded data, no Docker required)
pnpm dev           # Vite on :3001, proxies /api → :9200 (or VITE_DEV_API_TARGET)
pnpm typecheck
pnpm build
pnpm test
```

For a real server, point the dev proxy at it:

```bash
VITE_DEV_API_TARGET=http://127.0.0.1:6688 pnpm dev
```

## Conventions

- React 19 + TypeScript strict; function components only, no classes.
- Styling: Tailwind CSS v4 utilities over the semantic tokens in `src/styles.css`
  (`bg-paper`, `bg-panel`, `text-ink`, `text-ink-soft`, `border-line`,
  `bg-accent-soft`, `text-accent`, …). Do not hard-code hex colours in components.
- UI primitives live in `src/ui/` (`primitives.tsx`, `modal.tsx`, `table.tsx`,
  `toast.tsx`, `feedback.tsx`). Reuse them; do not add a second design system.
- Network: only through `src/lib/api.ts` (`api.get/post/put/patch/delete`).
  Never call `fetch` directly except in session/login flows.
- Session: `useSession()` exposes `user`, `isAdmin`, `login`, `register`,
  `logout`, `refreshUser`, `completeOnboarding`.
- Data fetching: TanStack Query (`useQuery`/`useMutation`), query keys scoped by
  feature. No global stores.
- Routes are declared in `src/app.tsx`; admin-only routes are wrapped with
  `AdminOnly`. A page may only edit its own feature directory.
- All user-facing copy is Simplified Chinese. Dates: `formatDateTime` etc. from
  `src/lib/utils.ts`.
- Every feature must typecheck (`pnpm typecheck`) and build (`pnpm build`) before
  hand-off. Prefer small, focused files over one giant page.

## Mock API

`mock/server.mjs` mirrors the real endpoints plus auth codes; it is the fastest
way to develop without Docker. Seeded accounts:

| Account | Password | Role | Scope |
|---|---|---|---|
| admin@example.com | admin12345678 | admin | all memories |
| user@example.com | user12345678 | user | `hermes-user-2` |

`MOCK_EMPTY=1 pnpm mock` starts with no users (setup wizard).

The shape of every payload follows `server/main.py` / `server/routers/*.py`; when
in doubt read those files.
