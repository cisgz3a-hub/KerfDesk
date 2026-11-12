# O8 `units-locale-numbers` — Oracle audit O1, batch 3

**Area:** every number that crosses a boundary. That covers:

- G-code number spelling in every dialect: GRBL, grblHAL, FluidNC, Marlin (inline and fan), Smoothieware and the CNC post.
- Resume, jog, frame and setting-write commands.
- Ruida and Moshi value encodings.
- The file writers: SVG, DXF, PDF, EPS, GeoJSON, HPGL, project and material library.
- Imports that read numbers: SVG, DXF, HPGL, PostScript, STL, G-code and PNM.
- UI numeric entry: decimal comma, unit suffixes and expressions.
- Unit conversion: mm/in, mm/s vs mm/min, % vs S vs `$30`, and degrees vs radians.

Motion logic was left out, as the brief asked. This audit covers only how numbers are written, read and converted.

**Read at:** `origin/main` 93c880722 (2026-11-12). Method, severity and rules: [AREAS.md](AREAS.md).

**Fix PRs:**
- [#1797](https://github.com/cisgz3a-hub/KerfDesk/pull/1797): O8-P2-1, ADR-705 Amendment 5.
- [#1799](https://github.com/cisgz3a-hub/KerfDesk/pull/1799): O8-P2-2, ADR-357 Amendment 6.
- [#1801](https://github.com/cisgz3a-hub/KerfDesk/pull/1801): O8-P3-1 to O8-P3-4.

## Headline

The G-code number writers are clean against the controller grammars.

- The real strategies ran for GRBL at `$30` = 1000, 1 and 12.5, and for grblHAL, FluidNC, Marlin inline, Marlin fan and Smoothieware. Inputs were coordinates up to 1e6 mm, feeds of 0.5 and 1e7 mm/min, powers of 33.33, 100.0000001, 150 and 0.04, arcs and rasters.
- Every code line matched the RS274/GRBL word grammar. The longest stripped line was 39 characters; GRBL's limit is 79.
- No word carried an exponent, `NaN` or a comma.
- `formatGcodeDecimal` and `formatGcodePowerS` spell 200,000 random doubles from 1e-12 to 1e22 without an exponent. Dropping the leading `0` keeps sub-1 S values inside GRBL's eight parsed digits.
- 100 % power gives exactly `$30` on every machine. Ruida power and coordinates round-trip within half a step.

Two P2 findings sit at the edges, where a number silently changes and nothing says so:

- **O8-P2-1:** a Moshiboard's speed byte carries whole mm/s for lines and whole cm/s for images, so a set speed between two steps runs at a neighbouring one. The rotary path warned about this; the flat-bed path did not. Images at 1000 mm/min ran 20 % faster.
- **O8-P2-2:** DXF and ASCII STL imports read numbers with `parseFloat`. A comma-locale `12,5` therefore imported as 12, with a success toast.

Both are fixed. The Moshi bytes are unchanged; the job now says when the speed changes.

| Raised | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 19 (18 auditors, 1 refuter) | 0 | 2 (oracle-plan wording, not code) | 0 | 2 | 17 |

## Oracle plan

This plan was written before the code was read closely, from the file list only. It is kept as written. The research verifier's corrections are listed under "Not verified and corrections".

| # | Claim | Oracle |
|---|---|---|
| G1 | Every G-code real is a plain decimal: no exponent, `NaN`, `Infinity`, locale comma or thousands separator | NIST RS274/NGC v3 §3.3.2.1; GRBL `read_float` |
| G2 | No `-0.000` (harmless to parsers; a diff hazard) | IEEE 754 signed zero |
| G3 | Decimal places fit what the firmware keeps (GRBL: 8 parsed digits) | GRBL `nuts_bolts.c` `MAX_INT_DIGITS` |
| G4 | Rounding does not accumulate (absolute output) | property |
| G5 | Line length fits the firmware line buffer | GRBL `LINE_BUFFER_SIZE` |
| G6 | F is mm/min under G21 and in/min under G20; mm/s is ×60 once | RS274/NGC F word; GRBL wiki; LightBurn units |
| G7 | 100 % gives S = `$30`; S never exceeds `$30`; Marlin S follows `CUTTER_POWER_UNIT` | GRBL wiki `$30`/`$31`; FluidNC `speed_map`; Marlin M3 |
| G8 | G20 output divides every word by exactly 25.4 | RS274/NGC; property |
| G9 | Rounded arc endpoints pass GRBL's radius check | GRBL `gcode.c` error 33 |
| G10 | Dwell: GRBL P is in seconds; Marlin P in ms, S in s | GRBL wiki G4; Marlin G4 |
| R1–R3 | Ruida: 35-bit µm coordinates, 14-bit power, µm/s speed; range-checked, never wrapped. Moshi: mils and speed bytes | MeerK40t `ruida/rdjob.py`, `moshi/builder.py` (independent implementations) |
| F1–F6 | SVG numbers follow the SVG grammar; DXF reals use `.`; PDF reals have no exponent; DSC bbox values are integers; JSON has no `NaN`; HPGL uses 40 units per mm; export then import round-trips | SVG 1.1 §8.3.9, SVG 2; DXF Reference; ISO 32000-1 §7.3.3; PLRM §3.2.2, DSC 3.0; RFC 8259 §6; HP-GL/2 |
| I1–I4 | Typed values: a decimal comma is either accepted or refused loudly, never misread; unit suffixes and expressions are correct; locale display text is never re-parsed; imports accept `.5`, `-.5`, `5.` and exponents per their grammar | ECMA-262 `parseFloat`; ECMA-402; LightBurn Numeric Edits docs |
| U1–U4 | 25.4 mm/in, 96 px/in, 72 pt/in; ×60 once; degrees at SVG and DXF boundaries; % to S = p/100·`$30` | SVG 1.1 §7.10; DXF Reference; GRBL wiki |

## Method as run

- **Auditor A (subagent): G-code and controller encoders.**
  - Scratch Vitest probes ran on the real modules: the formatters, every strategy end to end, the resume, jog and setting-write builders, and the Ruida, Moshi and Lihuiyu encoders.
  - Each emitted line was checked against a GRBL word regex and the 80-character buffer.
- **Auditor B (subagent): file writers, imports, UI entry and unit factors.**
  - It ran export then import for 1e-7, 0.1+0.2, 12345.6785, -0 and 1e6 mm.
  - It sent decimal-comma, Arabic-Indic, unit and expression strings to every parse helper it found.
  - It listed every `toLocaleString` call that names no locale.
- **Refuter A (fresh subagent, different method).**
  - It drove projects through `prepareOutput` and `emitPreparedMoshiJob` / `emitPreparedGcode`.
  - It judged resume output with the independent laser-burn oracle over every restart line.
  - It fetched MeerK40t's `moshi/builder.py` and `driver.py` raw from GitHub and wrote its own GRBL `read_float`.
- **Refuter B (fresh subagent, different method).**
  - It imported through the real drop entry, `dispatchImportFilesInOrder` with the import worker.
  - It read ezdxf's tag compiler as an independent DXF reader.
  - It fuzzed `evaluateNumericEntry` with 200,000 strings.
  - It checked EPS bounding boxes on 300 random negative-coordinate polygons.
- **Research verifier (fresh subagent, web).** It checked 16 outside facts against primary sources: NISTIR 6556, the LinuxCNC docs, GRBL/grblHAL/FluidNC/Marlin source at their default branches, W3C SVG 1.1 and SVG 2, ISO 32000-1 (Adobe's public copy), RFC 8259, ECMA-262, the AutoCAD 2012 DXF Reference, the PLRM, DSC 3.0, the HP-GL/2 manual, LightBurn 2.1 docs, and MeerK40t's `ruida` and `moshi` sources.
- **Owner re-check.** This session read both P2s at 93c880722:
  - `src/core/controllers/moshi/moshi-program.ts` lines 47 and 57, and `moshi-job-encoder.ts` lines 121–133;
  - `src/io/dxf/dxf-entities.ts` lines 330–333 and 355–367;
  - `src/io/stl/parse-stl-ascii.ts` lines 61–63 and `parse-stl-blob.ts` line 138.

## Findings

### O8-P2-1 — Moshi flat-bed speeds ran at a different whole step with no note

**Where:**
- `src/core/controllers/moshi/moshi-program.ts:47` writes the vector speed as `Math.trunc` of mm/s, clamped to 1–256.
- Line 57 writes the raster speed as `Math.round(mm/s / 10)` cm/s, at least 1.
- `moshi-job-encoder.ts` added notes only above each byte's maximum.

**Reproduction** (refuter A, real pipeline, no advisory in any case):

| Layer | Set speed | Runs at | Dose |
|---|---|---|---|
| line | 599 mm/min (9.98 mm/s) | 9 mm/s | 111 % |
| line | 150 mm/min | 2 mm/s | 125 % |
| image | 1000 mm/min (16.7 mm/s) | 20 mm/s | 83 % |
| image | 900 mm/min | 20 mm/s | 75 % |
| image | 240 mm/min | 10 mm/s | 40 % |

**Oracle:** MeerK40t `moshi/builder.py`. The vector speed is a byte of mm/s − 1, clamped to 1–256 (`int(speed)`); the raster speed is a byte of round(mm/s ÷ 10) − 1. **VERIFIED** by the research verifier and again by refuter A. The bytes are right. What was wrong is that the dose changed with no word, even though the rotary path (ADR-705 Amendment 1) already warns outside 95–105 %. The Moshi route has no Job Review.

**Refuter:** CONFIRMED P2 (borderline). Lines at multiples of 60 mm/min are exact, and other line errors always run slower (overburn). Images can run up to 33 % faster in the 15–45 mm/s range, which gives a visibly lighter engrave.

**Fix:** [#1797](https://github.com/cisgz3a-hub/KerfDesk/pull/1797).
- One function per speed header (`moshiVectorSpeedMmS`, `moshiRasterSpeedCmS`) gives both the byte and the speed the note reports.
- The job adds a per-layer warning when the dose leaves 95–105 %.
- The bytes are unchanged; the ADR-705 golden still passes.
- ADR-705 Amendment 5.

### O8-P2-2 — A decimal comma in DXF and ASCII STL numbers was silently truncated

**Where:**
- `src/io/dxf/dxf-entities.ts:330-333` (`parseNumber`).
- The skip-and-report guard `hasUnreadableGeometry` (`:355-367`).
- `src/io/stl/parse-stl-ascii.ts:61-63` and `src/io/stl/parse-stl-blob.ts:138`.
- All of these used `Number.parseFloat`, which returns the longest numeric prefix.

**Reproduction** (refuter B, through `dispatchImportFilesInOrder` with the import worker):
- A DXF LINE to `12,5 / 7,25` imported at 12 × 7 mm instead of 12.5 × 7.25, with a success toast and `notes: []`.
- A CIRCLE of radius `2,5` imported at radius 2.
- `1.#QNAN` read as 1 and `-1.#IND` as −1.
- An ASCII STL `vertex 12,5 0 0` imported at x 12 ("Imported relief … at 12 × 7 mm").

**Oracle:** the AutoCAD DXF Reference calls codes 10–59 "double-precision floating-point" values. It never names the decimal separator, so on the separator the oracle is **UNSOURCED** and the finding is capped at P2. The independent implementation decides it: ezdxf's `tag_compiler` reads points with `float()` and raises `DXFStructureError` on such a value, refusing the file. ASCII STL has no formal standard; `float()`-style readers refuse the token the same way. Secondary evidence only: writers with a locale bug have produced such files (Templot forum; Fusion 360 Sheet Metal Toolbox reports).

**Refuter:** CONFIRMED P2, and wider than reported: the `1.#QNAN` and STL streamed paths are also affected. It checked that a strict whole-token reader accepts every legal spelling (` 12.5 `, `1.0E+02`, `+5`, `.5`, `-0`, `5.`, `1E2`). It recommended a regex over `Number()`, which reads `0x10` as 16 and `""` as 0.

**Fix:** [#1799](https://github.com/cisgz3a-hub/KerfDesk/pull/1799).
- `parseDecimalReal` (`src/core/util/decimal-real.ts`) reads the whole token or returns NaN.
- A DXF entity with such a value is skipped and named, like any non-numeric value (IMP-08).
- An ASCII STL is refused with the existing "Non-numeric vertex" error.
- ADR-357 Amendment 6.

### P3 findings

| ID | Where | Finding | Disposition |
|---|---|---|---|
| O8-P3-1 | `src/io/svg/export-svg-paths.ts:4-9` `svgNumber` | `String(value)`: every 90/180/270° rotation writes `matrix(6.123233995736766e-17 1 …)`, and a 1e-7 offset writes `1e-7`. Legal SVG; no named consumer misreads it, but simple CAM readers often do not accept exponents. | **Fixed #1801**: same exact value as a plain decimal |
| O8-P3-2 | `src/core/controllers/relative-jog-commands.ts:12-36` | The Marlin/Smoothieware jog wrote `G0 XNaN F1000` and `X1e+21`. Unreachable: UI presets are fixed, the feed is clamped, the phone path validates. | **Fixed #1801**: refuses non-finite words like the GRBL builder |
| O8-P3-3 | `src/io/postscript/ps-tokenizer.ts:195` | `8#19` read as 1 and `2#102` as 2 (`parseInt` prefix). PLRM §3.2.2: not a number. | **Fixed #1801** |
| O8-P3-4 | `src/io/project/refused-scene-object.ts:57` | Save refused a NaN vertex with "past the 1,000,000 mm a project file can hold". | **Fixed #1801**: "has a coordinate that is not a number" |
| O8-P3-5 | `moshi-program.ts:57` | MeerK40t truncates the raster speed to whole mm/s, then uses Python's half-to-even rounding. KerfDesk uses `Math.round(mm/s / 10)`. At 25, 45, 65 … mm/s KerfDesk writes one cm/s more (1500 mm/min: MeerK40t 20 mm/s, KerfDesk 30). | Listed for the maintainer: changes bytes |
| O8-P3-6 | `src/core/controllers/grbl/laser-resume-reentry.ts:234,285` | Resume rewrites the re-armed power with `toFixed(3)`. On fractional-`$30` machines (0.5, 2.5, 12.5, 0.255) the first resumed burn runs `S0.001` instead of `0.0005`, or `S4.162` instead of `4.1625`. 23 of about 102 restart lines diverge at `$30` = 12.5. The native resume path already restates the original text. | Listed: changes emitted G-code. A guard would be a `maxPowerS: 12.5` case in `resume-program.emitter-oracle.test.ts` |
| O8-P3-7 | `resume-program.ts:70`, `laser-resume-reentry.ts:59-60`, `resume-travel.ts:12` | The resume readers use `/([A-Za-z])(-?\d+(?:\.\d+)?)/`, so they miss `.5`, `-.5`, `+5` and `X 10`, which GRBL and `scanGcodeWords` accept. `G1 X20.5 Y-.5` re-enters at Y10. KerfDesk's own output (power scale version 4) never writes these spellings; only external programs and old version-2 snapshots can. | Listed: changes resume G-code |
| O8-P3-8 | `src/core/cnc/cnc-output-precision.ts:22` | CNC coordinates keep `-0.000` (a profile at y −1e-13 writes `Y-0.000`). The laser formatter, `surfacing.ts` and `probe.ts` normalise it. No redundant move reproduced. GRBL reads it as 0. | Listed: changes G-code spelling |
| O8-P3-9 | `non-finite-coords.ts:22`, `blocking-codes.ts:31` | The preflight non-finite check covers only X/Y/Z/I/J. F, S, A and `X1e+21` pass it, and `power-out-of-range` only warns. Unreachable: project load validates power, speed is checked as finite, and out-of-bed catches `X1e+21`. | Listed: changes what blocks a job |
| O8-P3-10 | `src/core/gcode/word-scan.ts`, `invariants/gcode-words.ts:1`, `src/__fixtures__/controllers/grbl-sim-gcode.ts:22` | The readers disagree with GRBL: `scanGcodeWords` reads `X1,5` as X1 (GRBL: error), and the preflight parser reads `X1e3` as 1000 (GRBL: X1 then an `E` word, error 20). The test GRBL simulator uses a digit-first pattern and cannot see the leading-dot words the CNC precision path writes. | Listed: test gap and reader policy |
| O8-P3-11 | `src/core/output/grbl-laser-lines.ts:28-29` | Power scale version 1 (non-GRBL dialects) rounds S, so a fractional max S can be exceeded (max 0.5 at 100 % gives S1). Those dialects have whole S ranges. | Listed: changes G-code |
| O8-P3-12 | `cnc-output-precision.ts:47` | `requestedCncCoordinateText` writes `1e-7` in `;` comments and Job Review text only, never in a word. | Listed: comment text only |
| O8-P3-13 | `src/core/gcode/word-scan.ts:29-56`, `src/io/gcode/gcode-program-line-parser.ts:148-150` | The 2D preview (`parseGcodeProgram`) silently draws `X1,5` as X1 and `X1e2` as X1, and accepts `Q7` without a note. The G-code Inspector, where a dropped file opens, does warn. | Listed: preview behaviour |
| O8-P3-14 | `src/io/svg/svg-geometry-length.ts:21` | SVG geometry with an unknown unit uses the numeric prefix: `r="2em"` gives radius 2 (a browser draws 32), `x="1,5"` gives 1. No note. | Listed: import behaviour |
| O8-P3-15 | `src/ui/design-studio/design-field-format.ts:61-70`, `ShapeInspectorField.tsx:35` | Design Studio has three comma policies. `SizeField` reads `1,234` as 1.234 and `0x10` as 16. The shape inspector replaces the first comma (`2,5in` is 63.5). `DesignDimensionFields` and the main numeric boxes refuse a comma with "use a dot for decimals". | Listed: UI policy (LightBurn's docs are silent on a decimal comma) |
| O8-P3-16 | `src/io/vector-formats/pdf-writer.ts:118-119` | `String(pt / userUnit)` can print an exponent (forbidden by ISO 32000-1 §7.3.3) only when the page scale factor is ≥ 101, a page side of about 508 m. A 900 m square gave 178 with no exponent. | Listed: latent |
| O8-P3-17 | `src/io/material-library/material-library-io.ts:77-79` | `thicknessMm: NaN` is exported as `null`, which KerfDesk's own import then refuses. A recipe `speed: NaN` is written as 1. No UI path reaches it. Not re-run by the refuter. | Listed: latent; overlaps area O9 |

## Refuted

None. Refuter B narrowed O8-P3-13 to the preview only (the Inspector warns) and corrected one attribution in O8-P3-15: `ShapeInspectorField` uses `evaluateNumericEntry` after replacing a comma, not `parseFieldNumber`. Refuter A could not reproduce the redundant zero-length move that auditor A claimed in O8-P3-8; the `-0.000` spelling itself reproduces.

## Verified clean

Each item has a reproduction in the auditor or refuter notes.

- **G-code words:**
  - Every strategy, dialect and `$30` listed in the headline writes only grammar-valid words. The only exceptions are tokens valid for their own firmware: Marlin `M5 I` and `M3 I S0`, and Smoothieware `fire off`.
  - No line is longer than 39 characters.
  - Arc radius error stays at or below 0.002 mm (GRBL allows 0.005).
  - `formatGcodeCoordinateMm` normalises `-0` and is symmetric for ±x, so the focus-test Z out-and-back nets zero.
- **S and units:**
  - 100 % gives `$30` exactly, and S never exceeds `$30` for 0–100 %.
  - Marlin inline S equals `round(p/100·255)`, and Marlin fan uses `M106 S0-255`.
  - Smoothieware uses fractions of 1.
  - KerfDesk never emits G20, and jog, frame and origin commands pin G21.
  - GRBL G4 P is in seconds. The Marlin reader treats P as ms and S as seconds.
  - Setting writes send `$30=1e3` as `1000` and block `1,5` and `NaN`.
- **Ruida, Moshi and Lihuiyu encoders:**
  - Ruida power at 100 % encodes as 0x3FFF, and NaN or negative power as 0. Random powers round-trip within half a step, and random 35-bit coordinates exactly.
  - Moshi and Lihuiyu positions are rounded on their own absolute grid, so there is no drift.
- **Project save:** a NaN or Infinity transform or vertex is refused before any bytes are written, and a file with a `null` vertex is refused on load, naming the field.
- **Main numeric entry** (`evaluateNumericEntry`):
  - It refuses `1,5`, `1.234,5`, `1 234`, `١٫٥`, U+2212, `Infinity`, `NaN`, `0x10`, an empty value and `1e400`, each with a message.
  - It reads `10mm`, `1in`, `1"`, `1e3`, `5.`, `.5` and `1/2in` correctly, and `100 mm/s` becomes 6000 mm/min, ×60 once.
  - A 200,000-string fuzz accepted no comma or Arabic separator.
- **Inch display:** a rounded inch value is not written back when the user leaves the box without editing.
- **Locale:** about 25 `toLocaleString` calls name no locale. All are display text; none is re-parsed or written to a file or to G-code.
- **SVG and DXF round trips:**
  - SVG export then import returns 1e-7, 0.1+0.2, 12345.6785 and −0 within the 1 µm grid.
  - DXF export writes `$INSUNITS 4`; 200 random rotated polylines up to ±1e5 mm came back within half the export grid.
  - On import, `$INSUNITS 1` scales by 25.4, and exponents are read correctly.
- **PDF, EPS and HPGL:**
  - PDF and EPS scale by 72/25.4 and write no exponent at realistic sizes.
  - `%%BoundingBox` is an integer box that contains the stroked drawing (300 random negative-coordinate polygons).
  - HPGL refuses an exponent and scales by /40.
- **Unit factors:** pt, CSS px, cm, PNG, TIFF and JFIF density, LightBurn mm/s ×60 and DXF degrees are all correct.

## Not verified and corrections

- **Research corrections to the oracle plan (plan wording, not code):**
  - **CONTRADICTED:** grblHAL's `read_float` keeps 9 digits and does not count leading zeros; `LINE_BUFFER_SIZE` is 257 and `RX_BUFFER_SIZE` 1024. Only GRBL and FluidNC count leading zeros against 8 digits.
  - **CONTRADICTED:** FluidNC's PWM spindle default `speed_map` is `0=0% 10000=100%` (`PWMSpindle.cpp` line 39), not 1000.
  - **VERIFIED with a correction:** GRBL's arc check (`gcode.c` lines 802–805) also has a 0.5 mm absolute term. The plan's ruling for G9 stands, because the emitted error is ≤ 0.002 mm.
  - RS274/NGC §3.3.2.1 gives the number grammar but never says "no exponent"; the ban is implied by the grammar.
  - Marlin bugfix-2.1.x replaced `strtof` with `dec_to_float` (#28715, 2026-10-25). Neither version accepts an exponent.
- **UNSOURCED:**
  - The DXF Reference's decimal separator (O8-P2-2 rests on ezdxf instead).
  - Any LightBurn statement on decimal-comma entry (LightBurn 2.1 documents equations in the Numeric Edits toolbar).
  - `%%HiResBoundingBox` (not in DSC 3.0).
  - Original HP-GL's integer-only parameters.
- **Not run:**
  - No Moshiboard, Ruida or GRBL hardware; simulators and decoders only.
  - EPS bounding boxes were checked with straight segments, not cubics.
  - O8-P3-17 was not re-run by the refuter.
