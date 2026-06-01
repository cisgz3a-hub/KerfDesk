# Whole-Repository Audit Prompt - LaserForge 2.0 - 2026-06-01

You are auditing LaserForge 2.0, a local-first GRBL laser cutter/engraver CAM app. This audit is report-only unless the maintainer explicitly asks for implementation.

## Mandatory Local Context

Read these first:

- `CLAUDE.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`
- `README.md`
- `AUDIT.md`
- Prior reports under `audit/reports/`

If an old instruction references `docs/AUDIT.md` or `.cursor/rules/laserforge.md`, verify whether those paths exist in this checkout. Do not invent replacement content.

## Audit Objective

Find concrete, reproducible risks in the current worktree. Do not summarize the app. Do not praise the architecture. Every finding must include:

- finding id
- severity
- category
- file path and line number
- component/function/module
- trigger path
- failure mode
- consequence
- confidence
- concrete fix
- evidence command or manual inspection note

Reject vague best-practice advice and duplicate findings. If a suspicious pattern is acceptable after inspection, put it in the false-positive rejection section.

## LaserForge-Specific Review Areas

Heighten scrutiny for:

- scene/job/plan/output/device boundaries
- GRBL and G-code correctness
- raster/vector planning and emitted output
- bounds checking and work-origin transforms
- Stop, Pause, Resume, emergency stop, Test Fire, Set Origin, framing, homing, and autofocus behavior
- serial/WebSerial/device permission flows
- Electron main process, protocol, CSP, permission, and build coverage
- project import/export, SVG/image parsing, autosave and recovery
- preview versus emitted output consistency
- dependency/license policy and vulnerability posture

## Evidence Commands

Run and record:

- `git status --short`
- `git branch --show-current`
- `git log -1 --oneline`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run build:electron-main`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `npm.cmd run license-check`
- `corepack pnpm audit --prod`
- `corepack pnpm audit`
- static scans for secrets, eval/innerHTML, network APIs, serial/write handling, TODO/FIXME, and CI build coverage

If a command cannot be run because of sandbox/network restrictions, say exactly that and rerun with approval when required.

## Output Artifacts

Write:

- human report under `audit/reports/`
- machine-readable findings under `audit/findings/`
- command evidence summary under `audit/evidence/`
- external source summary under `audit/external/`

Do not modify `src/`, `electron/`, tests, generated build output, or production docs during the audit pass.
