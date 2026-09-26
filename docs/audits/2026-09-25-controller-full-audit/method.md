# KerfDesk controller audit — shared brief (2026-09-25)

You are one track of a full audit of every controller integration in KerfDesk (repo
`/home/user/KerfDesk`, internal name LaserForge): a web/Electron laser + CNC app that drives
GRBL 1.1, grblHAL, FluidNC, the Creality Falcon A1 Pro vendor contract, Marlin, Smoothieware
(live serial) and Ruida (file export only). The user asked for "a full audit on all controllers"
and "back it up with verified research". Every finding you report MUST be backed by primary
evidence: the upstream firmware source (cloned locally, see below) or official docs, plus the
exact KerfDesk code path. Reproduce with a test or the repo's firmware simulators where practical.

## Ground rules

- Read `/home/user/KerfDesk/AGENTS.md` first. Never invent controller settings, G-code behaviour,
  firmware behaviour or test results. If upstream source does not settle a question, say so and
  mark the finding PLAUSIBLE, not CONFIRMED.
- Do NOT edit, delete or format any existing repository file. Do not run `git` commands that change
  state (no checkout/stash/reset/commit). The main checkout is shared with other auditors.
- Reproductions: you MAY create NEW test files only under
  `/home/user/KerfDesk/src/__audit_repro__/<your-track-id>/` (e.g. `grbl-proto-1.test.ts`) and run
  them with `cd /home/user/KerfDesk && pnpm vitest run src/__audit_repro__/<track-id>/<file>`.
  Leave them in place (the lead will decide whether they become regression tests). A repro test
  should FAIL on current code when it demonstrates a defect, and its header comment must say what
  correct behaviour is and cite the upstream source. Use relative imports like
  `../../core/controllers/grbl/response` (the file lives two levels under src).
  Reuse fixtures in `src/__fixtures__/controllers/` (GRBL/Marlin/Smoothie simulators, fake serial
  port, power models) and existing store test harnesses (`src/ui/state/*test-support*`,
  `*harness*`) — read a nearby existing test first to copy its setup.
- Dependencies are installed; `pnpm vitest run <paths>` works. Baseline: all controller tests pass.
- No hardware is available. Never claim hardware behaviour beyond what upstream source proves.
- The frame-first contract is binding (PROJECT.md non-negotiable 21; ADR-228/230/232/237/372):
  a completed clean Frame for the exact job is the sole ordinary Start policy gate; policy findings
  are Job Review warnings. Refusals are only for factual transport inability, unconstructable
  output, or handoff inconsistency. Do not recommend new Start guards or turning warnings into
  blocks; if you think a safety gap needs one, report it as a finding that "needs a product
  decision" and say why.

## Prior audits — do not re-report what is already fixed

Read these before you start (they are short):
- `docs/decisions/ADR-361-controller-audit-fixes.md` (2026-09-24 controller audit, 84 findings)
- `docs/decisions/ADR-362-controller-audit-follow-up.md` and
  `docs/decisions/ADR-362-amendment-1-controller-audit-gap-sweep.md`
- `docs/decisions/ADR-364-laser-resume-in-the-program-dialect.md`
- Skim headers of `docs/decisions/ADR-36*.md` / `ADR-37*.md` relevant to your track, and
  `docs/audits/2026-09-19-machine-compatibility-fixes/README.md` (ADR-322).
A previously fixed item may still be reported if the fix is incomplete, regressed, or introduced a
new defect — label it so ("incomplete fix of ADR-361 item 5").

## Upstream sources (cloned, read-only)

Root: `/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/upstream/`

| dir | project | revision | cite as |
|---|---|---|---|
| `grbl/` | gnea/grbl 1.1h (20190830) | bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e | https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/FILE#Lnn |
| `grbl-wiki/` | gnea/grbl wiki | b81e2de0c8392fa13a07bea40c7a2c8d90d1c3a2 | https://github.com/gnea/grbl/wiki/PAGE |
| `grblhal-core/` | grblHAL/core (2026-09-23) | d7aaee3d84b1e7010f075d395206afff038d7379 | https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/FILE#Lnn |
| `fluidnc-v4.0.3/` | bdring/FluidNC v4.0.3 | 25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f | https://github.com/bdring/FluidNC/blob/v4.0.3/FILE#Lnn |
| `fluidnc/` | bdring/FluidNC main (2026-09-23) | fdc17a2c9c0367b07345c16da3937ff0739d4702 | https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FILE#Lnn |
| `marlin-2.1.2.8/Marlin/src` | MarlinFirmware/Marlin 2.1.2.8 (latest release) | 1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d | https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/FILE#Lnn |
| `marlin/Marlin/src` | Marlin bugfix-2.1.x (2026-09-24) | 3b2b9ca6907dab36943e6850db9a89511f71a84d | https://github.com/MarlinFirmware/Marlin/blob/3b2b9ca6907dab36943e6850db9a89511f71a84d/FILE#Lnn |
| `smoothieware/` | Smoothieware edge (2026-07-19) | 38e2cc083db0e4f768535a9bf2d32cdf104ea980 | https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/FILE#Lnn |
| `meerk40t/meerk40t/ruida/` | meerk40t (Ruida reverse-engineered driver/emulator) | 7e82652f75dcab39413492e60ed5b60e5c0ad7b6 | https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/FILE#Lnn |

For official web docs (Web Serial spec, Marlin/Smoothieware/FluidNC docs sites) you may use
WebFetch (load it with ToolSearch "select:WebFetch") — quote the exact sentence you rely on.

## What to return (your final message — the lead only sees this)

1. **Findings**, most severe first. For each:
   - `id` (your track prefix + number), `title` (one line, plain words)
   - `severity`: critical (uncommanded motion/beam/spindle, crash, fire risk, a stop that does not
     stop, silent loss of position) | high (ruined job, wedged controller, wrong physical output,
     wrong machine state accepted as proof) | medium (wrong behaviour in narrower conditions or with
     an easy workaround) | low (misleading text, diagnostics, cosmetic)
   - `verdict`: CONFIRMED (reproduced, or traced end-to-end with upstream proof) | PLAUSIBLE
   - `status`: new | regression | incomplete fix of ADR-nnn
   - `failure scenario`: concrete inputs/state → wrong result
   - `kerfdesk evidence`: file:line references with the key lines quoted
   - `upstream evidence`: file:line in the upstream tree + the quoted line(s) + the citation URL
   - `reproduction`: repro test path and its result (fails on current code), or "traced only"
   - `fix`: the smallest correct fix; say "local" (small, clear, no product decision) or
     "needs decision" (and why)
2. **Checked and correct**: a short bullet list of behaviours you verified against upstream and
   found right (one line each, with the upstream citation) — the report lists coverage too.
3. **Not covered**: anything in your scope you could not get to.

Quality bar: a short list of real, verified defects beats a long list of guesses. Do not pad.
Before you report a finding, try to refute it: look for a guard elsewhere in the call chain, a
capability flag that prevents the path, or an upstream behaviour that makes it harmless.
