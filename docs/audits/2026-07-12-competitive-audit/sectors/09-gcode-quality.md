# S09 · G-code & motion output quality

Products rated: KerfDesk, LightBurn 2.1.03 (Core $99 / Pro $199), MillMage 0.8.02 (CNC-only — S9 is not laser-only, so its CNC G-code output is rated here), LaserGRBL 7.14.1 (dormant ~16 months), XCS (= xTool Studio desktop V1.7.x per phase-0 roster note), Easel (web SaaS, Free/Starter/Pro).
N/R: none — every roster Tier-1 product emits or exports G-code (XCS via its TF-card/export workflow) and therefore competes in this sector.
Pinned evidence: KerfDesk @ 87d0f21f (worktree HEAD at rating time; evidence pack `data/S09-evidence.json`, targeted vitest re-runs 2026-07-13: 32 files / 216 output+invariant tests and 11 files / 129 preflight tests green); competitor versions per `data/phase0.json`.

Scale: anchored 0–10 per design §5.1. `U` = unknown (excluded from roll-ups). No §5.3 fidelity categories and no §5.4 hardware-dependent (`*`) categories exist in this sector — but note that all firmware-side *reactions* to KerfDesk's emitted output remain HW-CLAIMED (see Not verified).

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|----------|----------|-----------|----------|-----------|-----|-------|
| 9.1 | Arc output | 7 [CODE]¹ | 4 [COMM]² | 3 [COMM]³ | 2 [COMM]⁴ | U [INF]⁵ | 2 [OFF]⁶ |
| 9.2 | Power scaling & modes | 8 [CODE]⁷ | 9 [OFF]⁸ | 6 [OFF]⁹ | 6 [OFF]¹⁰ | 3 [OFF]¹¹ | 5 [COMM]¹² |
| 9.3 | Output customization | 3 [CODE]¹³ | 10 [OFF]¹⁴ | 8 [OFF]¹⁵ | 6 [COMM]¹⁶ | U [INF]¹⁷ | U [INF]¹⁸ |
| 9.4 | Dialect breadth | 6 [CODE]¹⁹ | 10 [OFF]²⁰ | 8 [OFF]²¹ | 3 [OFF]²² | 2 [OFF]²³ | 3 [OFF]²⁴ |
| 9.5 | Output structure & provenance | 9 [TEST]²⁵ | 6 [OFF]²⁶ | 6 [OFF]²⁷ | U [INF]²⁸ | U [INF]²⁹ | U [INF]³⁰ |
| 9.6 | Motion-safety guarantees | 9 [TEST]³¹ | 6 [OFF]³² | 6 [OFF]³³ | U [INF]³⁴ | U [INF]³⁵ | 5 [OFF]³⁶ |

**Footnotes (citations)**

¹ `src/core/output/cnc-grbl-strategy.ts:232-283` (native G2/G3 with I/J, sampled-G1 fallback); `src/core/output/grbl-strategy.ts:95-112` (laser path is G0/G1 polylines only); `src/io/svg/flatten-curves.ts:12` (DEFAULT_FLATNESS_MM = 0.25); `src/core/job/compile-job.ts:381,409` (no output-time re-flatten — open MAJOR S5-F2, no governing ADR).
² https://forum.lightburnsoftware.com/t/using-g02-arc-instead-of-multiple-line-segments/188115 (staff confirm no circular interpolation); https://lightburn.fider.io/posts/650/arcs-written-with-g02-and-g03-g-code-for-supported-laser-controllers.
³ https://forum.lightburnsoftware.com/t/using-g02-arc-instead-of-multiple-line-segments/188115 (staff: no G2/G3; ~0.60 mm chord segmentation, not user-adjustable).
⁴ https://github.com/arkypita/LaserGRBL/issues/170 (no arc generation); https://github.com/arkypita/LaserGRBL/issues/1134 (arc preview rendered incorrectly).
⁵ https://support.xtool.com/article/636 (export exists); no arc/segmentation documentation found across support.xtool.com search passes 2026-07-13 — unknown.
⁶ https://support.easel.com/hc/en-us/articles/360012642474-Easel-G-code-Spec (linear-only whitelist; "arcs must be linearized"; G2/G3 imports rejected); https://discuss.inventables.com/t/does-easel-use-arcs-g2-g3-if-not-why/24114.
⁷ `src/core/output/grbl-strategy.ts:39-41,75-83,368-405` (S scaled to device.maxPowerS; M3 S0 preamble; M3/M4 modal switching); `src/core/preflight/controller-readiness.ts:108-196` (live $30/$32 proof with CNC inversion); `src/core/devices/gcode-dialects.ts:55-125` (per-dialect power modes; no per-layer override — S5-F4 open); `src/core/output/marlin-strategy.ts:14-21` (M106/M107 fan dialect).
⁸ https://docs.lightburnsoftware.com/2.1/Guides/GRBLConfiguration/ (S-Value Max ↔ $30); https://docs.lightburnsoftware.com/Troubleshooting/GRBLPowerOutput.html; https://forum.lightburnsoftware.com/t/s-value-or-30-setting/153189 (per-layer Constant Power M3 vs M4).
⁹ https://docs.millmagesoftware.com/latest/Reference/OperationSettingsEditor/ (per-op feeds/speeds incl. spindle RPM); https://lightburnsoftware.com/products/millmage-core (GRBL M3 device).
¹⁰ https://lasergrbl.com/usage/raster-image-import/target-image-size-and-laser-options/ (M3 vs M4 choice, S-MIN/S-MAX); https://lasergrbl.com/configuration/.
¹¹ https://support.xtool.com/article/1306 + https://support.xtool.com/article/1865 (percentage presets only; no M3/M4 or S-max exposure documented).
¹² https://forum.easel.com/t/spindle-control-from-easel/148 (M3/M5 + RPM); https://forums.maslowcnc.com/t/can-easel-automatically-include-spindle-control-m4-m5-codes/13965.
¹³ `src/core/devices/device-profile.ts:136` (gcodeDialect is the only output-shaping device field; repo-wide grep for startGcode/endGcode/customGcode/headerLines found no user hook); `src/core/devices/gcode-dialects.ts:86-125` (six fixed presets); `src/io/gcode/gcode-metadata.ts:41-74` (automatic, non-customizable provenance header); `src/core/output/tool-change-labels.ts:7-20`; `src/core/output/grbl-strategy.ts:345-355` (M7/M8 air assist).
¹⁴ https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/GCode/; https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/CustomGCode/ (Custom GCode device type can override every emitted command; |RESTORE| macros, \x hex escapes).
¹⁵ https://docs.millmagesoftware.com/latest/Reference/DeviceSettings/CustomGCode/ (tool-change/ATC hooks, coolant hooks, comment chars, variable substitution); https://docs.millmagesoftware.com/0.8/Guides/CoolantCustomGCode/.
¹⁶ https://github.com/arkypita/LaserGRBL/issues/783 (custom header/between-passes/footer since v3.0.19); https://lasergrbl.com/usage/custom-buttons/ (shared macro language); https://github.com/arkypita/LaserGRBL/issues/1172 (bug: header/footer omitted from saved files).
¹⁷ Absence across support.xtool.com article searches 2026-07-13 (articles 636/933/1303/2442 reviewed) — unknown, likely absent but not provable.
¹⁸ https://support.easel.com/hc/en-us/articles/4406926040979-Exporting-Gcode-from-Easel (fixed-format .nc export); no customization hooks found in support.easel.com search passes 2026-07-13 — unknown.
¹⁹ `src/core/output/select-output-strategy.ts:15-35` (grbl-v1.1/grblHAL/FluidNC → GRBL emitter; Marlin; Smoothieware; Ruida binary routed to io/rd); `src/core/devices/gcode-dialects.ts:1-42` (4 GRBL + 2 Marlin dialects, ADR-095); `src/io/rd/emit-rd.ts:26-55` (.rd shares prepareOutput pipeline, ADR-097 experimental); `src/core/controllers/ruida/rd-encoder.ts:70-71` (layer min power hardcoded == max); consolidated-audit v2 §A.3 — every non-GRBL family simulator/research-verified only.
²⁰ https://lightburnsoftware.com/products/lightburn-core (GRBL, GRBL-M3, Grbl-LPC, Smoothieware, Marlin, Cohesion3D); https://lightburnsoftware.com/products/lightburn-pro (Ruida/Trocen/TopWisdom DSP, EZCad2/EZCad3 galvo).
²¹ https://lightburnsoftware.com/products/millmage-core (GRBL, GRBL M3, GRBL-STM, grblHAL, FluidNC, Smoothieware); https://lightburnsoftware.com/pages/what-is-millmage (export posts: Mach3/Mach4, LinuxCNC, UCCNC, Duet/RRF, Masso).
²² https://lasergrbl.com/faq/ + https://github.com/arkypita/LaserGRBL (Grbl v0.9/v1.1 only).
²³ https://support.xtool.com/article/933 (gcode import/export scoped to xTool D-series); https://support.xtool.com/article/1170 (drives only xTool machines; no dialect selection).
²⁴ https://support.easel.com/hc/en-us/articles/4406926040979-Exporting-Gcode-from-Easel (grbl-centric; one generic .nc flavor, no post-processor list).
²⁵ `src/core/output/grbl-strategy.property.test.ts:111,214` (byte-identical across 100 fuzz seeds incl. fill); `src/io/svg/pipeline.snapshot.test.ts:88` (two-run byte-identical + snapshot corpus); `src/core/invariants/cnc-depth.test.ts:107` (CNC 100-seed); `src/core/output/grbl-strategy.ts:1-14,31-37,118-119,138-139` (determinism invariants, per-layer comment banners); `src/io/gcode/gcode-metadata.ts:23,52-74` (provenance header: app/version/commit/build/emitter revision + $30/$32 assumptions); `src/io/gcode/emit-gcode.ts:63-74` (preflight runs on header-free motion body).
²⁶ https://docs.lightburnsoftware.com/CustomGCode.html (layer comments + Suppress Comments option); https://forum.lightburnsoftware.com/t/save-gcode-file-format/7578 (determinism/provenance undocumented).
²⁷ https://docs.millmagesoftware.com/latest/Reference/DeviceSettings/CustomGCode/ (configurable comment character; tool-change comments); https://forum.lightburnsoftware.com/t/custom-gcode-allow-variable-substitution-inside-tool-change-comments/190395.
²⁸ https://github.com/arkypita/LaserGRBL/issues/1172 (save function exists); comment/header conventions and determinism undocumented — unknown.
²⁹ https://support.xtool.com/article/636 (export mechanics only); structure/determinism undocumented — unknown.
³⁰ https://support.easel.com/hc/en-us/articles/360012642474-Easel-G-code-Spec (constrained vocabulary implied); header/comment structure and determinism undocumented — unknown.
³¹ `src/core/output/grbl-strategy.ts:47-54,274-283` (S0 on every rapid; zero-length-move suppression); `src/core/preflight/preflight.ts:353,410,420,439` (out-of-bounds, non-finite, laser-on travel, long blank feed scans); `src/core/invariants/non-finite-coords.ts:20-40` (NaN/Inf on X/Y/Z/I/J at the text boundary — closes S5-F1); `src/core/invariants/arc-bounds.ts:25-61` + `src/core/invariants/predicates.ts:155` (G2/G3 bulge extrema in bounds scan — closes S5-F6); `src/core/raster/emit-raster.ts:442-470`; `src/core/invariants/cnc-motion.ts`; `src/io/gcode/emit-gcode.ts:96-101` (rotary wrap limit, ADR-127); `src/ui/state/laser-error-line.ts:98-112` (beam-off after mid-job error); 11 files / 129 preflight tests green this session.
³² https://docs.lightburnsoftware.com/2.1/Guides/GRBLConfiguration/ (M4 zero-speed-zero-power); https://docs.lightburnsoftware.com/Troubleshooting/GRBLPowerOutput.html (travel safety delegated to firmware $32; no documented output-side bounds/non-finite guards).
³³ https://docs.millmagesoftware.com/latest/Reference/ProjectSetupWizard/ (Safe Clearance Height; Fast Retraction Height with collision caveats).
³⁴ https://github.com/arkypita/LaserGRBL/issues/568 (historic laser-on-G0 bug, 2019-era); current 7.14.1 behavior undocumented — unknown.
³⁵ No output-safety documentation found across support.xtool.com searches 2026-07-13 — unknown.
³⁶ https://support.easel.com/hc/en-us/articles/360012642474-Easel-G-code-Spec (whole-file rejection of non-whitelisted commands); https://www.designsbyphil.com/x-carve-tips.html + https://forum.easel.com/t/spindle-control-from-easel/148 (safety height for travels).

### State of play

This is one of KerfDesk's strongest sectors — unusually, the free MIT web app out-engineers the whole roster on two of the six categories, while losing badly on exactly one: user-facing output customization. The sector splits cleanly into "what the emitter does by itself" (9.1, 9.5, 9.6 — KerfDesk leads) and "what the user can make the emitter do" (9.3, 9.4 — LightBurn leads by a wide margin), with power handling (9.2) near parity.

On arc output (9.1), the surprising documentary finding is that *nobody else in this roster emits G2/G3 at all*. LightBurn and MillMage staff state on the record that neither product uses circular interpolation — MillMage segments Beziers at a fixed ~0.60 mm chord length — LaserGRBL's vectorizer emits stair-stepped G1, and Easel's own G-code spec whitelists linear moves only and rejects files containing arcs. KerfDesk's CNC emitter produces native G2/G3 with I/J words and a sampled-G1 fallback for invalid radii, making it the only arc emitter in the roster. The score is 7 rather than higher because the *laser* path is still G0/G1-only, flattened once at import at 0.25 mm, and the known MAJOR S5-F2 (post-import scaling multiplies chord error with no output-time re-flatten, and no ADR records the divergence) is still open — so the lead is real but carried entirely by the CNC path.

On structure/provenance (9.5) and motion safety (9.6), KerfDesk's position is the strongest evidenced in the roster: byte-identical determinism proven across 100 fuzz seeds and a snapshot corpus, a provenance header recording app version/commit/emitter revision and the $30/$32 assumptions, and a layered post-emit text-scan defense (laser-on travel, out-of-bounds including arc-bulge extrema, non-finite coordinates, long blank feeds) that runs on the header-free motion body. No competitor documents anything comparable: LightBurn's documented safety story is "M4 goes to zero power at zero speed, and firmware $32 handles rapids"; MillMage's is a CNC clearance-height model with explicit user-dependent caveats. The asymmetry of evidence classes matters here — KerfDesk is rated from code and green tests, competitors from docs that simply do not discuss determinism or emitted-output guards — so these leads are documentary-absence leads, not hands-on-measured ones.

The mirror image is output customization (9.3), the sector's dominant gap. KerfDesk has *no* user-editable start/end/tool-change G-code, no custom headers, and no macro surface — the device profile carries only a dialect selection plus six fixed presets. LightBurn's Custom GCode device type can override every command the program emits, with macros and hex escapes; MillMage ships tool-change/ATC/coolant hooks with variable substitution; even dormant LaserGRBL has had custom header/passes/footer since v3.0.19. Anyone with a non-standard controller, an air-assist relay quirk, or a tool-changer script hits this wall immediately, and it also compounds the dialect gap (9.4): where LightBurn Pro speaks Ruida/Trocen/TopWisdom DSP and EZCad galvo natively and MillMage posts to Mach/LinuxCNC/Duet/Masso, KerfDesk covers four controller families and one experimental binary format — and every non-GRBL family is simulator-verified only, with the Ruida encoder's layer min-power hardcoded equal to max.

Power scaling (9.2) is close. KerfDesk scales S from the live-verified $30, arms M3 S0 in the preamble, switches M3/M4 per operation mode per dialect, and — uniquely in the roster — *gates job start on proof* that $30/$32 match, with honest degradation when the settings capability is absent. LightBurn edges it on flexibility: its per-layer Constant Power toggle is exactly the per-layer M3/M4 override KerfDesk lacks (S5-F4, still open). The one-point delta is within noise per design §11, but the missing feature is concrete and named. XCS abstracts power to percentage presets with no M3/M4 or S-max exposure at all, and Easel does basic M3/M5+RPM spindle control — adequate for its audience, primitive against the category.

Four of six XCS cells and three LaserGRBL/Easel cells are U — xTool's pipeline is closed and undocumented at this level, and LaserGRBL's dormancy means nothing current is written down. Those cells are research debt, not zeros, and none of the win/lose bullets below rests on an [INF] cell.

### Where we win / where we lose

- WIN 9.1 (+3 vs LightBurn, +4 vs MillMage) — KerfDesk is the only product in this roster that emits native G2/G3 arcs (CNC path); LightBurn/MillMage staff confirm segments-only, Easel's spec rejects arcs outright. [candidate — pending §5.5 adversarial refutation]
- WIN 9.5 (+3 vs LightBurn, MillMage) — Test-proven byte-identical determinism plus a provenance header (version/commit/emitter/$30-$32 assumptions) that no competitor documents any equivalent of. [candidate — pending §5.5 adversarial refutation]
- WIN 9.6 (+3 vs LightBurn, MillMage) — Emitted-output safety scans (laser-on travel, bounds with arc-bulge extrema, non-finite coordinates) where competitors delegate travel safety to firmware or user-set clearance heights. [candidate — pending §5.5 adversarial refutation]
- LOSE 9.3 (−7 vs LightBurn, −5 vs MillMage, −3 vs LaserGRBL) — No user start/end/tool-change hooks or custom headers at all, vs LightBurn's override-everything Custom GCode device. → G-S09-1
- LOSE 9.4 (−4 vs LightBurn, −2 vs MillMage) — Six text dialects + one experimental binary (all non-GRBL simulator-only) vs LightBurn Pro's DSP/galvo breadth and MillMage's CAM post list. → G-S09-2
- LOSE 9.2 (−1 vs LightBurn) — No per-layer constant/dynamic (M3/M4) power override (S5-F4); delta is within design noise but the feature gap is concrete. → G-S09-3

### Gaps feeding the register

- G-S09-1 · 9.3 Output customization · vs LightBurn (−7) · no ADR records the absence · user-editable start/end/tool-change G-code + custom header is table stakes for every non-KerfDesk product in the roster; effort M.
- G-S09-2 · 9.4 Dialect breadth · vs LightBurn (−4) · partially deliberate (ADR-095/097 scope) · DSP/galvo/CAM-post breadth is a Pro-tier differentiator we lack; hardware validation of existing non-GRBL dialects is the cheaper first step; effort L.
- G-S09-3 · 9.2 Per-layer power-mode override · vs LightBurn (−1) · S5-F4 open, un-ADR'd · LightBurn's per-layer Constant Power toggle has no KerfDesk equivalent; effort S.
- (register note) 9.1 carries an internal correctness caveat despite the win: S5-F2 — post-import scaling multiplies laser chord error with no output-time re-flatten and no governing ADR — should ride along in the register under its existing full-sweep ID.

### Not verified

- **All firmware-side behavior is HW-CLAIMED** (repo hardware ledger: every pass CLAIMED). Whether GRBL actually gates M4 power at rest, zeroes power on rapids under $32=1, de-energizes on alarm, or accepts KerfDesk's emitted G2/G3 arcs has never been driven on a machine. No physical burn has validated the safety envelope end-to-end.
- **No dialect validated on real hardware**: grblHAL, FluidNC, Marlin, Smoothieware, Ruida are simulator/research-verified only; no reference .rd file exists in-tree to diff the encoder against; whether a real Ruida controller accepts the minimal command stream is unknown. Whether FluidNC's $$ dump includes $30/$32 (which the readiness gate harvests) is unknown.
- **9.1 curve quality never compared perceptually** to source artwork or LightBurn output; whether canvas resize writes transform.scale (the S5-F2 error amplifier) was not traced through scene mutation.
- **9.5 residuals**: whether the streamed Start path carries the provenance header (a file-actions comment suggests Save-only) was not re-traced this session; determinism across OSes/Node versions untested beyond this Windows machine.
- **9.3 absence proof is grep-based**: an unconventionally named hook could theoretically exist, though both emitters were read. LightBurn's device-settings start/end G-code fields were not re-verified against an install this session.
- **U cells (research debt)**: XCS 9.1/9.3/9.5/9.6 (closed pipeline, nothing documented); LaserGRBL 9.5/9.6 (dormant, undocumented); Easel 9.3/9.5 (no docs found either way).
