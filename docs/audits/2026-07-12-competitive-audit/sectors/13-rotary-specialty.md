## S13 · Rotary & specialty

Products rated: KerfDesk, LightBurn, MillMage, LaserGRBL, XCS (xTool Studio), Easel.
N/R: none — MillMage is CNC-only but 4th-axis rotary, CNC Z-probing, and automated coolant are in-sector CNC capabilities, so it competes here (a missing rotary feature scores 0, not N/R).
Pinned evidence: KerfDesk @ current `main` (worktree `xenodochial-stonebraker-4af61c`); competitor versions per methodology.md (LightBurn 2.1.03, MillMage 0.8.02, LaserGRBL 7.14.1, xTool Studio V1.7.x, Easel web SaaS).

`*` = hardware-dependent design-intent rating (§5.4). S13 has no [fidelity] categories, so no fidelity cap (§5.3) applies. 13.2 is [⚠HW] — every cell in that row is starred.

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|----------|----------|-----------|----------|-----------|-----|-------|
| 13.1 | Rotary setup | 2 [CODE]¹ | 10 [OFF]² | 0 [OFF]³ | 2 [COMM]⁴ | 8 [OFF]⁵ | 0 [COMM]⁶ |
| 13.2 | Rotary output correctness **[⚠HW]** | 5* [HW-CLAIMED]⁷ | 9* [OFF]⁸ | 0* [OFF]³ | 3* [COMM]⁴ | 8* [OFF]⁹ | 0* [COMM]⁶ |
| 13.3 | Focus & Z tools | 4 [CODE]¹⁰ | 10 [OFF]¹¹ | 6 [OFF]¹² | 0 [OFF]¹³ | 8 [OFF]¹⁴ | 5 [OFF]¹⁵ |
| 13.4 | Specialty modes | 7 [TEST]¹⁶ | 7 [OFF]¹⁷ | 6 [OFF]¹² | 2 [OFF]¹⁸ | 10 [OFF]¹⁹ | 0 [INF]²⁰ |

¹ `src/core/devices/rotary.ts:14-35` (RotarySetup + DEFAULT_ROTARY_SETUP); grep of `src/ui` for `/[Rr]otary|RotarySetup/` returns no files; `DECISIONS.md` ADR-127:6179-6182 defers the dialog.
² https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/ · https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/
³ https://docs.millmagesoftware.com/latest/Explainers/CNCTypes/ ("MillMage does not support rotaries at this time") · https://docs.millmagesoftware.com/latest/Reference/OperationSettingsEditor/
⁴ https://www.sainsmart.com/blogs/news/how-to-use-your-rotary-axis-for-the-le5040-with-lasergrbl (rotary via $101 console edit) · https://lasergrbl.com/usage/custom-buttons/
⁵ https://support.xtool.com/article/160 · https://support.xtool.com/article/3053
⁶ https://discuss.inventables.com/t/4th-axis-support/1178 · https://forum.easel.com/t/4th-axis-for-x-carve/57276
⁷ `src/core/job/rotary-transform.ts:17-63` (scale + rebase + reverse-mirror), `src/core/job/rotary-job.ts:28-45` (single source of truth), `src/core/devices/rotary.ts:42-52` (chuck scale = mmPerRotation/(π·d)), `src/io/gcode/emit-gcode-rotary.test.ts:55-126`, `src/io/rd/emit-rd.ts:11,34-37`; `DECISIONS.md` ADR-127:6187-6190 (CLAIMED — never run on a physical rotary).
⁸ https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/ · https://forum.lightburnsoftware.com/t/rotary-setting-and-test-button/124861
⁹ https://support.xtool.com/article/160 · https://support.xtool.com/article/172
¹⁰ `src/ui/state/autofocus-action.ts:40-140` (runAutofocus protocol), `src/ui/laser/AutofocusEditor.tsx:16-73` (presets), `src/ui/commands/command-families.ts:308-317` (Focus Test permanently disabled), `src/core/material-library/material-matching.ts:93,193` (thickness = library matching only).
¹¹ https://docs.lightburnsoftware.com/FocusTest.html · https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/ · https://forum.lightburnsoftware.com/t/z-axis-offset-for-different-layers/147706
¹² https://docs.millmagesoftware.com/latest/Guides/Probing/ · https://docs.millmagesoftware.com/latest/Reference/OperationSettingsEditor/
¹³ https://lasergrbl.com/usage/ · https://lasergrbl.com/usage/user-interface/ (no focus/Z/material-thickness tool documented)
¹⁴ https://support.xtool.com/article/1673 · https://support.xtool.com/article/1336
¹⁵ https://support.easel.com/hc/en-us/articles/5360405175187-Using-the-Z-Probe · https://support.easel.com/hc/en-us/articles/360012453174-Two-Stage-Carves-Roughing-and-Detail-Carves
¹⁶ `src/core/output/grbl-strategy.ts:345-355` (groupCoolantMode + coolantTransition emit M7/M8/M9), `src/ui/state/air-assist-default-actions.ts:38-122` (per-layer/per-object defaults sync), `src/core/output/grbl-strategy-air-assist.test.ts`; grep of `src/core` for `/tilt|curved|conical|surface compensation/` finds no laser curved-surface path.
¹⁷ https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SharedSettings/ · https://forum.lightburnsoftware.com/t/possible-to-add-air-assist-toggle-to-layers/31142
¹⁸ https://lasergrbl.com/usage/custom-buttons/ · https://lasergrbl.com/usage/ (no automated air-assist/surface-compensation feature documented)
¹⁹ https://support.xtool.com/article/3236 (Curve Process) · https://support.xtool.com/article/1781 (Smart Air Assist) · https://nelidesign.com/how-to-engrave-on-a-curved-surface-with-the-xtool-s1-laser-cutter/
²⁰ https://support.easel.com/hc/en-us (no air-assist/curved-surface/rotary specialty documented) · https://forum.easel.com/t/4th-axis-any-help/130967

### State of play

S13 is a weak sector for KerfDesk, and the numbers say so plainly: three of four categories are outright losses to the laser leaders, and there are no category wins in the roster. The one bright spot — automated air assist — reaches LightBurn parity but does not lead. This is consistent with prior internal notes that rotary is "the top laser gap," and this audit confirms it against named competitors rather than in the abstract.

The rotary story is a tale of a solid engine with no cockpit. KerfDesk has a genuinely real rotary transform: a `RotarySetup` model (roller/chuck, mm-per-rotation, object diameter, reverse), chuck circumference scaling `mmPerRotation/(π·d)`, roller 1:1, reverse-mirror, a one-revolution wrap limit, and a single source of truth (`machineSpaceJob`) that applies the scale at emit for both G-code and Ruida `.rd`, plus framing, time-estimate and preflight bounds — all structurally unit-tested, with disabled output byte-identical and raster/over-wrap jobs refused. But there is no rotary UI anywhere in `src/ui`: no setup dialog, no wizard, no config field, no Test/spin button. The feature is settable only by hand-editing a `.lf2` project or a machine-profile file, and ADR-127 explicitly deferred the dialog. So 13.1 (setup) is a 2 — a token that no real user can reach — while 13.2 (output correctness) earns a 5*, crediting the well-integrated, correct-by-design transform but discounting heavily for the fact that it has never run on a physical rotary (a wrong calibration silently distorts the burn and no automated test can catch it) and shows no wrapped preview.

LightBurn is the reference across the rotary categories. Its Rotary Setup dialog (Ctrl+R) covers roller vs chuck, axis assignment (Y/Z/A), mm-per-rotation, diameter, mirror output, and — decisively — a Test button that spins one full revolution to verify calibration before you commit material. That test-spin is exactly the correctness-verification affordance KerfDesk lacks, and it is why LightBurn takes 10 on setup and 9* on output (docked one point only because, like the whole roster, it has no visual wrapped preview — the axis is remapped at output). XCS (xTool Studio) is a strong second: roller or chuck/jaw mode, perimeter/diameter entry, roller S/M/L presets, and a framing pass that traces placement before the run — 8 on both rotary rows. LaserGRBL offers no rotary feature at all; rotary works only by hand-editing GRBL `$101` steps/mm in the console with no diameter entry and no over-circumference protection (2 on setup, 3* on output). MillMage and Easel do not support rotary — MillMage's own docs say so verbatim, and Easel's X-Carve GRBL has no 4th axis — so both are 0 (they compete in this CNC-inclusive sector but the capability is absent).

Focus & Z tools (13.3) is the second clear loss. KerfDesk's autofocus is real and reasonably built: `runAutofocus` sends a user-configured command (a Creality Falcon `$HZ1` preset or a generic GRBL `G38.2` probe preset), watches ok/error/alarm/status with a 15s timeout, and ships an `AutofocusEditor` UI with one-click presets. But that is one leg of a three-leg category: the Focus Test command is a permanently-disabled stub (it only alerts that it "needs a dedicated, hardware-verified Z-motion generator"), and there is no laser material-thickness/focus-offset field — thickness feeds only CNC-stock and material-library matching. That yields a 4. LightBurn owns this category at 10 (dedicated Focus Test generator, material-thickness field, per-layer Z offset, Z-step-per-pass, per-lens autofocus). XCS's hardware auto-measure autofocus is a standout at 8. MillMage (6) and Easel (5) score on their CNC Z-probing analogs; LaserGRBL has no focus/Z tooling at all (0).

Specialty modes (13.4) is the one category where KerfDesk holds its ground. Its automated air assist is genuinely more granular than LightBurn's: a device-level `airAssistCommand` (M7/M8/none), a per-layer flag, a per-object override, a defaults-sync action, emitted M7/M8/M9 transitions wrapping cut groups, and a safety-lock while a job runs — the emission and safety behavior are TEST-verified. That earns a 7, level with LightBurn's per-layer air-assist toggle (also 7) and comfortably ahead of LaserGRBL's manual-only custom-button macros (2). But XCS leads the category outright at 10 because it adds what nobody else here has: Curve Process height-mapping for curved/uneven surfaces and a Smart Air Assist Auto mode that varies airflow between engrave and cut. KerfDesk has no curved/tilted/conical-surface compensation — an exhaustive grep finds only camera-mount tilt and CNC stock thickness — so it trails XCS by 3 on specialty breadth.

Net: KerfDesk's rotary and focus engineering is real but either unreachable (rotary UI), unfinished (Focus Test stub), or unproven (rotary never HW-verified). The competitive position improves the moment the deferred UI and the Focus Test generator land, because the underlying math already exists and is tested. Until then this sector reads as designed-but-not-usable against LightBurn and XCS.

### Where we win / where we lose

- WIN 13.4 (+5 vs LaserGRBL) — KerfDesk ships automated per-layer + per-object air assist with a job safety-lock, versus LaserGRBL's manual-only M7/M8 custom-button macros; TEST-verified emission, not INF. [verified: emission + safety tests cited in ⁶]
- LOSE 13.1 (−8 vs LightBurn, −6 vs XCS) — no rotary setup UI at all; the model and math exist but are reachable only by hand-editing files (ADR-127 deferred the dialog) → G-S13-1
- LOSE 13.3 (−6 vs LightBurn, −4 vs XCS) — no focus-test generator (permanently-disabled stub) and no laser material-thickness/focus-offset field; only autofocus exists → G-S13-2
- LOSE 13.2 (−4 vs LightBurn, −3 vs XCS) — rotary output transform is structurally tested but never hardware-verified, has no wrapped preview, and is unreachable without file editing → G-S13-3
- LOSE 13.4 (−3 vs XCS) — no curved/tilted/conical-surface compensation; specialty coverage stops at automated air assist → G-S13-4

### Gaps feeding the register

- **G-S13-1 · 13.1 Rotary setup** — vs LightBurn/XCS, Δ −8/−6. No rotary UI; data model + math exist but require hand-editing project/profile files. ADR-127-recorded deferral (deliberate, no severity bump per §5.6). Severity P1 (headline laser workflow, blocks the whole rotary story for the laser persona). Effort M — build the Rotary Setup dialog + command wiring over the existing math.
- **G-S13-2 · 13.3 Focus & Z tools** — vs LightBurn/XCS, Δ −6/−4. Focus Test is a permanently-disabled stub; no laser material-thickness/focus-offset field. Severity P1. Effort M/L — Focus Test needs a hardware-verified Z-motion generator (its stated blocker).
- **G-S13-3 · 13.2 Rotary output correctness [⚠HW]** — vs LightBurn/XCS, Δ −4/−3. Transform implemented and tested but never HW-verified (silent-distortion risk) and no wrapped preview. Severity P1 (safety-adjacent: wrong calibration ruins material silently). Effort L — a maintainer rotary bench pass (hardware) + optional rotary preview (M).
- **G-S13-4 · 13.4 Specialty modes** — vs XCS, Δ −3. No curved/tilted/conical-surface compensation; XCS's Curve Process + Smart Air Assist Auto lead. Severity P2 (niche; LightBurn also lacks curved-surface). Effort L.

### Not verified

- **13.2 [HW-star], KerfDesk** — circumference/scale mapping, reverse-mirror sign, and the one-revolution wrap limit are unit-tested only (`emit-gcode-rotary.test.ts`); never run on a physical rotary. ADR-127 ships this CLAIMED and warns a wrong calibration silently distorts the burn with no automated test to catch it.
- **13.2, KerfDesk** — no perceptual/preview proof of the wrapped result: by design the on-canvas preview stays surface-true and does not apply rotary scaling (`rotary-job.ts:8-9`), so there is no rotary-specific preview of the mapped output.
- **13.2, competitors (LightBurn 9*, XCS 8*, LaserGRBL 3*)** — all rotary-output-correctness cells are documentary/design-intent and HW-unverified in this audit (starred); circumference accuracy was not independently bench-checked on either side.
- **13.3, KerfDesk** — autofocus was not run on hardware in this audit (ledger = CLAIMED, ADR-018 prior pass unverified here); the live UI was not exercised (side-effect-free constraint); the Focus Test generator does not exist (disabled stub).
- **13.4, KerfDesk** — only the emitted M7/M8/M9 command sequence is verified (CODE/TEST), not that a solenoid actually fires; the absence of curved/tilted/conical-surface compensation is a negative grep result and cannot be proven exhaustively.
- **All competitor ratings are documentary** (OFF/COMM) — no hands-on (HANDS) runs. Easel 13.4 (0) rests on INF (absence not documented) and cannot anchor any conclusion; it is not used as a win/lose anchor.
