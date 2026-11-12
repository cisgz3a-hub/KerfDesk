# D5 — input boundaries (code quality audit C2)

**Question.** Is every untrusted input checked before it is used?
**Tree.** `origin/main` @ `420c5f547` (git archive `j31-main`), read-only. None of the cited files changed between `420c5f547` and `origin/main` @ `a74e38540`.
**Method.**
- Structured fuzzing from Node scripts on the real modules (`zz-d5/register.mjs` loader; jsdom's `DOMParser` for SVG and LightBurn XML).
- For each parser: valid seeds, boundary values (empty, huge, `1e999` → Infinity through `JSON.parse`, negative, deep nesting, long strings, unknown versions) and malformed inputs (truncation, wrong types, stray bytes, `__proto__` / `constructor` keys).
- Four checks per case: no uncaught throw; no hang (per-case timers, a 90 s watchdog for the project fuzz, `timeout` for single repros); no value that breaks a job later (every importer's object is dropped into a project, emitted as G-code and scanned for NaN/Infinity/exponent tokens, huge coordinates and S over `$30`); errors carry a message.
- Round trip: every project that loaded was saved and reloaded, and the second save compared byte for byte.
- No Vitest or browser run: free memory was 0.75–4.8 GB and the fuzzers themselves needed up to 2 GB; no hardware, network, live service or camera.

## Headline

Two P1s:
- **D5-P1-1 — SECURITY: CWE-835 / CWE-400 (denial of service from an imported file).** Redacted until fixed. A crafted file freezes the window for good; while a renderer-streamed job runs, that truncates the burn and leaves no reachable Abort. Details are in the D5 security notes named in the brief.
- **D5-P1-2 — a DXF ARC whose end angle is more than one turn past its start is drawn and burned as several turns.** A 0°→450° arc (a 90° arc in DXF terms) becomes a full circle plus a quarter, and burns 157 mm instead of 31 mm. A 0°→720° arc burns the same circle twice. Nothing is said.

Two P2s:
- **D5-P2-1:** an SVG with a negative viewBox width or height imports with inverted bounds. From then on, Save and autosave refuse the whole project until that object is deleted. Two viewBox readers disagree: one refuses the negative size, the other keeps it.
- **D5-P2-2:** a Fill object far larger than the bed, as a mis-scaled import makes it, is hatched in full before any bed check. A 200 m square runs output preparation out of memory, and the live estimate runs that preparation automatically.

Six P3s: unbounded `passes`/`linesPerMm` in project files (the MCP schema caps both), values the loader accepts that the compiler rejects with internal error text, unchecked device metadata, a second redacted security item (low impact, cancellable), G-code reader overflow, and raster decoders that size buffers from the header before their size check.

The rest held up well across about 566,000 generated cases:
- The project loader refused most mutations (81 % of the general fuzz) with a named reason, and never threw or hung while loading.
- No `__proto__` key polluted a prototype anywhere.
- Every project that loaded saved and reloaded byte-identical.
- Controller replies, MCP/phone commands, licence envelopes, link bytes and the `app://` project routes all came through clean.

## Inventory of input boundaries

| Boundary | Entry point and validator | Fuzz cases | Non-security findings |
|---|---|---|---|
| Project `.lf2` (load, migrate, validate, normalise, save, emit) | `deserializeProject` → `migrateToCurrent` → `validateProjectShape` → `normalizeProject`; `prepareProjectForPersistence`; `emitGcode` | 9,500 mutated files from 4 seeds: current small mixed, v19 file saved by 1.0.28 (migration), rotary raster, CNC. 4,000 + 3,000 general, 2,500 numeric-only | D5-P2-2, D5-P3-1, D5-P3-2, D5-P3-3 |
| Machine profile `.lfmachine` | `deserializeMachineProfileDocument` | 403 | none |
| Material library | `deserializeMaterialLibrary` | 402 | none |
| LightBurn `.lbrn2` / `.clb` | `importLightBurnProject`, `importLightBurnClb` (DOCTYPE/ENTITY refused) | 403 + 402 | none (see Not verified: deep nesting under jsdom) |
| SVG | `parseSvg` (sanitiser, `svg-import-budget` coordinate gate) | 600 (incl. 10 pathological: 5,000-deep groups, 300k-segment path, `<use>` fan-out, self-`<use>`, entity bomb, 1e300 sizes, 1 MB style, 1 MB data URI) | D5-P2-1 |
| DXF | `parseDxf` (expansion budget, range refusal) | 408 mutations + 6 pathological + 25 curve-extreme repros | D5-P1-2 |
| HP-GL | `parseHpgl` | 411 | none |
| EPS / PS / AI 3–8 | `convertPostscript` (`PS_LIMITS`) then `parseSvg` | 421 + 11 pathological | none |
| STL | `parseStl` (ASCII and binary, lying triangle counts, NaN/Inf floats) | 806 | none |
| G-code program reader / Inspector run review | `parseGcodeProgram`; `inspectGcodeText` + `reviewExternalProgram` | 1,513 + 6 targeted | D5-P3-5 |
| Raster decoders (headless and multi-file trace) | `decodePng`, `decodeJpeg` (pdf.js), `decodeBmp`, `decodePnm` | 1,592 | D5-P3-6 |
| Controller replies (GRBL, grblHAL, FluidNC, Falcon, Marlin, Smoothieware, Ruida, Lihuiyu, Moshi) | every driver's `classifyLine`; `parseStatusReport`, `parseCommaStatusReport`, `parseMarlinPositionReport`; `$$` collector → `settingsMapToProfilePatch` / `ControllerSettings`; `$I`; banners; firmware report; `$#`/`$G` readback; laser-module and home probes | 20,000 lines + 2,000 batches = 379,628 parser calls | none (2 refuted) |
| Ruida UDP replies, Moshi and Lihuiyu status bytes | `decodeRuidaReply`, `decodeRuidaMachineStatus`, `onRuidaResponse` (every byte × state), `moshiStatusCode/Text`, `lhyStatusName/Finished`, `lhyPayloads` | ~113,800 calls | none |
| MCP tool calls and phone relay commands | `mcpInputSchemas` through `mcpInputSchema` (the relay's `parseCommand` uses the same schemas) | 30,600 over 51 commands | none |
| Licence and update responses (stubbed with a local key pair) | `verifyEntitlement`, `verifyLicenceRelease` | 7,200 | none |
| Electron `app://` project routes, route guard, launch paths | `withDesktopProjectRoutes` with stubbed file access; `trustedAppRequest`; `isCanonicalPath`, `projectPathsFromArgv`, `projectPathsFromLaunchData` | 6,000 requests + 18 | none (token gate held) |
| Camera (network camera replies, URL gate) | `completeRtspDescribeResponse`, `rtspStatusCode`, `rtspChallenges`; `rtspCameraUrlPolicy`, `cameraFrameUrlPolicy`; frame body cap (READ) | 12,000 + 54 | none (1 KNOWN still open) |

The two SECURITY items are deliberately not mapped to rows.

## Findings

### D5-P1-1 — SECURITY: CWE-835 / CWE-400, denial of service from an imported file (redacted)

- **Where:** redacted.
- **Anchor:** PROJECT.md non-negotiable 9 (Abort reachable from any window state during a job); the code's own stated resource limit.
- **Evidence:** REPRO on `420c5f547` (redacted). Minimal inputs are a few bytes; one never returns (killed at 40 s), and a bounded variant holds the thread for an extrapolated ~24 min.
- **Scenario:** an operator opens or drops a file of the affected kind, from a download or a customer. The window stops answering for good and must be killed, losing work since the last autosave. If a GRBL-family, K40 or Moshi job is streaming from the renderer at the time, the stream stops part-way and the on-screen Abort, `Ctrl+.` and the job bar are unreachable.
- **Severity:** **P1**: loses work, and truncates a running job with Abort unreachable (the D1-P2-5 / D4-P1-1 non-negotiable 9 rating).
- **Announced?** No.
- **Novelty:** New.
- **Fix direction:** in the security notes; three small changes plus regression tests.

### D5-P1-2 — A DXF ARC more than one turn long is drawn and burned as several turns

- **Where:** `src/io/dxf/dxf-entities.ts:84-98` (`arcInOcs`). The sweep is `end − start`, raised only while it is ≤ 0 and never reduced to one turn. The ELLIPSE path in the same file clamps (`:285-287`, `Math.min(sweep, FULL_TURN)`), and so does `dxf-curve-sampling.ts:77-79`.
- **Anchor:** DXF ARC semantics. Angles are directions, so an arc runs counter-clockwise from the start direction to the end direction, once. ezdxf and AutoCAD read 0°→450° as a 90° arc. O2 verified only the end < start wrap.
- **Evidence:** REPRO `zz-d5/r10-dxf-arc-turns.mts` → real `parseDxf` → Line layer → `emitGcode`; r = 20 mm, so one turn is 125.66 mm:

  | ARC 50 → 51 | Should burn | Imported points | Burned |
  |---|---|---|---|
  | 0 → 90 | 31.4 mm | 13 | 31.41 mm |
  | 0 → 360 | 125.7 mm | 49 | 125.63 mm |
  | 0 → 450 | 31.4 mm (90°) | 57 | **157.04 mm** (450°) |
  | −360 → 90 | 31.4 mm (90°) | 57 | **157.04 mm** |
  | 0 → 720 | one circle | 97 | **251.26 mm** (two circles) |
  | 30 → 1110 | one circle | 145 | **376.89 mm** (three circles) |

  Every case has `preflight.ok = true` and no import note. An end angle far past the start makes the sampler emit points for every turn: 0 → 10⁷° gives 872,303 points (287 MB), and larger values run the reader out of memory.
- **Scenario:** a DXF from a CAM or CAD exporter writes un-normalised arc angles, such as an end angle of 450 for 90. A quarter arc imports as a full circle plus a quarter. The canvas shows a closed circle where the design has an opening, and the laser cuts the part out along a path the drawing does not have. An arc written past a full turn is cut twice or more, so the kerf over-burns there.
- **Severity:** **P1** (METHOD §3, no reach clause): a silently wrong shape and burn, the same class as O2-P1-1 (DXF SPLINEs in the wrong shape). Reach is low; most exporters normalise to [0°, 360°).
- **Announced?** No.
- **Novelty:** New. O2 checked only "end < start wraps through 0°".
- **Fix direction:** reduce the sweep to (0, 2π] arithmetically (modulo, with equal angles meaning a full turn), as the ELLIPSE path already clamps. Add regression cases 0→450 (90°), −360→90 (90°), 0→720 (one circle) and 30→1110 (one circle).

### D5-P2-1 — An SVG with a negative viewBox size imports, then blocks Save and autosave for the whole project

- **Where:**
  - `src/io/svg/svg-units.ts:72-84` (`parseViewBoxRect`) keeps a negative width or height and returns `maxX = x + w < minX`; `resolveUnitScale` (`:40-60`) turns that into the object's bounds.
  - `src/io/svg/svg-viewport.ts:66` (`parseViewBox`) refuses the same viewBox (`width < 0 || height < 0 → null`), so `svg-root-viewport.ts:38-39` falls back to those inverted `units.bounds`.
  - The project validator refuses them: `src/io/project/project-bounds-validator.ts:15-18`.
- **Anchor:** SVG 1.1 §7.7: a negative viewBox width or height is an error and disables the viewBox. The project's own rule that every stored object round-trips (`prepare-project-persistence.ts:6-8`).
- **Evidence:** REPRO `zz-d5/r9-svg-negative-viewbox.mts` (real `parseSvg`, jsdom):
  - `viewBox="0 0 100 -80"` imports with no note, with bounds `{minX:0,minY:0,maxX:100,maxY:-80}`, and emits correct G-code.
  - `prepareProjectForPersistence` then answers `invalid: object 1 (imported from "negHeight.svg") cannot be stored (… minY must be <= maxY)`.
  - `prepareProjectForAutosave` gives the same answer, and so does the width case.
  - Found by F3 (`out/f3-reload-fail-svg-mut159.txt`, `…mut179.txt`).
- **Scenario:** an operator imports a malformed SVG (hand-edited, or from a converter that writes a negative height for a flipped Y) and keeps working. From that moment autosave fails on every tick, so a crash loses everything since the import. Save is refused until the operator finds and deletes that one object; the message names it, but not why its file is wrong.
- **Severity:** **P2**: no silent loss (Save names the object, and D4 found that autosave toasts its failures), but crash protection is gone and the project cannot be saved until the object is removed.
- **Announced?** No; the import says nothing.
- **Novelty:** New as a defect. `2026-08-30-ten-loop-repo-audit/loop-02` named "no negative/zero-dimension validity rule" in `svg-units.ts` as a parser edge case for a later loop; it was never ledgered or traced to Save.
- **Fix direction:** one viewBox reader: `svg-units.ts` should use `parseViewBox` (negative → no viewBox, as SVG says) and fall back to the width/height path. Add an import test with bounds and a Save round trip.

### D5-P2-2 — A Fill object far past the bed is hatched in full before any bed check, and preparation runs out of memory

- **Where:**
  - `src/io/gcode/prepare-output.ts:120` compiles every Fill hatch first.
  - The bed check comes later, at emission (`emit-gcode.ts` preflight).
  - `src/core/preflight/compiled-work.ts:84-110` only advises (ADR-243).
  - The project limit is ±1,000,000 mm (`project-shape-primitives.ts:4`), and imports use the same limit (`imported-artwork-range.ts:45`).
- **Anchor:** "Never yields a value that later breaks a job"; ADR-243 runs any job size, but this artwork is not on the bed at all.
- **Evidence:** REPRO `zz-d5/r4-big-fill.mts`: one Fill square on the default 400 × 400 bed, 0.1 mm hatch, through the real load and `prepareOutput`:
  - 390 mm square: ok, 35 ms;
  - 4,000 mm: `ok=true, issues=[]`, 117 ms;
  - 40,000 mm: `ok=true, issues=[]`, 840 ms, 376 MB heap;
  - 200,000 mm: **V8 out of memory** at the 1.5 GB limit.

  The numeric project fuzz hit the same crash from one scaled coordinate (`out/f1-watch-3.txt`, cases 813 and 1310). READ: the live job estimate calls `prepareOutput` on its own (`ui/laser/live-job-estimate.ts:82-86, 111-113`), on the UI thread or a worker, and a V8 out-of-memory in either ends the renderer process.
- **Scenario:** a DXF or SVG in the wrong units (µm read as mm makes a 300 mm design 300 m) is put on a Fill layer. The estimate starts preparing at once and the window crashes; when it reopens, the project still holds the object.
- **Severity:** **P2**: a crash that loses work since the last autosave, from a plausible mistake. The object is visibly off the bed, which limits the harm.
- **Announced?** No; the "Large program" advisory is never reached.
- **Novelty:** New.
- **Fix direction:** check placed Fill and Image extents against the bed (or a hard multiple of it) from object bounds before hatching, and refuse with the existing out-of-bed message. Or cap hatch lines per group by bed-relative extent. Add a test: a 200 m Fill square is refused in milliseconds.

### D5-P3-1 — Work-multiplying layer fields have no upper bound in project files

- **Where:** `src/io/project/project-layer-shape-validator.ts:45` (`passes`: positive integer, no maximum) and `:65` (`linesPerMm`: positive number). The MCP schema caps both (`electron/mcp/design-schemas.ts:65,71`: `passes ≤ 1000`, `linesPerMm ≤ 100`); the UI field has `min={1}` only (`CutSettingsCommonFields.tsx:47`).
- **Evidence:** REPRO `zz-d5/r3-stall.mts small scene.layers.0.passes <n>`:
  - 100,000 passes loads, prepares in 11 ms, and emits 13.7 MB in 3.1 s;
  - 2,147,483,648 loads, prepares in 9 ms, then emission runs out of memory.

  `linesPerMm` 10⁶–2³¹ on an Image layer stalled or crashed the same way (watchdog log `out/f1-watch-3.txt`).
- **Severity:** P3. A crafted or absurd value; Job Review's "Large program" advisory (ADR-243) does announce it before emission.
- **Fix direction:** physical caps in the project reader and the layer fields, matching the MCP schema.

### D5-P3-2 — The loader accepts values the compiler rejects with internal error text

- **Where:**
  - a transform scale of 0 passes `project-shape-primitives.ts:60` (`|scale| ≤ 100,000`, no lower bound);
  - a curve `radiusX` of 1e300 is not a coordinate, so the range gate does not see it;
  - a bed of 1e300 passes `requirePositiveNumber`.
- **Evidence:** REPRO `r3-stall.mts`:
  - `rotary scene.objects.0.transform.scaleY 0` loads `ok`, then emission throws `emitRasterGroup: bounds must be positive` (`core/raster/emit-raster.ts:337`);
  - `device.bedHeight 1e300` throws the same;
  - F1 found a 1e300 radius throwing `Canonical curve flattening exceeded the JavaScript safe-integer budget.` (`core/job/compilation-polylines.ts:30`);
  - a line object with scale 0 emits a degenerate 192-byte program with `preflight.ok = true`.

  The UI shows the thrown text (`output-preparation-errors.ts`), so the error is reported but cryptic.
- **Severity:** P3.
- **Fix direction:** reject zero scales, out-of-range curve radii and absurd beds in `validateProjectShape`, with a message that names the object.

### D5-P3-3 — Device metadata fields pass through project load unchecked

- **Where:** `src/io/project/deserialize-project.ts:316-318` copies the rest of `device` (`...current`). `profileId`, `vendor`, `model`, `profileSource`, `catalogVersion` and `evidence` are never type-checked, while the machine-profile reader checks every one of them.
- **Evidence:** REPRO `zz-d5/r6-device-metadata.mts`, through the real project loader and machine-profile serializer/reader around the body of `activeProfileDocument` (`MachineSetupImportExport.tsx:222-234`):
  - `evidence` = `5`, `"text"` or `{}`: the project loads; Export throws `profile.evidence?.map is not a function`;
  - `evidence` = `[7]`, `profileId` = `42`, `profileSource` = `{…}`, `vendor` = `["a"]`, `model` = `null`: Export writes a file that KerfDesk's own Import refuses (`reviewNotes must be an array of strings`, `profile.profileId must be a non-empty string`, …).
- **Severity:** P3; no job effect.
- **Fix direction:** reuse the machine-profile field checks for these keys in `normalizeDevice`, dropping a bad value to the default.

### D5-P3-4 — SECURITY: CWE-835, unbounded loop on a crafted file (redacted)

- **Where / Evidence:** redacted; REPRO on `420c5f547`, killed at 30 s.
- **Severity:** P3. The reader runs off the UI thread and Esc cancels it, so the window stays usable.
- **Fix direction:** in the security notes.

### D5-P3-5 — The G-code program reader turns overflowing numbers into Infinity and NaN

- **Where:** `src/io/gcode/parse-gcode-program.ts` / `gcode-program-line-parser.ts` (used by `io/cnc/cnc-program-geometry.ts` and `executable-plan-parity.ts`).
- **Evidence:**
  - F3 (`out/f3-gcode.txt`): `G1 X` followed by 400 digits gives `polyline.x = Infinity` and `totalLength = Infinity`; an overflowing arc centre gives NaN points. 17 cases.
  - REPRO `zz-d5/r2-gcode-overflow.mts` through the real Inspector and Run review (`inspectGcodeText` with `runReview`):
    - an overflowing X is skipped with a clear warning (good);
    - an overflowing `I` on a `G2` is drawn and reviewed with no note;
    - an overflowing `F` or `S` passes silently.

  The slowest case was a 100,000-character line of `(` at 6.1 s.
- **Severity:** P3. Real programs do not carry 300-digit numbers; how GRBL runs such an arc is unverified.
- **Fix direction:** treat a non-finite word value as an unreadable word, as the Inspector already does for X/Y/Z.

### D5-P3-6 — Raster decoders size buffers from the header before their size check

- **Where:**
  - `src/io/raster-decode/decode-png.ts:42-45` allocates `width × height × 4` before learning that the data is short;
  - `decode-jpeg.ts:35-36` calls pdf.js `JpegImage.parse` before `assertRasterSize`.

  Both are used by the headless trace and the multi-file trace (`ui/commands/multi-file-trace-action.ts`).
- **Evidence:** REPRO `zz-d5/f10-raster.mts`:
  - a 68-byte PNG claiming 16384 × 16384 pixels takes 1,074 MB before `The PNG image data is truncated`;
  - a 23-byte JPEG header claiming 65535 × 65535 pixels grew ArrayBuffer use by ~12.8 GB (lazily committed in Node) before the refusal;
  - 22 corrupt-IDAT PNGs were refused with a bare `TypeError` (Node's `DecompressionStream`; the browser's message was not checked).
- **Severity:** P3 (memory pressure, cryptic text).
- **Fix direction:** check the declared size against the limit and against the bytes present before allocating, and read JPEG SOF dimensions before calling `parse`.

## KNOWN (not re-raised)

- **rolling v2 area 04 (electron-main) P3-9:** a security-class host-gate item, cited by ID only. It still reproduces on `420c5f547` for one URL scheme (F9). Ruida targets are not affected.

## Refuted

- **A huge `$30` produces huge S words.** `$30=1e21` makes a 30 % layer emit `S300000000000000000000` (`r1-huge-maxpower.mts`). That is 30 % of the range the controller itself reported, so it is consistent, not a defect. Every `$$` value that reaches a patch is finite and positive (`$30=0` is kept apart as `maxPowerSReportedAsZero`).
- **Status, alarm and substate numbers of 300+ digits parse to Infinity** (`ALARM:1000…`, `<Door:1000…>`). This is cosmetic: an unknown alarm code, never used as a coordinate. Axis, feed and buffer fields use `parseCanonicalStatusNumber`, which refuses non-finite values.
- **The 1M-line EPS runs out of memory.** Conversion takes 1.0 s and 459 MB (`r5-ps-many-lines.mts`); only jsdom's SVG parse ran out of memory. The reader's 2M-point cap refuses 1.9M lines in 0.7 s.

## Verified clean

- **Project load:**
  - 9,500 mutated files: 0 throws, 0 load hangs, 0 prototype pollution;
  - every `invalid` result carried a reason;
  - every loaded project saved and reloaded byte-identical (0 unstable, 0 reload failures);
  - schema versions −1…24, 23.5, `1e999` and `"23"` were all handled;
  - migration from v19 (1.0.28) was fuzzed through the same checks.
- **Project emission:**
  - no NaN, Infinity, exponent or `undefined` token in any emitted line;
  - every out-of-bed coordinate came with `preflight.ok = false`, except where the mutation enlarged the bed itself;
  - S never exceeded the device's `maxPowerS`.
- **Controller replies:**
  - 379,628 parser calls with no throw, except `parseFirmwareReport`'s deliberate refusals, which the console shows (`MachineProtocolInventory.tsx:58-61`);
  - status vectors accept only canonical decimals, and malformed `MPos`/`Bf`/`Ov` fields give null;
  - pathological 1 MB lines parse in < 250 ms.
- **Ruida, Moshi and K40 bytes:**
  - Ruida replies decode to 35-bit values in range;
  - a NAK storm fails the session after 4 retries;
  - unknown bytes change nothing.
- **MCP and phone:**
  - 30,600 argument sets;
  - zod rejects Infinity (`1e999`), out-of-range values and unknown or `__proto__` keys;
  - nothing non-finite was accepted.
- **Licence and release identity:**
  - only claims that are well-formed under a valid Ed25519 signature are accepted;
  - wrong key, flipped signature bit, `__proto__`/`constructor` key IDs and non-canonical base64 are all refused (7,200 cases).
- **`app://` project routes:**
  - no request reached the file stub without main's token for that exact path;
  - Windows launch paths refuse `..`, relative paths and alternate data streams;
  - argv is capped at 16 paths;
  - launch data with a `__proto__` key gives no paths.
- **Camera:**
  - the RTSP DESCRIBE framer refuses oversized headers and bodies and an invalid `Content-Length` with typed errors;
  - status and challenge parsing never threw (12,000 calls);
  - frame bodies are capped at 8 MB while streaming (`camera-frame-body.ts`, READ);
  - the http(s) camera gate refuses public, mapped and decimal or hex IPv4 spellings after WHATWG normalisation.
- **Other readers:** HP-GL, STL (lying triangle counts, NaN/Inf floats), machine profile, material library and LightBurn `.clb`/`.lbrn2` (DOCTYPE/ENTITY refused) were clean. SVG and EPS-via-SVG extreme coordinates are refused with a message that the import toast shows (`svg-import-action.ts:51-55`).

## Not verified

- No browser run (memory gate). The renderer-level effect of the out-of-memory cases (D5-P2-2, D5-P3-1, the D5-P1-2 extreme) was seen in Node only.
- A 5,000-deep `<Shape Type="Group">` / `<Material>` nesting overflowed the stack inside jsdom's `HTMLCollection`; a browser `DOMParser` was not tried, and the open path's handling of a `RangeError` was not traced.
- How a GRBL controller runs a `G2` with an overflowing centre (D5-P3-5).
- PDF import (pdf.js), TIFF and PSD decoding, and in-app camera frame decoding were not fuzzed. TIFF's `fflate` dependency does not resolve from the archive tree.
- Electron routes other than the project routes (support, AI, ArtCraft, machine-network, Ruida network) were read, not fuzzed. The Ruida target check (`isIP === 4` plus the private-host gate) was read.
- The D5-P1-1 effect on a live renderer-streamed job is from READ (streaming runs in the renderer) plus the measured hang, not a simulator run.

## Repro files

All are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d5\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file>`. The files for the two security items are not listed here.

| File | What |
|---|---|
| `lib.mts` | shared generators and checks (PRNG, boundary values, G-code scanner) |
| `f1-project.mts`, `watch.sh` | project fuzz (`<cases> <seed> - [numeric] [start]`), watchdog with resume |
| `f2-controller.mts` | controller reply parsers |
| `f3-artwork.mts` | SVG, DXF, HP-GL, PS, STL, G-code, LightBurn, machine profile, material library |
| `f4-mcp.mts` | MCP / phone schemas |
| `f6-link-bytes.mts` | Ruida, Moshi, K40 bytes |
| `f7-licence.mts` | licence and release envelopes (local key pair) |
| `f8-app-routes.mts` | `app://` project routes and launch paths |
| `f9-camera.mts` | RTSP replies and camera URL gates |
| `f10-raster.mts` | PNG, JPEG, BMP, PNM decoders |
| `r1-huge-maxpower.mts` | `$$` → profile → S words (refuted) |
| `r2-gcode-overflow.mts` | D5-P3-5 |
| `r3-stall.mts` | D5-P3-1, D5-P3-2 (`<seed> <json-path> <value>`) |
| `r4-big-fill.mts` | D5-P2-2 (`<sideMm>`) |
| `r5-ps-many-lines.mts` | refuted EPS out-of-memory |
| `r6-device-metadata.mts` | D5-P3-3 |
| `r8-dxf-bulge.mts` | DXF bulge and ellipse extremes (clean) |
| `r9-svg-negative-viewbox.mts` | D5-P2-1 |
| `r10-dxf-arc-turns.mts` | D5-P1-2 |
| `out/` | run logs, findings JSONL, stall and crash cases |

```json
{
  "area": "D5",
  "id": "input-boundaries",
  "tree": "origin/main@420c5f547",
  "cases": 566000,
  "findings": [
    {"id": "D5-P1-1", "severity": "P1", "security": true, "summary": "SECURITY: CWE-835/CWE-400 denial of service from an imported file (redacted)", "evidence": "REPRO", "known": false},
    {"id": "D5-P1-2", "severity": "P1", "file": "src/io/dxf/dxf-entities.ts", "line": 91, "summary": "DXF ARC sweep not reduced to one turn: 0->450 burns 450 deg, 0->720 burns the circle twice, silently", "evidence": "REPRO", "known": false},
    {"id": "D5-P2-1", "severity": "P2", "file": "src/io/svg/svg-units.ts", "line": 72, "summary": "negative SVG viewBox imports with inverted bounds; Save and autosave then refuse the project", "evidence": "REPRO", "known": false},
    {"id": "D5-P2-2", "severity": "P2", "file": "src/io/gcode/prepare-output.ts", "line": 120, "summary": "Fill far past the bed hatched before any bed check; 200 m square runs preparation out of memory", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-1", "severity": "P3", "file": "src/io/project/project-layer-shape-validator.ts", "line": 45, "summary": "passes and linesPerMm unbounded in project files (MCP caps 1000/100); emission runs out of memory", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-2", "severity": "P3", "file": "src/io/project/project-shape-primitives.ts", "line": 60, "summary": "zero scale, huge radius and huge bed load, then emission throws internal error text", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-3", "severity": "P3", "file": "src/io/project/deserialize-project.ts", "line": 316, "summary": "device metadata unchecked; Machine Setup export throws or writes a profile Import refuses", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-4", "severity": "P3", "security": true, "summary": "SECURITY: CWE-835 unbounded loop on a crafted file, cancellable (redacted)", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-5", "severity": "P3", "file": "src/io/gcode/parse-gcode-program.ts", "line": 12, "summary": "overflowing G-code numbers become Infinity/NaN; Inspector reviews an overflowing arc centre with no note", "evidence": "REPRO", "known": false},
    {"id": "D5-P3-6", "severity": "P3", "file": "src/io/raster-decode/decode-png.ts", "line": 45, "summary": "PNG/JPEG decoders allocate from header dimensions before the size and data checks", "evidence": "REPRO", "known": false}
  ],
  "known": ["rolling-v2 04-electron-main P3-9 (still open)"],
  "refuted": ["huge $30 S words", "300-digit status/alarm numbers", "1M-line EPS OOM (jsdom only)"]
}
```

Auditor counts: raised 10, P1 2, P2 2, P3 6, known 1

## Refuter (2026-11-12)

**Tree.** `origin/main` @ `420c5f547` (`j31-main`, read only, not edited).
**Harness.**
- Own scripts in `scratchpad\zz-d5r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>`. This is the auditor's loader, copied.
- `register-r.mjs` / `ts-resolve-r.mjs` add two aliases: `fflate` (so TIFF resolves from the archive tree) and an `electron` stub (`app.once` only).
- jsdom provides `DOMParser` for SVG.
- Every case ran under `timeout` or a per-case `Promise.race` timer, with `--max-old-space-size=1500`.
- No Vitest or browser run: free memory was 3.4–3.9 GB, and the browser gate was not needed for any verdict.
- No hardware, network, live service, download or pnpm.

### Verdicts

| ID | Verdict | Severity |
|---|---|---|
| D5-P1-1 | CONFIRMED, with impact corrected | P1 kept |
| D5-P1-2 | CONFIRMED | P1 kept |
| D5-P2-1 | Save/autosave block REFUTED on every main import route; parser defect CONFIRMED | **P2 → P3** |
| D5-P2-2 | UI-thread and "plausible import" path REFUTED; no bed-relative hatch cap CONFIRMED | **P2 → P3** |
| D5-P3-1 | CONFIRMED | P3 |
| D5-P3-2 | CONFIRMED | P3 |
| D5-P3-3 | CONFIRMED (load half re-run) | P3 |
| D5-P3-4 | CONFIRMED, and a sibling loop also hangs | P3 kept |
| D5-P3-5 | CONFIRMED | P3 |
| D5-P3-6 | CONFIRMED | P3 |

**D5-P1-1 — SECURITY: CWE-835 / CWE-400 (redacted). CONFIRMED, P1.**
- Own minimal repros: four never-returning variants, each killed by `timeout 30`, and a budget-respecting control that ends in 260 ms. One variant is new and reaches the same fault by a different input; another shows a second import route is affected too. Details are in the refuter's security notes.
- **UI thread: yes.** By READ, the reader is called synchronously on the window thread. There is no worker, wall-clock limit, cancel control or size gate. The only bound is the step budget, which the payloads never reach.
- **"Abort unreachable": confirmed. "Truncates the burn": true only on window-streamed routes.**
  - By default, GRBL-family and Marlin connections stream from a worker (`src/ui/state/hosted-stream-acks.ts:15-18`). There the job is not truncated: it runs to its end with Abort, `Ctrl+.` and the job bar unreachable.
  - K40, Moshi and window-route GRBL (Background streaming off, adapter not unique, no worker) are refilled by the window thread, so they stop part-way. Under M3 they then hold the last power over the stopped head, as the app's own lit-stop warning says (`window-stream-lit-stop-warnings.ts:1-14`).
  - A hang never fires `render-process-gone`, so main's crash stop (`electron/renderer-crash-recovery.ts:103-105`) does not run. Electron's `unresponsive` event only arms the close guard (`electron/window-close-guard.ts:56`).
- **"Loses work":** outside a job, at most one 30 s autosave interval (`use-autosave.ts:4`). During a job, a heavy project's autosave is held until the job ends (`autosave-job-gate.ts`), so the loss can be the whole job's edits. The harm to a running job alone carries P1.

**D5-P1-2 — DXF ARC more than one turn. CONFIRMED, P1.**
- Own repro `q1-dxf-arc-sweep.mts` (r = 10 mm, real `parseDxf` → project → `emitGcode`). Every case had `preflight.ok = true` and no import note:

  | ARC 50 → 51 | Should burn | Burned |
  |---|---|---|
  | 0 → 90 | 90° | 89.9° |
  | 0 → 450 | 90° | 449.7° |
  | 90 → 810 | one circle | 719.6° |
  | 45 → 1485 | one circle | 1439.2° |
  | 0 → 450, extrusion −Z | 90° | 449.7° |
  | −720 → −630 | 90° | 89.9° (correct) |
  | −90 → 90 (FreeCAD-style) | 180° | 179.9° (correct) |

- The native curve has the extra turns too (5 segments for 0→450), so canvas and burn agree on the wrong shape.
- **Real-world reach: NOT VERIFIED.**
  - The repo quotes no DXF ARC range rule. O2 cites only "ARC degrees are counter-clockwise", and no code comment names an exporter that writes end angles past 360.
  - The auditor's "ezdxf and AutoCAD read 0°→450° as 90°" has no in-repo evidence, and could not be checked offline (no ezdxf installed; nothing downloaded).
  - KerfDesk's own DXF writer emits bulges, not ARCs, so its round trip cannot produce the case.
- **Severity: P1 stands** (METHOD §3, no reach clause). A DXF ARC is a single arc of at most one turn, so 0→720 cut twice is wrong under any reading. A silent wrong burn is the O2-P1-1 class.

**D5-P2-1 — negative SVG viewBox. Severity change P2 → P3.**
- Own repro `q2-svg-negvb-store.mts` drives the real app path: `importSvgFiles` → real store `importSvgObject` / `importSvgFragment` → bed fit → real `prepareProjectForPersistence` / `prepareProjectForAutosave`.
  - **Object route** (no `importFragment`): the auditor's result reproduces. `0 0 60 -40`, `0 0 -60 40` and `10 10 -60 -40` import with a success toast and no note. Save and autosave then refuse, naming the object.
  - **Fragment route:** all three import with bounds built from the geometry (`{5,5,25,15}`, the same as the control). Save and autosave are **ok**.
- **The main routes all use the fragment route:** drag and drop (`use-import-drag-drop.ts:27,62`), the Import command (`file-command-context.ts:94-100`), the unified Import (`import-dispatch.ts:142,235`), EPS/AI 3–8 (through the dispatch) and ArtCraft (`apply-studio-snapshot.ts:46`).
  - The worker parser returns the same fragment (`parse-svg-worker.ts` → `parseSvgDocument`).
  - The PDF "paths" mode commits `parsed.object`, but pdf.js normalises the page box, so its viewBox is never negative. C1 found 0 inverted bounds in 861 PDF imports.
- **Remaining reach:** the registration-jig artwork import (`JigArtworkImport.tsx:63`) passes no `importFragment`, so the inverted bounds reach the jig draft. Its persistence was not traced.
- Toast: the import reports plain success; the Save refusal names the object.
- The parser defect (two viewBox readers disagree) is real, so the item stays as P3.

**D5-P2-2 — huge Fill hatched before the bed check. Severity change P2 → P3.**
- Own repro `q3-big-fill-gates.mts`. Two upstream guards the auditor missed:
  - **The import bed fit scales the mis-scaled import down.** A 200,000 mm square is fitted to 90 % of the 400 mm bed (scale 1.8e-3). A 4,000 mm square gets 0.09. The notice offers Undo (`ui/state/import-bed-fit.ts:22-62`, ADR-125 Amd 1). Only relief heightfields keep their authored scale.
  - **The live estimate does not prepare on the UI thread when Workers exist.** `classifyCanvasPreparation` and `ordinaryOutputPrefersWorker` send the 200 m, 4 m and even the 390 mm Fill to the preparation worker. `estimateLiveJob` returns `too-large` in 0–5 ms on the window thread. `useSettledEstimate` then starts the worker request automatically, 250 ms after the edit (`use-job-estimate.ts:226-260`).
- **Still true:** nothing caps the hatch by bed-relative extent before compiling, so a 200 m Fill reached by Undo of the fit, a typed size, a project file or MCP runs the preparation worker out of memory (D5's Node result).
- Whether a dedicated-worker OOM ends the Electron renderer, or only the worker, is NOT VERIFIED (no browser run). The auditor's "a V8 out-of-memory in either ends the renderer process" is unproven for the worker case.
- With the plausible path gone and the harm unverified, this is the same class as D5-P3-1 (an absurd value): P3. It would go back to P2 if a browser run shows a preparation-worker OOM takes the window down.

**D5-P3-1 to D5-P3-6.** `q4-p3s.mts` covers P3-1, -2, -3, -5 and -6; P3-4 has its own security repro.
- **P3-1 CONFIRMED.** `passes` 1001 and 50,000 load. 50,000 emits 6.8 MB in 730 ms. `linesPerMm = 1e7` loads `ok`.
- **P3-2 CONFIRMED.**
  - `scaleX 0` on a Line object loads and emits a 191-byte program with `preflight.ok = true`.
  - `bedHeight 1e300` on a Line project gives `preflight.ok = false`, not a throw. The throw the auditor saw is on the raster/rotary seed. Both are P3.
- **P3-3 CONFIRMED** (load half): `evidence` = `5` / `"x"` / `[7]` / `{}` and `profileId = 42` load and are kept as is. The Export half was not re-run.
- **P3-4 — SECURITY: CWE-835 (redacted). CONFIRMED, P3.**
  - The case is killed at 20 s; controls return in 2–3 ms.
  - A sibling loop in the same reader, which the auditor marked "not driven", also never returns. Details are in the refuter's security notes.
  - The parse runs in the import worker, and Esc retires it (READ).
- **P3-5 CONFIRMED.** A 400-digit X gives `Infinity` length; a 400-digit `I` on a G2 gives NaN/Infinity points; a 400-digit `F` or `S` is accepted silently.
- **P3-6 CONFIRMED.** A 65-byte PNG claiming 16384 × 16384 grew ArrayBuffers by 1,074 MB before `The PNG image data is truncated.`

### Coverage challenges

| Boundary | Cases | Result |
|---|---|---|
| **PDF import (C1)** | 2,100 generated PDFs over 3 seeds. Real pdf.js 6.3.289 (legacy build, fake worker) → `getOperatorList` → real `pdfVectorPage` → real `parseSvg` → project → Save preparation + `emitGcode`. Mutations: boundary and 400-digit numbers, singular/huge `cm`, unbalanced `q`/`Q`, unknown operators, zero/inverted/huge MediaBox, `/Rotate`, `/UserUnit`, `/CropBox`. | **Clean.** 861 imported. The rest were refused with a named reason: mixed colours, page edge, invalid coordinate, unbalanced state, extreme-coordinate gate and others. 0 non-finite SVG or object values, 0 inverted bounds, 0 Save refusals, 0 bad G-code, 0 timeouts or slow cases. |
| **TIFF (C2)** | 3,000 cases over 2 seeds through real `tiffPageCount` + `decodeTiffPage` (tiff 7.1.3 + fflate). Seeds: LE/BE, RGB, gray, 1-bit, 16-bit, Deflate, alpha, orientations 3/6/8, two pages. Mutations: byte flips, 32-bit boundary overwrites, truncation, IFD pointer rewrites, insertions. | **Clean.** 155 decoded, 2,845 refused with plain messages. 0 internal-text errors, 0 size mismatches, 0 allocations over 300 MB, 0 slow cases. |
| **PSD (C2)** | 3,000 cases through real `decodePsdComposite` (ag-psd), with raw/RLE, gray/RGB and merged-alpha seeds. | **Clean.** 272 decoded, the rest refused with plain messages. |
| **Electron routes (C4)** | 16,000 generated requests on the real `withSupportRoutes`, `withAiRoutes`, `withMachineNetworkRoutes` and `withRuidaNetworkRoutes`. The log, runtime and bridges are stubs; the network stubs call the real target validators. | **Clean.** No request reached a stub without passing the app-route guard, no key or path was reflected, nothing threw or hung, and no prototype was polluted. The Ruida gate admitted only private dotted IPv4. The 16 rows the harness flagged are false positives: `Headers` trims `" 1"` to `"1"`, as Chromium does. One informational security-class observation is in the refuter's security notes, not raised. |
| **Deep LightBurn nesting (C3)** | Through the import worker's own parse function (saxes + linkedom + `importLightBurnProject` / `importLightBurnClb`). | Not clean: see **D5-P3-7**. |

Coverage weakness: mutated TIFF and PSD files decoded only 5–9 % of the time, so the decode paths past the structure checks saw a few hundred cases each.

### New findings

**D5-P3-7 — The LightBurn depth limit is measured recursively, so deep nesting overflows the stack before the limit is checked, and the toast shows the engine's text.**
- **Where:** `src/io/lightburn/lbrn-import.ts:166-170` and `src/io/lightburn/clb-import.ts:327-331`. `xmlDepth` recurses over every child with no early exit, before the `MAX_XML_DEPTH = 64` refusal (`lbrn-import.ts:66`, `clb-import.ts:46`).
- **Evidence:** REPRO `c3-lbrn-deep.mts` through `parseDocumentImportText`, the worker's own code. The table below is the `.lbrn2` result; `.clb` gives the same result at every depth.

  | Depth | Result |
  |---|---|
  | 70 or 1,000 | `LightBurn XML nesting is too deep.` (correct) |
  | 5,000 | `RangeError: Maximum call stack size exceeded` in 219 ms |
  | 20,000 | the same `RangeError`, in 3.9 s |
  | 100,000 | still running at 60 s |

  - The worker returns the message (`document-import-worker.ts:20-25`), and Open shows `Could not open <name>: Maximum call stack size exceeded` (`file-actions.ts:387-392`).
  - `c3b-lbrn-stages.mts` puts the time in linkedom's parse, which is quadratic in depth: 62 ms at 5,000, 2.5 s at 20,000 and 10.2 s at 40,000. Saxes takes under 70 ms.
- **Severity:** P3. The parse is off the window thread, and Esc cancels the open (`createImportWorkerControls`, `file-actions.ts:378`). The text is cryptic, and the time is wasted. This resolves the auditor's "Not verified: deep nesting under jsdom": the overflow is KerfDesk's own recursion, not jsdom's.
- **Fix direction:**
  - measure depth iteratively, stopping at `MAX_XML_DEPTH + 1`;
  - refuse depth during the saxes well-formedness pass (it already streams every open tag) before linkedom builds the tree;
  - add tests at depths 65, 5,000 and 100,000, expecting the "nesting is too deep" message within a second.

### Not verified

- Which real exporters write DXF ARC end angles more than 360° past the start, and what ezdxf, AutoCAD and LibreCAD do with them. Offline, with no in-repo quote.
- Whether a V8 out-of-memory in a dedicated worker ends the Electron renderer (D5-P2-2, D5-P3-1, the D5-P1-2 extreme).
- Whether the registration-jig artwork draft with inverted bounds blocks any Save (D5-P2-1 residue).
- A browser `DOMParser` (libxml2) on deep LightBurn nesting in the UI-thread fallback.
- D5-P1-1 on a live or simulated stream. The impact split between the worker and window routes is from READ.
- A 16384 × 16384 Deflate TIFF: about 1.3 GB of allocation, skipped under the memory gate. It is within the decoder's stated 268-megapixel limit.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d5r\`. The security repros are not listed.

| File | What |
|---|---|
| `register.mjs`, `ts-resolve.mjs`, `lib.mts` | the auditor's loader and helpers, copied |
| `register-r.mjs`, `ts-resolve-r.mjs`, `stub-electron.mjs` | loader with the `fflate` alias and `electron` stub |
| `q1-dxf-arc-sweep.mts` | D5-P1-2 |
| `q2-svg-negvb-store.mts` | D5-P2-1 through the real store (`object` / `fragment`) |
| `q3-big-fill-gates.mts` | D5-P2-2 gates (`<sideMm>`) |
| `q4-p3s.mts` | D5-P3-1/-2/-3/-5/-6 (`p31`…`p36`) |
| `c1-pdf-fuzz.mts` | PDF fuzz (`<cases> <seed>`) |
| `c2-tiff-psd-fuzz.mts` | TIFF/PSD fuzz (`<tiff\|psd> <cases> <seed>`, `register-r.mjs`) |
| `c3-lbrn-deep.mts`, `c3b-lbrn-stages.mts` | D5-P3-7 |
| `c4-routes.mts` | Electron route fuzz (`register-r.mjs`) |
| `out/` | logs (`q1`, `q3`, `q4`, `c1-seed*`, `c2-*`, `c3`, `c4-*`) |

```json
{
  "area": "D5",
  "refuter": "2026-11-12",
  "tree": "origin/main@420c5f547",
  "own_cases": 24100,
  "verdicts": [
    {"id": "D5-P1-1", "verdict": "CONFIRMED", "severity": "P1", "security": true, "note": "UI thread confirmed; worker-streamed GRBL/Marlin run on with Abort unreachable, window-streamed K40/Moshi/GRBL truncate; work loss <= 30 s autosave outside a job"},
    {"id": "D5-P1-2", "verdict": "CONFIRMED", "severity": "P1", "note": "real-world exporter reach not verified offline"},
    {"id": "D5-P2-1", "verdict": "DOWNGRADED", "severity": "P3", "note": "main import routes use the fragment route: valid bounds, Save/autosave ok; object route only via registration-jig import"},
    {"id": "D5-P2-2", "verdict": "DOWNGRADED", "severity": "P3", "note": "import bed fit scales 200 m to the bed; estimate routes Fill to the preparation worker; worker-OOM renderer effect unverified"},
    {"id": "D5-P3-1", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D5-P3-2", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D5-P3-3", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D5-P3-4", "verdict": "CONFIRMED", "severity": "P3", "security": true},
    {"id": "D5-P3-5", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D5-P3-6", "verdict": "CONFIRMED", "severity": "P3"}
  ],
  "new": [
    {"id": "D5-P3-7", "severity": "P3", "file": "src/io/lightburn/lbrn-import.ts", "line": 166, "summary": "recursive xmlDepth overflows the stack before the 64-level limit (5,000+ levels); Open toasts 'Maximum call stack size exceeded'; linkedom parse quadratic in depth (worker, Esc cancels)", "evidence": "REPRO", "known": false}
  ],
  "coverage": {"pdf": 2100, "tiff": 3000, "psd": 3000, "electron_routes": 16000, "lightburn_depth": 12, "clean": ["pdf", "tiff", "psd", "electron_routes"]},
  "known": ["rolling-v2 04-electron-main P3-9 (still open)"]
}
```

Refuter counts: raised 11, refuted 0, P1 2, P2 0, P3 9, known 1
