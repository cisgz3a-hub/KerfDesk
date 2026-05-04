# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first — the workflow contract

**`.cursor/rules/laserforge.md` is the binding workflow contract** for this repo and applies to Claude Code as much as to Cursor. Read it before proposing any change. The non-negotiables it encodes:

- **`docs/ROADMAP.md`** is the authoritative ticket list (323 tickets, Tier 0–4). **`docs/ROADMAP-shipped-audit.md`** is the verified ledger of what has shipped, with hashes. Both are source of truth — don't propose work that isn't on them without explicit approval.
- **Strict tier order, lower number first.** No skipping. Partial tickets must be finished before adjacent ones are started.
- **Every shipped fix is a coupled triple** in one commit: code change + test, `ROADMAP.md` ticket marked `**Status:** Shipped in <hash>`, and `ROADMAP-shipped-audit.md` row moved to Shipped. A patch missing any of the three is incomplete.
- **One ticket per commit.** ~5-file upper bound when in doubt. No batched fixes across tickets.
- **Verify before claiming shipped** — grep/read the actual repo state. Past sessions repeatedly claimed work shipped that wasn't.
- **Off-roadmap requests get a stop-and-ask**, not silent compliance — offer (a) do the next roadmap item instead, (b) add as a ticket first, or (c) ship as one-off. Get an explicit answer.

## Common commands

```bash
npm test                       # full suite via scripts/run-tests.mjs (each test in its own Node process)
npx tsx tests/<file>.test.ts   # run a single test file
npx tsc --noEmit               # type-check
npm run build                  # vite build + scripts/verify-production-build.mjs
npm run dev                    # vite dev server (web)
npm run electron:dev           # vite + electron together (compiles electron/ first)
npm run electron:build         # full Windows installer (vite build → tsc electron → icons → electron-builder --win)
npm run electron:build:mac     # macOS dmg
npm run license-check          # validate dependency licenses against scripts/license-allowlist.mjs
```

The test runner deliberately spawns a **separate Node process per test file** to prevent leaked timers (e.g. GRBL status polling) from keeping `npm test` running. New test files must be appended to the `files` array in `scripts/run-tests.mjs` to be picked up by `npm test`. Tests use `tsx` directly — there is no vitest/jest. `LASERFORGE_DETERMINISTIC_IDS=1` is set for the suite.

## Architecture

Pipeline: `Scene → Job → Plan → Output → Device`

- **Scene** (`src/core/scene/`) — design document: flat object list with parent refs, layers (which ARE processing rules carrying laser settings, not just visual grouping).
- **Job** (`src/core/job/`) — machine-agnostic compiled intent. `compileJob(scene)` flattens transforms, resolves layer settings, converts geometry to `FlatPath`s.
- **Plan** (`src/core/plan/`) — ordered atomic `Move` discriminated union (`rapid` | `linear` | `laserOn` | `laserOff` | `dwell` | `airAssist` | `z`). Laser state is **explicit** via on/off moves, never embedded in linear moves. `optimizePlan(job)` dispatches by op type (vector / fill / raster), uses inside-first containment ordering + nearest-neighbor.
- **Output** (`src/core/output/`) — `OutputStrategy` plugin pattern. `GrblStrategy` self-registers on import.
- **Device** (`src/controllers/grbl/GrblController.ts`, `src/communication/`) — GRBL 1.1 state machine, character-counting buffer (127 bytes), `MockSerialPort` for tests.

**Module boundary rule** — dependencies flow DOWN the pipeline only:
- `scene/` cannot import `job/`, `plan/`, `output/`
- `job/` cannot import `plan/`, `output/`
- `plan/` cannot import `scene/`, `output/`
- `output/` cannot import `scene/`

Higher layers: `src/app/` (`MachineService`, `ExecutionCoordinator`, `PipelineService`, `autosavePersistence`) wires services together. `src/ui/` is React + Canvas2D. `electron/` is the desktop shell (`main.ts`, `preload.ts`, `serial.ts`, `storage.ts`, `falcon-wifi/` bridge for Falcon A1 Pro WiFi). `src/io/` handles `.laserforge.json` (versioned envelope) save/load, SVG import/export. `src/core/storage/` provides a pluggable adapter (Filesystem / IndexedDb / InMemory) used by autosave, job log, replay, materials, device profiles, and entitlements.

## Safety paths — heightened bar

When changes touch `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, `src/controllers/grbl/GrblController.ts`, `src/communication/`, `src/core/preflight/`, or any g-code emission:

- Tests must cover the failure mode, not just the happy path.
- Hardware-touching changes get a **"Hardware verification needed"** note in the commit message and audit doc until confirmed on the user's Falcon A1 Pro.
- Never silently change the contract of a safety method (`safetyOff()`, pause/resume, M5 emission, deadman). All callers must be reviewed.

The hardware can drive itself into limit switches, leave the laser firing during pause, or skip preflight — the cost of being wrong here is a real burn or mechanical damage.

## Commit message format

```
<type>(<scope>): <ticket id> — <one-line summary>

<why this fix exists; the user-visible problem it closes>

<the technical change, file by file>

Roadmap:
- docs/ROADMAP.md: T<N>-<M> Status updated to Shipped in <hash>
- docs/ROADMAP-shipped-audit.md: T<N>-<M> moved to Shipped section

Verification:
- TS error count: <N> (unchanged baseline)
- npm run build: passes
- <test file>: <count>/<count> passing
- Lint on touched files: 0 errors, 0 warnings
```

`<type>`: `feat` | `fix` | `refactor` | `test` | `docs` | `chore`. `<scope>`: area touched (e.g. `connection`, `box-generator`, `safety`, `controller`).

Use `<TBD>` as the hash placeholder while editing; substitute the real hash after `git commit` returns it. Per-file (or per-ticket) commits — recoverability matters in a solo-dev repo with no review.

## Style

- TypeScript strict mode. No `any` without an inline justification.
- React function components + hooks only in new code. ESLint enforces `react-hooks/rules-of-hooks` (error) and `exhaustive-deps` (warn).
- Top-of-file comments explain *why* the file exists in this codebase, not *what* it does syntactically.
- TODO comments include the ticket: `// TODO(T2-12): consolidate into MachineSafetyState union`.
- Unitless SVG dimensions are treated as **mm** (laser convention, not the SVG spec's px default).
- Selection state is UI-only — stripped from history snapshots and saved files.

## Hard rules that cost real time when violated

**TS baseline: 43 errors.** Every commit must verify `npx tsc --noEmit 2>&1 | Select-String "error TS" | Measure-Object -Line` returns 43. Above 43 = regression introduced by your change; fix before commit. Below 43 = note in commit message (someone fixed something incidentally; don't accept silently — confirm it's intentional).

**Verify external claims against actual code before patching.** When ChatGPT, Cursor, an audit doc, or a previous session asserts a line number, symbol name, or behavior, grep/read the live tree first. The single most expensive defect of the prior session arc was T1-97 — a fix shipped against ChatGPT's diagnosis of `commitSceneTransaction` that was wrong on the line it claimed; the real bug was a 15s hardcoded frame timeout (T1-98). Three rules from that incident:

- Read 30+ lines of surrounding context before forming a hypothesis.
- Grep for both definitions AND callsites; missing the callsite is how T1-97 retired with a leftover reference (cdeb9b0).
- Never ship a fix for a bug not yet diagnosed. "Probably this" is not a diagnosis.

**PowerShell + multi-line commit messages.** The user's environment is Windows PowerShell 5.x. Multi-line commit messages via `git commit -m "..."` will get mangled by the shell's quoting rules. Use the `-F` file pattern instead:

Do not use `Out-File -Encoding utf8` on PowerShell 5.x — it writes a BOM that ends up as `\uFEFF` in the commit subject. Use `[IO.File]::WriteAllText` for raw-bytes UTF-8.

```powershell
$msg = @'
fix(scope): T<N>-<M> — summary

body line 1
body line 2
'@
[IO.File]::WriteAllText("$PWD\commit-msg-temp.txt", $msg)
git commit -F commit-msg-temp.txt
Remove-Item commit-msg-temp.txt
```

Don't fight the shell — switch to file mode the moment a commit message has more than one line.

## When you're unsure

Stop and ask. The cost of one extra question is much lower than the cost of writing the wrong code or off-roadmap work.
