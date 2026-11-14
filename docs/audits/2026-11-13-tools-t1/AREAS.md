# Tools one-by-one audit T1 — areas

**Requested by** the maintainer on 2026-11-13: "audit my tools one by one loops".

**Why now.** The last tool-by-tool pass was the [Tools quality register of 16 October 2026](../2026-10-16-tools-quality-register.md) at `f7e2a3689`. Since then 2,687 commits have reached `main`. The Tools menu has changed too: Tone Calibration is new, Box Fit Test and the AI Assistant have left the menu. Later rounds (rolling v2–v14, oracle O1, annoyance A1/A2, C2) audited routes and areas, not each tool on its own. T1 takes every command in today's Tools menu (`src/ui/commands/app-menu-groups.ts` at `8d92bd143`) as its own area.

## Loop

Each tool is one area. Areas run one at a time, because this PC has about 3 GB of free memory:
1. an **auditor** (fresh agent) works through the per-tool checklist below;
2. a **refuter** (fresh agent, its own method) runs only when the auditor raises a P1 or P2; it tries to disprove each one and looks for one more;
3. the **coordinator** re-reads every surviving P1 and P2 in `main`'s code;
4. a **ledger** row in [LEDGER.md](LEDGER.md); a docs pull request after each menu group;
5. every confirmed P1 and P2 gets a fix pull request, through the session that wrote the code where one is still live. P3s go to a sweep (`P3-SWEEP.md`).

Finding IDs are `T<nn>-P<k>-<m>`, where `nn` is the row number below.

## Per-tool checklist (every auditor)

1. **Map it.** Menu command → dialog or handler → core function. Name the governing ADRs and the `WORKFLOW.md` section. Note what changed since 16 October (`git log --since=2026-10-16` on those files).
2. **Re-check the October row.** Every defect the 2026-10-16 register repaired for this tool must still be fixed on `main`.
3. **Outside oracle.** Compute the expected result independently (geometry area or length, pixel values, dimensions, decoded G-code), not from the tool's own tests. Where LightBurn has the same tool, compare with what LightBurn documents.
4. **Inputs that break tools.** Rotated, mirrored and non-uniformly scaled artwork; groups, locked, hidden and mixed selections; empty and one-object selections; tiny and huge sizes; zero, negative and non-finite numbers in every field; inch units; open and self-crossing paths where they apply.
5. **History and files.** One Undo restores exactly; Redo repeats exactly; Save, reopen and the result is the same.
6. **Output.** Where the tool makes or changes burnable artwork, compile it through the real output path (`prepareOutput` → G-code) and check that what burns matches what the canvas shows.
7. **The dialog.** Labels, defaults, units, validation messages, Cancel leaves nothing behind, and keyboard use. A browser check only when the memory gate allows.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Harms a job (wrong burn, wrong size or place, burn outside the art), loses work, or exposes a secret. |
| P2 | A real defect with limited harm: a wrong result the user is likely to notice, a refusal that should not happen, a broken Undo, or a missing warning. |
| P3 | Wording, tidiness or a test gap with no defect found behind it. |

## Areas (run order)

Run order puts tools that make or change burns first, then new tools, then the rest.

| # | Group | Tool | Command id | Status |
|---|---|---|---|---|
| T01 | Calibrate | Material Test | `tools.material-test` | ledgered: P3 8 |
| T02 | Calibrate | Interval Test | `tools.interval-test` | ledgered: P2 1 (fixed by #1845), P3 3 |
| T03 | Calibrate | Tone Calibration (new since October) | `tools.tone-calibration` | ledgered: P3 5 |
| T04 | Calibrate | Scan Offset Test | `tools.scan-offset-test` | ledgered: P2 1 (fixed by #1848), P3 5 |
| T05 | Calibrate | Focus Test | `tools.focus-test` | ledgered: P3 4 |
| T06 | Fill repair | Fill Selection | `tools.fill-selection` | ledgered: P1 1 and P2 1 (fixed by #1850), P3 9 |
| T07 | Fill repair | Close Open Fill Contours | `tools.close-open-fill-contours` | ledgered: P3 5 |
| T08 | Fill repair | Close Fill Contours with Tolerance | `tools.close-fill-contours-with-tolerance` | ledgered: P3 5 (known 3) |
| T09 | Fill repair | Leave White Unburned | `tools.leave-white-unburned` | ledgered: P1 3, P2 1 (fixed by #1858), P3 3 |
| T10 | Fill repair | Close Paths with Tolerance | `tools.close-paths-with-tolerance` | ledgered: P2 2 (fixed by #1851), P3 3 (known 6) |
| T11 | Fill repair | Radius Fillet | `tools.radius-fillet` | ledgered: P2 3 (fixed by #1852), P3 6 |
| T12 | Fill repair | Shear | `tools.shear` | ledgered: P2 1 (fixed by #1853), P3 4 |
| T13 | Image | Image Studio | `tools.edit-image` | ledgered: P2 2 (fixed by #1855), P3 2 (known 3) |
| T14 | Image | Adjust Image | `tools.adjust-image` | ledgered: P2 2 (fix #1856), P3 2 (known 3) |
| T15 | Image | Photo Engraving | `tools.photo-engraving` | ledgered: P2 2 (fixed by #1860), P3 3 |
| T16 | Image | Apply Mask to Image | `tools.apply-image-mask` | ledgered: P2 3 (fixed by #1867), P3 3 |
| T17 | Image | Crop Image | `tools.crop-image` | ledgered: P2 2 (fixed by #1867), P3 2 (known 3) |
| T18 | Image | Flatten Image Mask | `tools.flatten-image-mask` | ledgered: P2 1 (fixed by #1865), P3 4 (known 9) |
| T19 | Image | Remove Image Mask | `tools.remove-image-mask` | ledgered: P3 3 (known 2) |
| T20 | Image | Save Processed Bitmap | `tools.save-processed-bitmap` | ledgered: P3 3 (known 1) |
| T21 | Image | Save Original Image | `tools.save-original-image` | ledgered: P2 2 (fixed by #1868), P3 4 (known 2) |
| T22 | Bitmap | Convert to Bitmap | `tools.convert-to-bitmap` | ledgered: P3 6 (known 1) |
| T23 | Trace | Trace Image | `tools.trace-image` | ledgered: P3 2 |
| T24 | Trace | Re-trace Original | `tools.retrace-original` | ledgered: P1 3 (fix session proposed), P3 2 |
| T25 | Trace | Multi-File Trace | `tools.multi-file-trace` | ledgered: P2 2 (fix session proposed), P3 5 |
| T26 | Vector | Convert to Path | `tools.convert-to-path` | ledgered: P1 1 + P2 1 fixed (#1875), P2 1 (fix session proposed), P3 5 |
| T27 | Vector | Generate Path From Cut | `tools.generate-path-from-cut` | ledgered: P2 1 fixed (#1877), P3 2 |
| T28 | Vector | Weld | `tools.weld` | ledgered: P1 1 + P2 2 (fix session proposed), P3 7 |
| T29 | Vector | Union Silhouette | `tools.union-silhouette` | ledgered: P1 1 + P2 4 (fix session proposed), P3 6 |
| T30 | Vector | Join Paths | `tools.join-paths` | ledgered: P1 1 + P2 2 (two fix sessions proposed), P3 6 |
| T31 | Vector | Resize Joint Openings | `tools.resize-joints` | ledgered: P2 3 (fix session proposed), P3 6 |
| T32 | Vector | Prepare Stamp | `tools.prepare-stamp` | ledgered: P1 1 + P2 1, plus Convert to Bitmap P1 (T22 area) (fix session proposed), P3 3 |
| T33 | Vector | Offset Shapes | `tools.offset-shapes` | ledgered: P2 3 (fix session proposed), P3 4 |
| T34 | Vector | Rubber-Band Outline | `tools.rubber-band-outline` | ledgered: P1 1 + P2 2 (fix session proposed), P3 3 |
| T35 | Vector | Close Path | `tools.close-paths` | ledgered: P2 3 (fix session proposed), P3 6 |
| T36 | Vector | Reverse Direction | `tools.reverse-paths` | ledgered: clean (no P1/P2), P3 4 |
| T37 | Vector | Optimize Shapes | `tools.optimize-shapes` | ledgered: P1 1 + P2 2 (fix session proposed), P3 2 |
| T38 | Vector | Warp | `tools.warp` | |
| T39 | Vector | Deform | `tools.deform` | |
| T40 | Vector | Subtract | `tools.subtract` | |
| T41 | Vector | Intersect | `tools.intersect` | |
| T42 | Vector | Exclude | `tools.exclude` | |
| T43 | Vector | Cut Shapes | `tools.cut-shapes` | |
| T44 | Vector | Trim Shapes | `tools.trim-shapes` | |
| T45 | Vector | Extend Shapes | `tools.extend-shapes` | |
| T46 | Create & measure | Constrained Sketch | `tools.constrained-sketch` | |
| T47 | Create & measure | Parametric Part | `tools.parametric-part` | |
| T48 | Create & measure | Editable Relief | `tools.editable-relief` | |
| T49 | Create & measure | Measure | `tools.measure` | |
| T50 | Create & measure | Tangent Circle | `tools.tangent-circle` | |
| T51 | Create & measure | Text | `tools.add-text` | |
| T52 | Create & measure | Registration Jig | `tools.registration-jig` | |
| T53 | Create & measure | Camera | `tools.camera` | |
| T54 | Create & measure | Place Board | `tools.place-board` | |
| T55 | Create & measure | Rotary Setup | `tools.rotary-setup` | |
| T56 | Create & measure | Print and Cut | `tools.print-and-cut` | |
| T57 | Create & measure | Box Generator | `tools.box-generator` | |
| T58 | Create & measure | Barcode | `tools.barcode` | |
| T59 | Variable data | Bake Variable Text | `tools.bake-variable-text` | |
| T60 | Settings | Cut Planner | `tools.optimization-settings` | |
| T61 | Settings | Labs | `tools.labs` | |

## Rules

- **Trees:** a fresh `git archive` export of `origin/main` per area, outside OneDrive, with a `node_modules` junction. Agents never edit a tree's sources; experiments and mutations go in the agent's own copy.
- **Agents:** report only. No commits, no branch switches, never `git stash`.
- **Safety:** simulated controllers and stub cameras only. Never hardware, a real serial or USB device, a live external service, `pnpm`, a desktop build or package, or the installed KerfDesk.
- **Memory gates:** Vitest needs at least 1.5 GB free and an explicit file list. A browser run needs at least 2 GB free: headless, one worker, one spec.
- **Changes:** anything that could move a toolpath or change what users see is listed for the maintainer, not changed, unless it is a confirmed P1 or P2.
- **Pull requests:** fix and docs pull requests use auto-merge (MERGE) plus Auto-fix.

**Status:** started 2026-11-13.
