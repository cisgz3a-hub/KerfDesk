# AGENTS.md

This file provides Codex audit guidance for the LaserForge repository. It is scoped to audit work unless a later user request explicitly asks for implementation.

## Read First

Before doing audit work, read these repo-local instructions:

- `.cursor/rules/laserforge.md`
- `CLAUDE.md`
- `docs/AUDIT.md`
- `docs/AGENT_HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/ROADMAP-shipped-audit.md`

These project rules override generic audit habits. LaserForge controls real laser hardware, so safety-path claims require concrete evidence.

## Audit Workspace

Use the audit workspace under `audit/`:

- `audit/external/` for cloned or downloaded external prompt/framework sources.
- `audit/prompts/` for Codex-specific audit prompts.
- `audit/reports/` for human-readable reports.
- `audit/findings/` for machine-readable finding lists.
- `audit/evidence/` for captured command output, screenshots, logs, or proof snippets.
- `audit/scripts/` for audit-only helper scripts.

Do not put production code, tests, or generated build output in `audit/`.

## Audit Working Rules

- Never invent findings.
- Every finding needs file path, function/component/module, trigger path, failure mode, consequence, severity, confidence, and concrete fix.
- Reject vague best-practice advice.
- Reject duplicate findings.
- Do not change production code during audit phases.
- Do not score the repo until after false-positive rejection.
- When using external audit prompts, clone or read them into `audit/external/` first and summarize what was used.
- Do not run unknown install scripts from the internet unless inspected first.
- Prefer copying markdown prompts and adapting them instead of installing tools blindly.
- Do not treat Claude slash commands or other tool-specific workflows as available in Codex unless Codex has an equivalent local capability.
- Do not claim a finding is release-blocking without evidence and a realistic trigger path.
- Do not use rejected findings in scoring or fix planning.

## LaserForge-Specific Audit Rules

Heighten scrutiny for:

- Scene/job/plan/output/device boundaries.
- GRBL and G-code correctness.
- Raster/vector planning and emitted output.
- Bounds checking and work-origin transforms.
- Stop, pause, resume, emergency stop, test fire, and safety-off behavior.
- Serial/Web Serial/device permission flows.
- Falcon WiFi bridge and network trust boundaries.
- Electron preload/main process boundaries.
- Project import/export, SVG/image parsing, autosave, recovery state, job logs, and entitlement/license state.
- Preview versus emitted output consistency.

During audit phases, write findings and reports only. Do not patch `src/`, `electron/`, `tests/`, or production docs unless the current workflow step explicitly requests fixes.

