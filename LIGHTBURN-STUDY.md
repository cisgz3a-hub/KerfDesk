# LIGHTBURN-STUDY.md — LightBurn behavior reference and divergence ledger

**The document ADR-027 requires.** `DECISIONS.md:1293` names this file the authoritative LightBurn
behavior reference (§§1–7); `DECISIONS.md:1295` names §8 the running divergence ledger.
`src/core/output/grbl-strategy.ts:13` cites "LIGHTBURN-STUDY §8".

It had never been written. Recorded absent as **GCO-08** in
`docs/audits/2026-07-10-implementation-plan.md:512` and re-confirmed absent 2026-07-25, which made
ADR-027's "a divergence is a defect unless the ledger records it" rule unauditable. This file opens it.

**Rebuild started:** 2026-07-25. **Status: PARTIAL** — sections marked **NOT YET RESEARCHED** have no
entries yet. Do not read an empty section as "no divergence".

---

## Provenance rules

Every claim about LightBurn carries a fetched primary source. LightBurn is closed source, so the
authority is its official documentation, not inference from output or forum folklore.

| Marker | Meaning |
|---|---|
| **[LB-doc]** + URL | Fetched from official LightBurn documentation on the stated date |
| **[LB-forum]** | Forum/search summary only — weaker; upgrade to [LB-doc] before acting |
| **NOT YET RESEARCHED** | No source pulled. Not a finding of parity. |

Version note: pages were fetched from the `2.1` documentation tree. Our code targets GRBL v1.1h whose
upstream wiki has been archived since Aug 2019 (`PROJECT.md:570`), so where LightBurn tracks newer fork
behavior, *they* may be current and we may be stale.

---

## §1 — Device and G-code settings

**[LB-doc]** https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/GCode/ (2026-07-25)

| LightBurn setting | Behavior | Our equivalent |
|---|---|---|
| **Start / End G-code** | User-editable boxes; contents prepended/appended to every job | **Hard-coded**, not user-editable (`PROJECT.md:493`) |
| **G0 Moves for Overscan** | Toggle: G0 rapid vs G1 cutting move for non-cutting overscan portions | `dialect.requiresS0OnRapid` + `controlledLaserOffTravelFeedMmPerMin` + ADR-033 runway-as-rapid — **device-profile fields, not a user toggle** |
| **Emit S Value With Every G1 Command** | Toggle: send power with every move, or only on change | `dialect.emitSOnEveryBurnMove` (`grbl-strategy.ts:151`) — **PARITY** |
| **Fetch Settings on Connect** | Auto-read firmware settings | ADR-111 machine auto-fill from detected `$$` |
| **Workpiece Offset Checking** | **Verifies G54 offset presence; toggleable offset warnings** | We **pin `G54`** in both preambles instead (`grbl-strategy.ts:82-88`) |

**[LB-doc]** https://docs.lightburnsoftware.com/CommonGrblSetups.html (2026-07-25)

- Two GRBL device profiles: **GRBL** (firmware 1.1f+) and **GRBL-M3** (1.1e or older, incl. 0.9/1.0).
- **`$30` Spindle Max RPM default = 1000**, surfaced in Device Settings as **"S-Value Max"**. Matches our
  `maxPowerS` semantics and default (`PROJECT.md:385`) — **PARITY**.
- **`$32` Laser Mode should be 1** for 1.1f+; laser mode "eliminates the pauses that happen when changing
  power output."
- This page states **no** preamble/postamble.

## §2 — Layer modes

**[LB-doc]** https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/ (2026-07-25)

Four modes, and our four match one-for-one:

| LightBurn | Definition (quoted) | Ours |
|---|---|---|
| **Line** | "trace a path along the outlines of geometry" | `mode:'line'` |
| **Fill** | "etch or engrave parallel lines inside the bounds of closed shapes" | `mode:'fill'`, `fillStyle:'scanline'` |
| **Offset Fill** | "fill closed shapes with lines that follow the contour of the outer shape" | `fillStyle:'offset'` (`core/job/offset-fill.ts`) |
| **Image** | "similarly to Fill Mode, but applies additional special settings … based on the pixels" | `mode:'image'` |

**Verdict: PARITY on the mode taxonomy.** Our `fillStyle:'island'` is an *extra* style with no LightBurn
counterpart found — see §8 D-07.

Per-layer settings *named* but not detailed on that page: interval / lines-per-inch, overscanning, kerf
offset, tabs/bridges. Sub-page `MainSharedSettings` returned **HTTP 404** on 2026-07-25 — the Constant
Power detail below is therefore **[LB-forum]** and must be upgraded.

## §3 — Image mode and dithering

**[LB-doc]** https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/ImageMode/ (2026-07-25)

**Exactly 10 image modes**, confirming the count asserted at `DECISIONS.md:1283`:

| # | Mode | Purpose (per LightBurn) |
|---|---|---|
| 1 | Threshold | on/off by darkness at a location |
| 2 | Ordered | regular-grid ordered dithering |
| 3 | Atkinson | solid colour or smooth shaded images |
| 4 | Dither | error-diffusion for smoothly shaded photos |
| 5 | Stucki | like Dither, slightly faster |
| 6 | Jarvis | "generally the best choice for photo images" |
| 7 | Newsprint | decorative newsprint halftone imitation |
| 8 | Halftone | variable cell size + pattern angle, high DPI |
| 9 | Sketch | detects hard edges — line drawings, handwriting |
| 10 | Grayscale | varies power between min and max |

**Ours: 3** — threshold / Floyd–Steinberg / grayscale (`core/raster/dither.ts`, ADR-020). We hold
**Threshold**, one error-diffusion kernel, and **Grayscale**. Missing: Ordered, Atkinson, Stucki, Jarvis,
Newsprint, Halftone, Sketch.

Adjacent settings:

| LightBurn | Ours |
|---|---|
| **DPI** = `25.4 / Line Interval` | `linesPerMm` (`raster-units.ts`) — same relationship, different unit |
| **Dot Width Correction** — shortens scan lines to compensate beam width; range 0 → Line Interval | `dotWidthCorrectionMm` (`grbl-strategy.ts:385`) — **PARITY** |
| **Pass-Through** — use pre-processed image directly, no resampling | per-layer `pass-through` (`PROJECT.md:404`) — verify semantics match |
| **Negative Image** — inverts; for slate/glass | **No equivalent found in our tree.** §8 G-03 |
| **Scan Angle** — 0 default, 90 vertical, 180 reverse | Fill has hatch angle; **raster scan angle unconfirmed.** §8 G-04 |

## §4 — Power modes (M3 / M4)

The section `grbl-strategy.ts:13` cites. **Resolved.**

**[LB-doc]** CommonGrblSetups.html: GRBL 1.1f+ supports **M4 variable power**, which "adjusts the laser
power as the machine speeds up and slows down", prevents corner over-burn, and turns the beam off when
motion stops. Pre-1.1f firmware runs constant power and must use the **GRBL-M3** device profile.

**[LB-forum]** (search summary, 2026-07-25; `MainSharedSettings` 404'd): LightBurn's **Cut Settings
Editor has a "Constant Power" toggle** producing M3 constant-power behavior per layer, described as
matching LaserGRBL.

So LightBurn's shape is: **M4 is the default for the modern GRBL profile across all layer types, with a
per-layer Constant Power opt-in to M3.**

Ours (`grbl-strategy.ts:444-489`, ADR-036, ADR-190): **M3 default for `cut`, M4 default for `fill`**,
raster self-manages M4, plus a per-layer `powerMode` override.

**A real, previously-unledgered divergence.** See §8 **D-01** and **D-02**.

## §5 — Framing and job start — **NOT YET RESEARCHED**

Highest-priority remaining section: it decides whether our frame-first permit model
([docs/architecture/07-frame-permit-model.md](docs/architecture/07-frame-permit-model.md)) is a
differentiator or a divergence. Pull `GetStarted/FramingBeginner` and the Laser-window reference.

## §6 — Optimization / cut planning — **NOT YET RESEARCHED**

Compare against our ADR-163 five persisted policies and bounded nearest-neighbour planner.

## §7 — Trace / vectorization — **NOT YET RESEARCHED**

Compare against ADR-128 measured-boundary trace and ADR-030's Cutoff/Threshold realignment.

---

## §8 — Divergence ledger

The register ADR-027 requires. **Verdicts:** `PARITY` · `DIVERGENCE (ADR)` = deliberate, ADR-backed ·
`DIVERGENCE (unintentional)` = **a defect by ADR-027** · `GAP` = feature we lack · `OUR ADVANTAGE`.

### D-01 — Cut layers default to M3 where LightBurn defaults to M4 · **DIVERGENCE (ADR) — but re-examine**

- **LightBurn:** modern GRBL profile defaults to **M4** for all layers; per-layer Constant Power opts into
  M3. [LB-doc] §4.
- **Ours:** `cut` groups default **M3**; `fill` defaults M4 (ADR-036, `DECISIONS.md:1919`); per-layer
  override via ADR-190.
- **Authority:** ADR-036 is a *deliberate* decision, so this is ADR-backed. But ADR-036's recorded
  reasoning is about **fill** energy density; it does not argue that **cut** should stay M3 against a
  LightBurn M4 default. Our code comment justifies M3-for-cut as "a slow corner must still cut fully
  through" (`grbl-strategy.ts:439-440`) — the exact opposite of LightBurn's stated M4 rationale
  ("corners get over-burnt"). **Both cannot be right.** One is a claim about penetration, the other about
  scorching.
- **Action:** burn a comparison coupon — same vector at same power/speed under M3 and M4 — before
  defending our default. Not a code change; an evidence gap.

### D-02 — Constant Power is a per-layer toggle there, a per-layer power *mode* here · **PARITY (near)**

ADR-190 made vector power mode explicit per layer. Shapes match. Confirm the **default** matches once
`MainSharedSettings` is fetchable, and confirm our control wording matches LightBurn's user vocabulary
("Constant Power") rather than inventing our own.

### D-03 — `M3 S0` preamble pre-arm · **DIVERGENCE (unintentional) — RECLASSIFIED**

- **Claim in code** (`grbl-strategy.ts:12-14`): LightBurn's stock GRBL headers are "units/positioning
  only, with M3/M4 issued per cut layer — ours pre-arms", citing this file §8.
- **Now verified:** structurally corroborated. LightBurn's Start G-code is a **user-editable box**, empty
  by default, and it issues power mode per layer. The *shape* of the claim holds.
- **But:** the citation pointed at a file that did not exist, so this divergence has been shipping
  unledgered since the comment was written, backed by no ADR. Our stated reason — priming `$32=0`
  controllers so a `G1 S>0` actually fires — is sound engineering, and LightBurn addresses the same
  hazard differently, by **telling the user to set `$32=1`** ([LB-doc] §1).
- **Action:** write the ADR. A real behavioral divergence with a real rationale and no decision record.
  Until then it violates ADR-027 by default. Now ledgered here.

### D-04 — G54 handling: we pin, they warn · **DIVERGENCE (ADR)**

- **LightBurn:** "Workpiece Offset Checking" *verifies* G54 offset presence and warns. [LB-doc] §1.
- **Ours:** both emitters **emit `G54`** in the preamble to defeat a stale `G55`–`G59`
  (`grbl-strategy.ts:82-88`, `cnc-grbl-strategy.ts:108-111`).
- **Assessment:** ours is stronger — a warning can be dismissed; an emitted `G54` cannot be. Compatible
  with rule 7 because pinning informs nothing and refuses nothing. **Keep.** Consider *also* surfacing
  their warning in Job Review, the sanctioned surface.

### D-05 — Start/End G-code user-editable there, hard-coded here · **DIVERGENCE (ADR)**

`PROJECT.md:493` hard-codes preamble/postamble. Under rule 7 this is not a guard (it removes no action
the product ever offered). It is a genuine flexibility gap for users with unusual machines. **Maintainer
decision needed** — a custom-G-code box is a feature, not a guard, so rule 7 does not block it.

### D-06 — Overscan G0/G1 choice is a user toggle there, profile policy here · **DIVERGENCE (ADR)**

LightBurn's "G0 Moves for Overscan" is one checkbox. Ours is spread across
`dialect.requiresS0OnRapid`, `controlledLaserOffTravelFeedMmPerMin`, and ADR-033's short-run
runway-as-rapid rule. Ours is more capable and less discoverable. **Not a defect; a UX asymmetry.**

### D-07 — Island fill has no LightBurn counterpart · **OUR ADVANTAGE (unverified)**

`fillStyle:'island'` (`compile-job.ts:189`) plus `islandFillMotionPolicyForDevice`. No LightBurn
equivalent found. Never perceptually verified — see weakness register W-03.

### G-01 — Seven missing dither algorithms · **GAP**

Ordered, Atkinson, Stucki, Jarvis, Newsprint, Halftone, Sketch. **Jarvis** is LightBurn's own
recommendation as "generally the best choice for photo images" and we do not have it — the highest-value
single addition on this list for photo engraving quality.

### G-02 — Sketch mode · **GAP, strategically interesting**

"Detects hard edges for line drawings and handwriting" — an *image mode*, not a trace. Adjacent to our
ADR-115/ADR-123 edge-detection trace work but a different product surface.

### G-03 — Negative Image · **GAP, cheap**

Inverts the image; LightBurn calls out slate and glass, where burned areas go lighter. Trivial against
our luma pipeline. Likely a real user-visible omission on those materials.

### G-04 — Raster Scan Angle · **GAP, needs confirmation**

LightBurn offers 0 / 90 / 180. We have a fill hatch angle, but per-layer **raster** scan angle is
unconfirmed in our tree. Verify before filing.

### Verified parity (no action)

| Item | Evidence |
|---|---|
| Four layer modes and their definitions | §2 |
| `$30` = 1000 default, "S-Value Max" ↔ `maxPowerS` | §1 |
| Emit-S-per-move toggle ↔ `emitSOnEveryBurnMove` | §1 |
| Dot Width Correction ↔ `dotWidthCorrectionMm` | §3 |
| DPI ↔ lines-per-mm relationship | §3 |
| Bitmap default 254 DPI (ADR-048) | Asserted by ADR-048; **not re-verified here** |

---

## Next actions, in order

1. **Fetch `MainSharedSettings`** by another route (404 on 2026-07-25) to upgrade D-01/D-02 from
   [LB-forum] to [LB-doc]. The weakest link in the flagship finding.
2. **Write the ADR for D-03.** A shipping divergence with no decision record is the exact condition
   ADR-027 forbids.
3. **Burn the D-01 M3-vs-M4 cut coupon.** Our rationale and LightBurn's directly contradict.
4. **Research §5 framing** — decides whether frame-first is differentiator or divergence.
5. **Add Jarvis dithering** (G-01) — highest-value quality gap found so far.
6. Then §6 optimization and §7 trace.

## Sources

- [GRBL Configuration — LightBurn Documentation](https://docs.lightburnsoftware.com/CommonGrblSetups.html)
- [Device Settings: GCode](https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/GCode/)
- [Cut Settings Editor](https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/)
- [Cut Settings Editor: Image Mode](https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/ImageMode/)
- [GRBL: Low or No Power Output](https://docs.lightburnsoftware.com/Troubleshooting/GRBLPowerOutput.html) — listed in search, not yet fetched
- [How to change from M4 to M3 like LaserGRBL does](https://forum.lightburnsoftware.com/t/how-to-change-from-m4-to-m3-like-lasergrbl-does/64992) — [LB-forum] basis for the Constant Power toggle
