# KerfDesk controller audit (2026-09-25) — working record

This folder is the durable record of the full controller audit started on 2026-09-25. It is
kept on branch `claude/focused-tesla-kb5if0` so the work survives the session that produced
it. If the session stops before the audit is finished, a new session can continue from here.

- **Asked for:** a full audit of every controller integration, backed by verified research;
  a check of which controllers real CNC machines use; then build all fixes, open a PR and merge
  it into main.
- **Checked:** main at 39d7f96 (25 Sep 2026). Baseline `pnpm test`: 2,577 files and 18,661
  tests passed (22 tests skipped, 14 files).
- **Hardware:** none. Evidence is code traces, the repository's firmware simulators, and the
  upstream firmware source listed below.

## Files here

| file | what it holds |
|---|---|
| `method.md` | The brief every audit track worked to: rules, evidence bar, return format |
| `tracks/<ID>.md` | Each track's raw findings, saved as soon as the track reports |
| `README.md` | This status page: tracks, upstream revisions, what is left |

Reproduction tests written by the tracks are in `src/__audit_repro__/<ID>/`. A test that
demonstrates a defect fails on the audited code. They are scratch evidence: each is either
moved beside the code it covers as a regression test, or deleted, before the PR.

## Tracks

| ID | scope | status |
|---|---|---|
| GP | GRBL 1.1 protocol: replies, status reports, errors/alarms, `$` commands, settings, probe, `$#` | running |
| ST | GRBL-family streaming: character counting, acks, errors/alarms mid-job, hold/resume, M0, settle | running |
| HF | grblHAL, FluidNC and the Creality Falcon A1 Pro command set | running |
| MA | Marlin: replies, M114, laser power (M3 I / fan), jog/frame, stream-side pause and stop | running |
| SM | Smoothieware: replies, halt/M999, `$H`, `fire off`, M120/M121, M221 power, status grammar | running |
| RU | Ruida `.rd` export and UDP session, checked against meerk40t | reported: 8 findings (`tracks/RU.md`) |
| TC | Serial transport (web, worker, desktop) and the connect/qualify/disconnect lifecycle | running |
| CG | Every machine control against every controller's capabilities (the gating matrix) | running |
| OR | G-code output dialects, machine profiles, resume/recovery across controllers | running |
| CN | Research: which controllers real CNC machines use, and what KerfDesk supports | running |

## Upstream sources used as evidence

Cloned read-only at these revisions; findings cite file and line at the same revision.

| project | revision |
|---|---|
| gnea/grbl 1.1h | bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e |
| gnea/grbl wiki | b81e2de0c8392fa13a07bea40c7a2c8d90d1c3a2 |
| grblHAL/core | d7aaee3d84b1e7010f075d395206afff038d7379 |
| bdring/FluidNC v4.0.3 | 25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f |
| bdring/FluidNC main | fdc17a2c9c0367b07345c16da3937ff0739d4702 |
| MarlinFirmware/Marlin 2.1.2.8 | 1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d |
| MarlinFirmware/Marlin bugfix-2.1.x | 3b2b9ca6907dab36943e6850db9a89511f71a84d |
| Smoothieware edge | 38e2cc083db0e4f768535a9bf2d32cdf104ea980 |
| meerk40t (Ruida reference) | 7e82652f75dcab39413492e60ed5b60e5c0ad7b6 |

To recreate them: `git clone https://github.com/<project>.git` and check out the revision.

## Lead verification so far

- **RU (Ruida):** RU-1 to RU-5 checked against meerk40t's writer (`rdjob.py` `write_header`
  L1401-1504, `write_settings` L1517-1548, `write_layer_end` L1511-1515, `write_tail`, `mark`
  L1577-1580) and hold. RU-6 (menu Connect opens a port for the file-only profile:
  `ui/commands/laser-command-family.ts`, `ui/state/laser-connect-action.ts`) and RU-7 (`.rd`
  export runs no post-compile checks: `io/rd/emit-rd.ts`) hold in code. RU-8 is latent (no
  caller). RU-2's User Origin mapping (`D8 11`) is unverified upstream: map the reference mode
  per placement (Absolute `D8 10`, User Origin `D8 11`, Current Position `D8 12`) and say so in
  the ADR.

## If this session stops: continuing in a new session

Each running track keeps `tracks/<ID>-partial.md` up to date with the findings it has so far
and a "still to check" list; the lead commits and pushes those files with the reproduction
tests in `src/__audit_repro__/<ID>/`. A finished track's report is `tracks/<ID>.md`.

For a track that never finished: start from its `-partial.md` and its reproduction tests, re-run
only its "still to check" items with `method.md` as the brief, then verify everything as for the
finished tracks. Clone the upstream sources at the revisions above into a scratch folder first
and point the brief's source root there.

## Remaining steps

1. Save each track's findings to `tracks/<ID>.md` as it reports.
2. Verify every finding independently against the code and upstream source; drop what does not
   hold up.
3. Fix every confirmed finding with a regression test. Record product choices in a new ADR
   under `docs/decisions/` (`node scripts/check-adr-numbers.mjs` gives the next number). Keep
   the frame-first Start contract (PROJECT.md non-negotiable 21) intact.
4. Write the final report `docs/audits/2026-09-25-controller-full-audit.md` in the format of
   `docs/audits/2026-09-24-cnc-full-audit.md`.
5. Run `pnpm release:check`, open the PR, get CI green, and merge into main (the maintainer
   asked for the merge).
