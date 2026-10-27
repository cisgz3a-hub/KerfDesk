# Rolling audits v3 and v4 — area map

The user asked on 2026-10-27 for "2 more loop rounds on full app". There are two rounds, each covering the whole app from a different angle:

- **v3 (change audit):** the code that merged after rolling v2. Between 2026-10-21 and 2026-10-27, 134 PRs merged into `main`, adding 92.8k lines across 1,664 files. Areas are subsystems. Finding IDs are `G<area>-P<n>-<k>`.
- **v4 (workflow audit):** whole user journeys, start to finish, across every way of doing the same thing. Areas are journeys. Finding IDs are `H<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full, including the 2026-10-23 clarifications: §3 (P1 has no reach clause) and §4 (pinned citations; ADR quotes only from `docs/decisions`). Each area runs as an **auditor** and then a fresh **refuter** (METHOD §9a). The coordinator re-verifies every P1 and P2 in code before the ledger counts it.

Two lenses are added, both drawn from what meta audit v1 found:

- **L8 Change risk (v3).** For each PR merged in the area since 2026-10-21, check:
  - **Siblings:** does the fix hold on every sibling entry point, or only the one it patched? Meta audit v1 found Undo, `G43 H`, grblHAL under a GRBL profile and old camera calibrations each slipped past a fix.
  - **Conflicts:** were merge conflicts resolved keeping both sides? This week's emitter-version and lead-scope conflicts are examples.
  - **Untested merges:** #1442 and #1444 merged without CI, and new features shipped with an e2e that never ran. Check whether their tests still hold.
  - **Claims:** does the code still match the ADR the PR cites?
- **L9 Entry-point parity (v4).** List every way a user can reach the same result, then diff the guards, the checks and the output:
  - the toolbar, the menu, shortcuts and right-click;
  - Start, Run G-code file, and export-then-run;
  - the desktop app, the phone remote and MCP;
  - Free and Pro;
  - a fresh project and a reopened one.

  A guard or check that one path has and another lacks is a finding.

Severity, evidence and the report template follow METHOD §3, §4 and §8, with the report title "Rolling audit v3" or "Rolling audit v4". Reports go in this folder as `G<NN>-<area-id>.md` or `H<NN>-<area-id>.md`.

## v3 — change audit (order = run order)

List an area's merges with `git log --first-parent --since=2026-10-21T00:00 origin/main -- <paths>`.

| # | Area id | Paths | Risk | Since 2026-10-21 (non-test files) | Lenses |
|---|---|---|---|---|---|
| G1 | `job-output` | `src/core/job`, `src/core/output`, `src/io/gcode`, `src/core/raster`, `src/core/external-program`, `src/core/laser-second-pass` | S | 55 job + 9 output + 6 gcode + 11 raster + 10 external-program. Leads, power scale, air, Marlin raster end, the laser-output v2 P2s (#1440), tone calibration (#1442) and lossless tones (#1443) | L8, L3, L1, L4, L7 |
| G2 | `job-state` | `src/ui/state/**` | S | 131. Store guard, job machine lock, link-loss restart, recovery, jog cancel, owned reset, quiet reconnect, phone stop | L8, L6, L4, L3 |
| G3 | `laser-ui` | `src/ui/laser/**`, `src/ui/layers/**` | S+C | 147 + 45. Edit glow, Cut Settings apply, hover power and speed, start review redesign, safety toast, Material Test card | L8, L3, L4, L7 |
| G4 | `controllers-preflight` | `src/core/controllers`, `src/core/devices`, `src/core/preflight`, `src/core/recovery`, `src/core/gcode-view`, `src/ui/gcode-inspector`, `src/ui/machine` | S | 17 + 10 + 15 + 6 + 12 + 17 + 4. The controller v2–v4 fixes (#1376–#1413, #1446) | L8, L2, L3, L6 |
| G5 | `cnc-delta` | `src/core/cnc`, `src/core/relief`, `src/core/geometry`, `src/core/min-feature`, `src/io/cnc` | S | 45 + 13 + 13 + 4. The CNC v1 and meta fixes (#1416–#1423, #1444, #1450–#1452). Focus on how the fixes interact and on conflict resolutions, not on re-running CNC v1 | L8, L3, L7 |
| G6 | `camera-calibration` | `src/ui/camera`, `src/core/camera`, `src/ui/calibration`, `electron/camera-*` | C+S | 50 + 17 + 11. The camera redesign (ADR-663), calibration that survives Open (#1437), bridge identity (#1441), tone calibration UI | L8, L4, L3, L2 |
| G7 | `app-shell-remote` | `src/ui/app`, `src/ui/common`, `src/ui/help`, `src/ui/licensing`, `src/ui/recent-projects`, `src/ui/remote-control`, `services/remote-control`, `electron/mcp`, `electron/**` (changed files) | X | 39 + 11 + 4 + 10 + 7 + 17 + 9 + 10. The licence nonce revert, remote guards, app shell fixes, MCP | L8, L5, L6 |
| G8 | `release-ci-website` | `.github/**`, `scripts/**`, `website/**`, `electron-builder*.yml` | R+X | Lighter PR CI, secret environments, AppImage GPL, desktop releases 1.0.21–1.0.23, website Pro list. Also: this week CI could be bypassed (ruleset not enforced, merges without checks) | L8, L5, L1 |
| G9 | `canvas-scene` | `src/ui/workspace`, `src/ui/commands`, `src/core/scene`, `src/core/text`, `src/ui/text` | C | 39 + 21 + 16 + 8 + 7. Jig editor, hover pulse, Place Board, text Max width | L8, L4, L3 |
| G10 | `image-raster-trace` | `src/ui/image-editor`, `src/core/image-*`, `src/ui/raster`, `src/core/trace`, `src/ui/trace` | C | 13 + 7 + 8 + 6. Image Studio fixes, trace freeze, trace windows, blue-noise dither, tone curves | L8, L4, L7 |

## v4 — workflow audit (order = run order)

| # | Area id | Journey, end to end | Risk | Entry points to diff (L9) |
|---|---|---|---|---|
| H1 | `laser-burn-journey` | Design or import → layers and cut settings → preview → Frame → Job Review → Start → stream → pause, abort or finish | S | Start; Run G-code file; Save G-code then run; phone Start; MCP; Material Test; Repeat or array jobs |
| H2 | `recovery-journey` | Link loss, alarm, door, e-stop, app crash or power loss mid-job → reconnect → restart from line or step back, across laser and CNC and every firmware family | S | Banner offer; Start from line; recovery card; phone; reopened project |
| H3 | `cnc-journey` | CNC import → operations (profile, pocket, V-carve, relief, inlay) → bit change → in-app run or setup package export → touch-off → resume | S | In-app Start; setup package (single file and per bit); tile files; external sender |
| H4 | `machine-setup-connect` | First run → machine setup picker → connect (Web Serial, Electron serial, network) → settings read → Home or unlock → jog | S+X | Setup wizard; Machine panel; Console `$` writes; profile import; phone |
| H5 | `image-burn-journey` | Photo or bitmap → Image Studio → trace or raster (dither, tone calibration) → Material Test → burn | C+S | Trace dialog; jig trace; raster layer; tone calibration; AI tools |
| H6 | `camera-placement` | Calibrate → overlay → place artwork (jig, Place Board, camera capture) → burn lands where shown | C+S | Each calibration path; old calibrations; project reopen; bridge cameras |
| H7 | `project-lifecycle` | New → edit → save, autosave, crash recovery, reopen, migrate across versions, import LightBurn or `.clb`, recent projects, material library | D | Save, Save As, autosave, crash Save, export; browser and desktop |
| H8 | `remote-automation` | Every action the phone remote, MCP and AI tools can take, against the same action on the desktop | X+S | Phone; MCP; desktop; second window |
| H9 | `undo-guards` | Every way to change the project or the machine while a job runs or after it: Undo and Redo, Open, paste, drag, settings, profile switch | S+D | Every store write path against `commitProjectEdit`, the job machine lock and Undo |
| H10 | `distribution` | Download → install → licence (Free and Pro) → update → website claims; the release pipeline and CI gates that protect `main` | R+X | Windows, macOS and Linux; web; Free and Pro; update channels |

## v4 run order after v3 (re-ranked 2026-10-27)

v3's P1s clustered on entry points that skip a guard their sibling has:
- recovery against the open project (G2);
- Console unit switches (G4);
- stacked copies in the lead model (G5);
- camera frames stamped at the wrong moment (G6);
- MCP board capture (G7).

So v4 runs the journeys with the most entry points and the most v3 hits first:

1. H2 `recovery-journey`
2. H8 `remote-automation`
3. H1 `laser-burn-journey`
4. H4 `machine-setup-connect`
5. H6 `camera-placement`
6. H3 `cnc-journey`
7. H9 `undo-guards`
8. H5 `image-burn-journey`
9. H7 `project-lifecycle`
10. H10 `distribution`. G8 found the release gates sound, so this runs last.

## Batching

- Two subagents run at a time.
- When an auditor finishes, its refuter takes the next free slot before any new auditor.
- No new audit subagent starts while more than about six fix sessions are active.
- v4 starts when v3 is ledgered. v4 may re-rank its areas using v3's results.
