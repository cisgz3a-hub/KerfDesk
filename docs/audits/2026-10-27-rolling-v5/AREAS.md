# Rolling audit v5 — area map

This is the third full-app round the user asked for on 2026-10-27 ("next loop"), after v3 (change audit) and v4 (workflow audit). Finding IDs are `J<area>-P<n>-<k>`.

v5 has two halves:

- **Fix verification (J1, J3, J5, J7, J9).** Rolling v3 and v4 produced about 30 fix PRs in two days (#1459–#1473 and the H7/H10 fixes). They were written fast, merged on CI alone, and several touch the same code. The meta audit showed this is where gaps hide: a fix guards the reported path and misses its sibling.
- **Lenses not yet run app-wide (J2, J4, J6, J8, J10):**
  - failure paths;
  - trust boundaries;
  - adversarial file input;
  - catalogue ground truth;
  - scale.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full, including §3's clarifications from 2026-10-23 (P1 has no reach clause) and 2026-10-27 (Frame is not a warning). It also uses lenses L8 and L9 from [the v3/v4 area map](../2026-10-27-rolling-v3/AREAS.md). Each area gets an auditor and then a fresh refuter, and the coordinator re-verifies every P1/P2 in code.

New lens:

- **L10 Fix verification.** For each fix PR in the area:
  1. Re-run the original finding's repro on current main, and confirm it is fixed.
  2. Check every sibling path of the finding, as listed in its report.
  3. Look for a regression the fix introduced elsewhere.
  4. Check that its ADR amendment describes what the code does.
  5. Check test truth: does its regression test fail on the pre-fix commit?

Security rule: a remotely reachable hole is marked "SECURITY — hold details until fixed". The coordinator redacts it from the committed report until the fix merges (as for v4 H8).

## Areas (order = run order)

| # | Area id | Scope | Risk | Lenses |
|---|---|---|---|---|
| J1 | `fix-recovery` | #1462 (CNC recovery against the open project, ADR-416 Amd 3), #1468 (restart registration and planner backlog, ADR-443 Amd 2, ADR-398 Amd 5), #1472 (pass-recovery bit check, package warnings, per-bit Work Z) | S | L10, L9, L4 |
| J2 | `failure-paths` | Every error during a job or save: USB unplug, write error, worker crash, renderer crash, out of memory, disk full on save or autosave, GPU context loss, sleep and resume, licence or relay outage. Is the beam/spindle off? Is the port released? Is the user told the truth, and is their work kept? | S+D | L6, L4 |
| J3 | `fix-remote` | #1460 (board capture gate), #1465 (remote DXF worker and budget), #1470 (remote import notices, bit change, hold-to-jog); every remote/MCP action re-diffed against the desktop after these | S+X | L10, L9, L5 |
| J4 | `trust-boundaries` | Electron IPC and preload surface, deep links and file associations, navigation and `window.open`, CSP, auto-update integrity, MCP auth and scopes, relay pairing, AI provider calls (no production contact) | X | L5, L1 |
| J5 | `fix-camera` | #1463 (bed-frame siblings), #1467 (auto-start placement, stitch heights, head Z), #1473 (camera target uses the Start snapshot), plus #1437 and #1441 | C+S | L10, L9 |
| J6 | `parsers-adversarial` | Every file reader: SVG, DXF, PDF, HPGL, LightBurn `.lbrn`/`.lbrn2`/`.clb`, STL, images (huge, CMYK, 16-bit, EXIF), `.lf2` projects, material library, machine profile. Look for crash, hang, out-of-memory, wrong scale or units, and silent drops. Keep inputs bounded | X+C | L4, L5, L2 |
| J7 | `fix-machine-state` | #1461 (Console unit switches), #1454 (Console comments), #1466 (machine Open, Keep and import), #1469 (Place Board Undo), #1457 (CNC anchor and park Z top), #1446 (grblHAL under a GRBL profile) | S | L10, L9 |
| J8 | `catalogue-ground-truth` | Machine catalogue presets (Falcon, Neotronics, Ortur, xTool and others): bed size, power and `$30`, homing corner, firmware kind and command set. Also material, tool and feed libraries and default powers and speeds, all against pinned vendor sources. Rule: never invent machining data | S | L2, L1 |
| J9 | `fix-output` | #1459 (stacked copy walls), #1464 (tone power, paste and preview), #1471 (image side paths), the H7 and H10 fixes when merged, #1453 (one setup-package file per bit) | S+C | L10, L3 |
| J10 | `scale-performance` | Large projects and jobs: memory, freezes, worker use, long G-code streaming, Undo history growth. Does Abort stay responsive under load, and do watchdogs fire? Keep inputs bounded; this PC is low on memory | S+C | L4, L6 |

## Batching

- Two subagents at a time.
- A refuter goes before the next auditor.
- No new audit subagent while more than about six fix sessions are active.
- Fix-verification areas should audit the newest `origin/main` (record the SHA), because their fixes keep landing.
