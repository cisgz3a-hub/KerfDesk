# LFCB-1 — LaserForge Competitive Benchmark, Round 1

**Date:** 2026-07-26 · **Branch:** `claude/cnc-laser-code-audit-c7dd1b` · **Corpus:** 24 real codebases, ~3.5M lines
**Method:** 39 agents · 21 projects scored · 5 cross-calibration judges · 3 adversarial challengers

---

## 1. The benchmark

Ten weighted dimensions, 0–10, calibrated anchors (0 absent · 2 token · 4 basic · 6 solid
production-usable · 8 strong best-practice · 10 category-defining in OSS laser/CNC), plus a
68-id feature matrix. Every score required ≥2 `file:line` citations.

| Dim | Name | Weight |
|---|---|---|
| D1 | Architecture & modularity | 12 |
| D2 | Code quality & discipline | 12 |
| D3 | Testing & verification rigor | 12 |
| D4 | CAM / geometry engine depth | **14** |
| D5 | Controller, streaming & machine safety | 12 |
| D6 | Feature breadth vs LightBurn baseline | 12 |
| D7 | UX & workflow design | 10 |
| D8 | Platform, build & release engineering | 6 |
| D9 | Documentation & decision record | 5 |
| D10 | Project health & production evidence | 5 |

The D6 yardstick is LightBurn's own published feature set, fetched from its documentation
during this session — not from memory.

**Why calibration mattered.** Each codebase was audited by a different agent in isolation, so
the 0–10 scale drifted. Five judges then re-scored *every* project on one scale per dimension
(D2–D6). Calibration moved 19 of 21 projects; the largest single move was −4.3.

---

## 2. Final ranking

| # | Project | Language / stack | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **LaserForge-2.0** | TS + React + Zustand | 8.5 | 8.5 | 7.5 | 8.0 | 7.0 | 8.5 | 7.7 | 8.3 | 7.3 | 4.0 | **77.5** |
| 2 | **rayforge** | Python/GTK4 + Rust kernel | 8.0 | 6.5 | 6.0 | 7.5 | 8.0 | 7.5 | 8.0 | 8.0 | 7.5 | 8.0 | **74.3** |
| 3 | **MeerK40t** | Python / wxPython | 6.0 | 4.0 | 6.5 | 8.5 | 9.0 | 8.5 | 7.0 | 7.5 | 6.5 | 6.0 | **70.5** |
| 4 | Universal G-code Sender | Java / NetBeans | 7.0 | 6.0 | 6.0 | 6.0 | 9.0 | 5.0 | 7.5 | 8.0 | 5.0 | 8.0 | 66.8 |
| 5 | beam-studio (FLUX) | TS + React + Electron | 5.5 | 5.5 | 5.5 | 4.5 | 6.0 | 7.0 | 7.5 | 7.5 | 6.5 | 7.0 | 60.5 |
| 6 | gSender | TS/React + Electron | 5.0 | 4.0 | 4.0 | 2.5 | 8.5 | 3.0 | 7.5 | 7.0 | 3.5 | 9.0 | 50.9 |
| 7 | bCNC | Python / Tk | 4.5 | 3.5 | 1.0 | 8.5 | 7.0 | 4.0 | 5.5 | 4.0 | 3.5 | 6.0 | 48.5 |
| 8 | Snapmaker Luban | Electron + React | 5.0 | 4.0 | 1.0 | 5.0 | 6.0 | 5.5 | 7.0 | 7.0 | 3.0 | 6.0 | 48.5 |
| 9 | CNCjs | React + Node | 5.0 | 4.5 | 4.5 | 1.5 | 7.5 | 2.0 | 6.0 | 7.5 | 5.5 | 8.0 | 47.5 |
| 10 | Kiri:Moto (grid-apps) | JS / Three.js | 6.0 | 4.0 | 0.5 | 8.5 | 1.5 | 3.0 | 6.5 | 7.0 | 6.0 | 7.0 | 47.1 |
| 11 | svg2gcode | Rust | 7.5 | 6.5 | 5.0 | 5.0 | 1.0 | 1.0 | 4.5 | 7.0 | 4.5 | 6.0 | 46.1 |
| — | *LaserGRBL* | *C# / WinForms* | *3.5* | *3.5* | *0.5* | *5.5* | *8.0* | *4.5* | *6.0* | *6.0* | *4.0* | *8.0* | *≈47* |
| 12 | CAMotics | C++ | 6.5 | 4.0 | 2.5 | 6.5 | 1.5 | 1.0 | 5.5 | 6.0 | 6.0 | 6.0 | 42.8 |
| 13 | LaserWeb4 | JS / React 15 + Redux | 4.0 | 3.0 | 0.5 | 6.5 | 4.5 | 4.5 | 5.5 | 4.0 | 3.0 | 6.0 | 41.3 |
| 14 | Inkcut | Python / Enaml+Qt | 6.0 | 4.0 | 2.5 | 4.5 | 3.0 | 2.0 | 5.5 | 5.0 | 5.0 | 6.0 | 41.3 |
| 15 | Candle | C++ / Qt | 3.5 | 3.0 | 0.5 | 3.0 | 7.0 | 1.5 | 6.0 | 6.5 | 5.5 | 7.0 | 39.0 |
| 16 | OpenBuilds CONTROL | JS / Electron | 2.5 | 2.5 | 0.5 | 2.5 | 7.5 | 2.0 | 6.5 | 6.0 | 3.0 | 8.0 | 37.1 |
| 17 | VisiCut | Java | 4.5 | 3.5 | 3.0 | 2.5 | 1.5 | 3.5 | 5.5 | 6.5 | 2.0 | 6.0 | 36.1 |
| 18 | Deepnest | JS/TS + Electron | 4.0 | 3.5 | 2.0 | 4.5 | 0.0 | 1.0 | 5.0 | 5.0 | 4.0 | 5.0 | 31.4 |
| 19 | OpenBuilds CAM | JS (no build) | 2.5 | 2.0 | 0.5 | 5.0 | 1.5 | 2.5 | 5.5 | 2.0 | 2.0 | 6.0 | 28.5 |
| 20 | jscut | JS + asm.js | 4.0 | 3.5 | 0.5 | 6.0 | 0.5 | 1.5 | 4.0 | 2.0 | 2.0 | 1.0 | 27.1 |

*LaserGRBL is italicised because it was hand-scored by me after two agent stalls — a weaker
method than the other 20 received. Treat its position as indicative.*

### The honest caveat on rank 1

**LaserForge is #1, but the 3.2-point margin over rayforge is inside the instrument's error.**
Two reasons, both verified:

1. **rayforge's geometry kernel was not in the tree.** The clone contains **0 `.rs` files**;
   `raygeo` is an external pip dependency. Its D4 (weight 14) was scored on a codebase with its
   CAM engine absent. Plausible upside of 1–2 points there closes most of the gap.
2. **LaserForge's own three lenses spanned 73.7 → 84.4** — a 10.7-point internal disagreement,
   wider than the margin.

The defensible statement is: *LaserForge and rayforge lead a 20-project field, with LaserForge
ahead on engineering discipline and CAM breadth, rayforge ahead on shipping reality and live
Ruida control.* Everything below third place is a clear gap.

---

## 3. Objective metrics (machine-measured by me, identical method for all)

| Project | Files | LOC | Median | Max file | >1000 ln | Test-file % |
|---|---|---|---|---|---|---|
| **LaserForge-2.0** | 2861 | 372,290 | 95 | **530** | **0** | **43.1%** |
| rayforge | 1202 | 295,415 | 163 | 2,288 | 30 | 30.1% |
| beam-studio | 1977 | 328,305 | 69 | 6,746 | 44 | 24.7% |
| MeerK40t | 560 | 298,209 | 228 | 9,738 | 80 | 14.5% |
| UGS | 1814 | 206,663 | 76 | 1,913 | 2 | 9.8% |
| gSender | 866 | 142,779 | 71 | 9,857 | 17 | 1.8% |
| Candle | 925 | 335,151 | 247 | 8,793 | 42 | 0.0% |
| OpenBuilds CONTROL | 427 | 348,803 | 152 | **58,351** | 57 | 0.0% |

**LaserForge is the only codebase in the corpus with zero files over 1000 lines**, and has
2.4× the test-file ratio of the next best. Eight of the 24 have no tests at all.

*Caveats found later:* LaserGRBL's 190k LOC is ~73k vendored (SharpGL, Clipper, CsPotrace,
RJCP, WebSocket) plus WinForms generated code; OpenBuilds/Deepnest/Kiri:Moto LOC is inflated by
bundled vendor JS. My test-file regex also missed .NET `*.Tests/` naming.

**Verified this session:** `pnpm test` → **7,325 tests / 1,237 files passed, exit 0** (978s).
`tsc --noEmit` → exit 0. Enforcement is real, not aspirational — `eslint.config.mjs:115-120`
errors on `max-lines` 400, `max-lines-per-function`, `complexity` 12, `boundaries/dependencies`,
`import/no-cycle`, `no-explicit-any`, `no-non-null-assertion`, plus pure-core
`no-restricted-globals/imports/syntax`. **No competitor has a comparable gate.**

---

## 4. Feature matrix — group leaders

| Group (ids) | Leader | Runner-up |
|---|---|---|
| Import / file formats (10) | MeerK40t | **LaserForge** |
| Design / edit / image prep (11) | beam-studio | **LaserForge** |
| **CAM / toolpath generation (19)** | **LaserForge — 38/38, only perfect group score in the corpus** | rayforge (31/38) |
| **Controller / machine control (20)** | **LaserForge (36/40)** | rayforge (32/40) |
| Verification / simulation (4) | **Tie: LaserForge & rayforge** | four projects at 7/8 |
| Platform / distribution (4) | Tie: Kiri:Moto & beam-studio | **LaserForge** |

LaserForge leads two groups outright, ties a third, is runner-up in two more, and is beaten
decisively only on mobile — where it is at a clean zero.

---

## 5. What only LaserForge has

- **Perceptual re-rasterization of emitted G-code as a test instrument — 0 of 19 competitors.**
  `src/__fixtures__/perceptual/` parses LaserForge's *own emitted G-code* back into a burn mask
  (simulating M3/M4 modal state, inking only G1 with positive S) and scores IoU/precision/recall
  against source art. Every other project asserts output text is *stable*; this is the only one
  that asserts output *looks right*. It directly answers the project's stated hard problem.
- **LightBurn migration depth** — imports `.lbrn`/`.lbrn2` projects **plus `.clb` cut libraries
  plus `.lbdev` device profiles**. Two competitors import project files; none imports the cut
  library or device profile. That is the actual switching cost for a LightBurn user.
- **Frame-first single-permit control architecture** (ADR-228) — not on the feature matrix at
  all, because no competitor has the concept. Every other machine-control app in the corpus
  accretes defensive refusals over time.
- **11 dither modes** (8 error-diffusion kernels + threshold + Bayer + grayscale) with dot-width
  correction and bidirectional scan-lag compensation — *ahead of MeerK40t's 8*, and LaserGRBL's 10
  lack the compensation.
- **From-scratch tracer** — 51 modules including centerline medial-thinning, Canny sub-pixel
  edges, Schneider cubic fitting. LaserWeb4 vendors potrace; rayforge shells out to vtracer.
- Single-line CAD fonts (3 of 21 have this), text-on-path (2), cross-hatch fill (3),
  winding-aware arc/line lead-in-out (2), installable offline PWA (2).

---

## 6. Verified weaknesses

Everything here I confirmed myself, not merely received from an agent.

| Finding | Evidence |
|---|---|
| `README.md` is 18 lines of placeholder gibberish | read the file |
| "Result, never throw" is dead letter — **49 `throw new` in `src/core` vs 12 `Result<`** | grep |
| **15 barrels over the 20-symbol hard cap; `scene/index.ts` at 208** | the repo's own `check-index-exports.mjs` |
| **45 `Date.now()` in `src/ui/state`**, which holds safety policy outside every purity rule | grep |
| Travel optimization silently disables above 2000 segments — exactly the traced-artwork case | `MAX_NEAREST_NEIGHBOR_SEGMENTS = 2_000` |
| Silent geometry loss — Clipper failure returns `[]`, a fill can vanish with no warning | `offset-fill.ts:29-33` |
| **No arc fitting anywhere** — laser output is G1-only; CNC G2/G3 is generator-only | challenger, cross-checked |
| Nesting is rectangle bin-packing, not true shape nesting | `quick-nest.ts` types are `NestRect{width,height,rotated90}` |
| 427 `as X` casts absorbing the unsoundness that banning `!` displaced, uncommented in hot loops | D2 judge, `cnc-tab-ramp.ts:136` |
| `pointInPolygon` reimplemented 3× in production | the exact anti-pattern CLAUDE.md names |
| No probe-grid autolevel of any kind | 3 competitors have it |

### Corrections to claims made mid-audit

- **"Zero hardware verification" is false.** `docs/architecture/08-invariants-and-verification.md:72`
  records GRBL/grblHAL **streaming VERIFIED** on a Falcon A1 Pro (grblHAL 1.1f, 2026-07-02).
  What is unverified is **CAM output fidelity**: raster burn PENDING, all CNC Phase H CLAIMED,
  Ruida never accepted by hardware. Precise statement: *streaming is proven; output is not.*
- **"23 days old at 16k lines/day" is an artifact** of truncated git history — the root commit
  `eb11e92e` has an empty parent but a *feature* commit message, not an init.
- **"Build a controller emulator" (my own earlier recommendation) was wrong** — LaserForge
  already ships `grbl-sim-machine.ts`, `marlin-simulator.ts`, `smoothie-simulator.ts`,
  `ruida-decoder.ts`, `fake-serial-port.ts`. The sim is a pure reducer, cleaner than MeerK40t's.

---

## 7. Gap list — what ≥2 competitors have and LaserForge does not

Ordered by value. All seven are **purely additive capability, no refusal surface** (rule 7 clean).

| # | Gap | Who has it | Effort |
|---|---|---|---|
| 1 | **User macros** | **16 of 19 competitors**; 11 fully | 2–4 days — send path + recall history already exist |
| 2 | **Tool-length offset / G43.1** | 5 (CNCjs has five M6 policies) | 1–2 weeks; state model half-built |
| 3 | **Mobile LAN pendant** | 8; three converged on QR-paired pendant | 1–2 weeks for a pendant (not a responsive redesign) |
| 4 | PDF/AI import | 3 | 2–3 days rasterised; 1–2 weeks vector |
| 5 | `.rd` import | 2 | 3–5 days — decoder already exists in fixtures |
| 6 | True shape nesting (NFP) | 5 (Deepnest is best-in-class) | 3–6 weeks, numerically treacherous |
| 7 | Live Ruida transport | 2 | 4–8 weeks, hardware-blocked |

Two carry a design constraint worth stating **before** any code: a mobile pendant must not become
a second Start path bypassing the frame permit (scope v1 to jog/frame/status/overrides), and a
mid-job tool change must not silently invalidate the frame bounds signature.

---

## 8. Firmware ground truth (extracted from real firmware source)

Used to fact-check every D5 claim. The high-value divergences LaserForge's simulators do not model:

| Firmware | Fact |
|---|---|
| grbl 1.1h | RX buffer 128 but **line buffer only 80**; terminators count against RX; settings writes must not be char-count streamed (EEPROM write drops RX bytes); WCO/Ov throttled, not in every report |
| grblHAL | RX buffer **1024**, not 128; **`$32` is three-way** (0 Normal / 1 Laser / **2 Lathe**); planner depth runtime-configurable via `$398` (30–1000) |
| FluidNC | **One line at a time**, not char-counting; **`$32` is read-only — a write returns error 162**; lines >254 chars **silently truncated, no error**; `Bf:` absent unless `$10=3` |

Two questions this raises for the tree: `parse-settings.ts:226` accepts only `$32 === 0 || 1`, so a
grblHAL lathe (`$32=2`) is silently unrecorded; and `grbl-setting-write.ts:72` permits `$32=1`
writes, which FluidNC rejects.

**Credit:** LaserForge reads real `rxBufferBytes` from `$I` build info
(`build-info.ts:95-104`) rather than hardcoding 128 — the correct approach, and most of the
corpus does not do it.

**The sharpest verification finding:** `grbl-sim-machine.ts:8` documents its own gap —
*"Acks are immediate; real GRBL stops acking when the planner fills."* The single behaviour a
char-counting streamer must get right, **back-pressure when the planner fills, is never exercised.**

---

## 9. Techniques worth stealing

| From | Technique |
|---|---|
| MeerK40t | Controller **emulators** so drivers are byte-exact testable with no machine; everything is a console command → headless-drivable |
| rayforge | **Headless/CLI mode enforced by a test**, structurally preventing logic leaking into widgets; versioned hot-loadable addon API where shipped features *are* addons |
| CNCjs | Live-variable expression evaluation inside macros (`G0 X[posx - 8]`) resolved against real position at stream time |
| bCNC | Autolevel that re-walks every motion through the G-code interpreter and splits along the probe grid; tabs as arbitrary islands |
| Kiri:Moto | **Coastline travel routing** — walk the boundary at clamped Z instead of retracting; tool-shadow collision boundaries |
| svg2gcode | **Rounding-aware tolerance budgeting** — subtract the rounding epsilon from tolerance so output is provably inside spec; config schema versioning with executable historical snapshots |
| Deepnest | Post-NFP explicit overlap validation; common-line merging fed back into GA fitness |
| Candle | Firmware-accurate job time estimation modelling planner lookahead and junction velocities |

---

## 10. Method limits — what was NOT verified

- **No perceptual render, no golden-image diff, no hardware.** This is a static code audit.
  Per CLAUDE.md rule 2, nothing here proves any LaserForge feature *looks* correct.
- **rayforge's `raygeo` Rust kernel was absent** from the clone — its D4 is under-measured.
- **LaserGRBL was hand-scored by me** after two agent stalls; weaker method than the other 20.
- **The `discipline-mismeasured` challenger died** to a 529, and the **rayforge head-to-head
  agent stalled**. I substituted my own direct verification for the first; the second is a
  genuine gap in the evidence for the #1 vs #2 comparison.
- ~1,360 competitor feature cells were not individually re-derived; non-spot-checked levels
  carry the original auditors' confidence, not mine.
- Shallow clones (`--depth 1`) — commit-history analysis was limited.
