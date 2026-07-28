# 4 — The laser chain

`compileJob` → `grblStrategy` → G-code. Source: `src/core/output/grbl-strategy.ts` (494 lines).

## Preamble and postamble

Hard-coded, not user-editable (`PROJECT.md:493`). From `preamble()` (`grbl-strategy.ts:79-98`):

```gcode
G21          ; mm
G90          ; absolute
G54          ; pin the WCS — modal, survives soft reset
G94          ; pin feed-per-minute — a stale G93 would reinterpret every F
M3 S0        ; arm the laser at zero power
```

Postamble (`grbl-strategy.ts:100-116`): `M5`, then a park move carrying `S0`.

**`M3 S0` is a deliberate divergence from LightBurn.** The header comment
(`grbl-strategy.ts:12-14`) states LightBurn's stock GRBL headers are units/positioning only, with
`M3`/`M4` issued per cut layer, and cites "LIGHTBURN-STUDY §8" as the ledger entry.

> **That cited source does not exist in this repo.** See [README.md](README.md) and
> [09-weakness-register.md](09-weakness-register.md) W-01. The divergence is real and visible in
> the code; its *justification* is currently unverifiable.

The stated engineering reason (`grbl-strategy.ts:88-93`) is sound on its face: controllers not in
laser mode (`$32=0`) will not fire the diode on a `G1 S>0` without a prior `M3` — the move
happens, the beam stays off. `M3 S0` primes safely at zero power.

## Power: `S` scaling and M3/M4

`scaleS` (`grbl-strategy.ts:43-45`): `S = round((powerPercent / 100) × device.maxPowerS)`, where
`maxPowerS` is the machine's `$30`. That is non-negotiable #7, property-tested across
`$30 ∈ {100, 255, 1000}` (`PROJECT.md:589`).

Mode selection is modal and spans groups (`emitJob`, `grbl-strategy.ts:444-475`):

| Group kind | Mode | Why |
|---|---|---|
| `cut` | **M3** constant | A slow corner must still cut through. |
| `fill` | **M4** dynamic | GRBL scales `S` by actual/programmed feed. |
| `raster` | self-managed M4, ends `M5` | Handled inside `emit-raster.ts`. |

The M4-for-fill decision is **ADR-036** (`DECISIONS.md:1919`), superseding ADR-020 #4. Recorded
reason: a short engrave stroke that never reaches programmed feed — the head accelerating from
rest inside a few-mm glyph — deposits constant energy per mm instead of over-burning the slow
zones. That was the small-text "uneven density" defect. Secondary safety benefit noted at
`grbl-strategy.ts:442-443`: under M4 the diode is dark whenever the head is stopped, so fill is
strictly safer on travel and pause.

A mode flip is emitted **only when the required mode actually changes**, so cut-only jobs stay
byte-identical to pre-ADR-036 snapshots. Per-layer overrides resolve through `vectorPowerWord`
(`grbl-strategy.ts:485-489`), shared between arming a group and re-arming between passes
specifically so the two cannot disagree — a fixed audit defect (`grbl-strategy.ts:198-202`,
"audit P2-1": a dialect-default `M3` in the between-pass path silently flipped later groups to
constant power).

## Laser-off on travel — non-negotiable #3

Three accepted forms, defined in `findLaserOnTravelIssues`
(`src/core/invariants/predicates.ts:47-83`). A `G0` is safe if:

- (a) `S0` is on the same line, **or**
- (b) the previous effective line was `M5`/`M107` (Marlin fan-laser dialect, ADR-095), **or**
- (c) the last seen `S` value is already `0` (sticky firmware state).

Emission side: `laserOffSeekLine` (`grbl-strategy.ts:51-66`). Two refinements:

- Some dialects don't need the explicit `S0` on a rapid — gated on `dialect.requiresS0OnRapid`.
- A device may configure `controlledLaserOffTravelFeedMmPerMin`, converting travel from `G0` to a
  **controlled `G1 … F… S0`** carrying an explicit `INTENTIONAL_LASER_OFF_MOTION_COMMENT`. This
  exists so a machine that overshoots on rapids can travel at a bounded feed without violating
  the invariant.

**Defense in depth at the emitter.** Both `emitSegment` (`grbl-strategy.ts:149`) and
`sweepSpanLines` (`grbl-strategy.ts:349`) track the head at *emit precision* (3 dp) and skip any
move whose target equals the current position. Reason stated at `grbl-strategy.ts:146-148`:
formatting is part of the executable artifact — two points differing in memory can collapse to
one machine coordinate at 3 dp, and emitting that as a `G1 S>0` would be a **stationary beam-on
move**. If a whole segment collapses, its laser-off seek is omitted too (line 159).

## Fill (mode `fill`)

Hatch geometry is a compile-time decision, not a new G-code shape (ADR-019, `DECISIONS.md:689`) —
closed polylines are replaced with parallel hatch lines that flow through the same emit path.

Four fill styles resolve in `vectorGroupsForLayer` (`compile-job.ts:161-187`):

| Style | Behaviour |
|---|---|
| `scanline` | Parallel hatch, even-odd rule for holes; snake or unidirectional |
| `offset` | Concentric contour fill → `offsetFillContours`, emitted as ordinary segments |
| `island` | Contours grouped into islands, each its own group (`compile-job.ts:189-230`) |
| cross-hatch | Second pass at 90° (per-layer `fillCrossHatch`) |

The scanline emitter is the most heavily evolved code in the repo:

- **ADR-031** overscan lead-in/out: hatch runway outside the ink so acceleration happens off-part.
- **ADR-033** introduced the historical short-run overscan skip, retained by explicit legacy
  groups and separate policies.
- **ADR-034** continuous sweep: **one `G1` chain per scanline**, gaps blanked with `S0` rather
  than lifting into separate moves.
- **ADR-035** split a scanline at *large* gaps into independent sweeps.
- **ADR-052** scanning offset compensation: a per-speed table cancels the bidirectional zipper
  by translating reverse sweeps before emit-precision filtering.
- **ADR-238 amendment** gives every generic Scan Line sweep bounded feed-matched `S0` entry and
  exit motion; adjacent split sweeps share the blank gap and rapid only across an unused center.

`planFillSweeps` owns shifted, emit-precision-filtered geometry used by G-code, Frame bounds,
duration, optimization, and preview. `emitFillSweep` turns that plan into modal-power G-code.

ADR-038 made unidirectional fill a **per-layer option** — snake was previously hard-coded.

## Image / raster (mode `image`)

A `RasterImage` SceneObject variant carries a PNG data URL plus base64 luma; `dither.ts` runs
threshold / Floyd–Steinberg / grayscale; `emit-raster.ts` emits M4-mode per-pixel `S`-modulated
`G1` sweeps with overscan (ADR-020, `PROJECT.md:120`).

Key decisions:

- **ADR-032** bidirectional rows, after an overscan runtime regression.
- **ADR-039** split a raster row at wide white gaps so the emitter rapids across them — the
  raster analogue of ADR-035.
- **ADR-048** metadata-less bitmaps default to **254 DPI** for LightBurn parity.
- **ADR-243** rasters of *any* size stream row-by-row; the old raster budget became advisory
  rather than a refusal. `rowProvider` / `rowProviderOrder` (`grbl-strategy.ts:378-380`) are how a
  row is materialized lazily instead of held in memory.
- **ADR-202** separates burn raster fidelity from bounded preview/stream work.

Image overscan is a **fixed 5 mm default, not per-layer** (`PROJECT.md:403`) — an asymmetry with
fill overscan worth flagging in cross-reference.

## Air assist

`groupCoolantMode` / `coolantTransition` (`grbl-strategy.ts:421-431`) emit `M7`/`M8`/`M9` per group
when the device configures a command. Per project memory (burn-quality audit 2026-07-17), air
assist was previously found to **emit nothing** in some paths. The current code does emit
transitions, but this was **not re-verified end-to-end in this session — UNVERIFIED.**

## What is NOT verified for the laser chain

- **Perceptual fidelity of fill and raster.** The suite asserts path counts, byte-identity, and
  invariants. It has never asserted a fill *looks* like the source (CLAUDE.md rule 2).
- **F.2.f hardware burn** — never burned on the Falcon (`PROJECT.md:120`).
- **F.3 set-work-origin** — code shipped, hardware verification pending (`PROJECT.md:121`).
- **F.4 Convert to Bitmap A5** placement/brightness polish pending; no LightBurn side-by-side
  (`PROJECT.md:122`).

## Cross-reference slot — Phase 2

1. **Preamble.** Confirm LightBurn's actual stock-GRBL header and per-layer `M3`/`M4` placement.
   Our `M3 S0` pre-arm is a divergence with a missing ledger entry — is it *right*?
2. **Fill overscan.** How much runway does LightBurn add, and does it scale with speed? Generic
   Scan Line uses per-layer bounded every-sweep runways; explicit legacy policies retain ADR-033.
3. **Scanning offset.** Does LightBurn's per-speed interpolation match ours (`offsetForSpeed`)? A
   different interpolation shows as a visible zipper at intermediate speeds.
4. **Dither count.** `DECISIONS.md:1283` records **3 dither algorithms vs LightBurn's ten**. Which
   of the seven missing actually change output quality on wood/acrylic, and which are cosmetic?
5. **Image overscan.** Is LightBurn's image overscan per-layer? Ours is fixed 5 mm — if theirs is
   tunable, that is a parity gap.
6. **Power modes.** Does LightBurn choose M3 vs M4 per layer *mode* as we do, or expose it as a
   user toggle? ADR-190 made ours explicit per layer without changing defaults.
7. **Offset fill.** Compare `offset-fill.ts` output to LightBurn's Offset Fill on a glyph with
   holes — even-odd handling is the likely divergence.
