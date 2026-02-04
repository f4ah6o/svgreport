# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript library and CLI. `src/cli.ts` is the entry; `src/core/` contains rendering pipeline modules.
- `src/schemas/` defines job/template JSON schemas; `src/types/` defines shared types.
- `ui/` is a separate Preact + Vite app (build output in `ui/dist/`).
- `templates/`, `test-templates/`, and `examples/` contain SVG templates and sample inputs. `dist/` is build output; `out/` is runtime output.
- `scripts/` contains helper scripts (e.g., test job generation).

## Build, Test, and Development Commands
- `pnpm install` — install root dependencies (Node >= 24 required).
- `pnpm build` / `pnpm dev` — build or watch-compile CLI/library into `dist/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm lint:fix` — quality checks.
- `pnpm test` — run Node’s test runner against `dist/**/*.test.js` (build first).
- UI: `cd ui && pnpm dev|build` — Vite dev server or production build.
- `just ...` — optional task runner wrappers (see `justfile`).

## UI & Demo Workflow
- `just run-simple` / `just run-multi` — build, create sample job zips, render to `out/`.
- `just demo template=...` — build API + UI, start integrated server at `http://127.0.0.1:8788/`.
- `just server-with-ui url=... port=... root=...` — serve API with a remote UI (useful with Vite dev server).

## Coding Style & Naming Conventions
- Use ES module imports with explicit `.js` extensions (compiled output is ESM).
- Indentation is 2 spaces; follow existing file layout and comment style.
- Naming: `PascalCase` for types/classes, `camelCase` for functions/variables, `kebab-case` for filenames in `src/core/`.

## Testing Guidelines
- Tests run via `node --test` on built files. Add `*.test.ts` near the code they cover; ensure `pnpm build` emits `dist/**/*.test.js`.
- Keep tests deterministic; for template/output changes, include minimal samples in `test-templates/` or `examples/`.

## Commit & Pull Request Guidelines
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `build:`, `test:`).
- PRs should include a short summary, test commands run, and links to related issues. For UI/template changes, add screenshots or a sample output path (e.g., `out/<job_id>/index.html`).

## Configuration Notes
- Tooling expects `pnpm@10.x` (see `packageManager`) and Node >= 24. Rebuild `dist/` before publishing.
