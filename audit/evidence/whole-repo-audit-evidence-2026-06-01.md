# Whole-Repository Audit Evidence - 2026-06-01

Repository: `C:\Users\Asus\LaserForge-2.0`

Branch: `codex/main-working`

Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`

HEAD: `d66ce7f docs: record image-flow, raster-preview, convert-to-bitmap decisions`

Worktree state: dirty, 100 `git status --short` lines at audit start. The audit covers the current dirty worktree, not a clean `main` snapshot.

## Local Audit Rules Loaded

- `CLAUDE.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`
- `README.md`
- `AUDIT.md`
- Existing reports under `audit/reports/`

The old audit paths `docs/AUDIT.md` and `.cursor/rules/laserforge.md` were checked in this checkout and were not present.

## External Sources

Recorded in `audit/external/online-audit-prompt-sources-2026-06-01.md`.

## Command Results

| Command | Result | Notes |
|---|---:|---|
| `npm.cmd test` | PASS | 99 test files, 784 tests passed. |
| `npm.cmd run build` | PASS | Web build passed; Vite warned that `src/core/scene/index.ts` and `src/ui/trace/image-loader.ts` are both dynamic and static imports, so those dynamic imports do not split as intended. |
| `npm.cmd run build:electron-main` | PASS after approval | Initial sandbox run could not write `dist-electron`; rerun with write approval passed. |
| `npm.cmd run lint` | FAIL | 27 ESLint errors: complexity, max-lines/function, non-null assertions, one overlong UI helper. |
| `npm.cmd run format:check` | FAIL | Prettier reported style drift in 207 files. |
| `npm.cmd run license-check` | PASS | Production licenses allowed: MIT 4, MPL-2.0 OR Apache-2.0 1, Unlicense 1. |
| `npm.cmd audit --omit=dev` | N/A | Not usable because this repo has pnpm lockfile, not npm lockfile. |
| `npm.cmd audit` | N/A | Same lockfile mismatch. |
| `corepack pnpm audit --prod` | PASS after network approval | No known vulnerabilities found. |
| `corepack pnpm audit` | PASS after network approval | No known vulnerabilities found. |
| `npm.cmd exec -- eslint electron/main.ts --no-ignore` | FAIL | Parser project excludes `electron/main.ts`, confirming the current root lint config cannot lint Electron main code. |

## Static Scan Notes

- No hardcoded secrets found. Hits were documentation references to Cloudflare secret names and lockfile package names containing `token`.
- `dangerouslySetInnerHTML` appears only in `src/ui/trace/TracePreview.tsx`; inspected as a generated trace SVG preview surface, not arbitrary external HTML.
- Network-like calls are limited to data URL decode, bundled font fetch, Electron custom protocol `net.fetch(file://...)`, tests, and documentation. No app telemetry path was found.
- `electron/main.ts` auto-picks the first serial port in the `select-serial-port` handler.
- `src/ui/state/laser-store.ts` central `safeWrite` swallows serial write failures and resolves successfully.
- Start-job preparation checks project preflight and controller settings, but not the live GRBL status state.
