# Oracle audit O1 — O12 `research-reverify`

**Scope:** the ledgers and area reports of code quality C2 (`../2026-11-11-code-quality-c2/`, D1 and D2),
user annoyance A2 (`../2026-11-11-annoyance-a2/`), CNC v2 (`../2026-11-11-cnc-v2/`, J1) and rolling
v14 (`../2026-11-10-rolling-v14/`, Z1–Z4).
**Question:** do the outside facts those audits relied on (firmware source, vendor and LightBurn
documentation, browser and Electron behaviour, cutter maths) say what the audits claimed?
**Method:** [AREAS.md](AREAS.md) steps 1–8, run as meta audit v1 runs them
(`../2026-10-23-meta-v1/AREAS.md`): the "code" under audit is each audit's outside claims. Meta
finding kinds and severity are meta v1's. A meta finding is rated by the product defect it hides or
invents.
**Tree:** origin/main `420c5f547` (2026-11-12). Sources fetched 2026-11-12.

## Headline

- **39 outside claims checked. 33 VERIFIED, 2 CONTRADICTED, 4 UNSOURCED.**
- **No P1 or P2 finding in the four rounds rests on a wrong outside fact.** Every firmware line the
  rotary, reset and settings findings cite says what the report says. Examples: GRBL's position kept
  through a soft reset, grblHAL's `$384`, and Chromium's resize on the resolving thread.
- **But one "not verified" item hid a P1, now found and fixed.** v14 Z2 left "`$13=1` with an A
  axis" untraced. grblHAL's source settles it.
  - With `$13=1`, grblHAL reports an A axis in inches unless `$376` marks A as rotary. The Falcon A1
    Pro ships `$376=0`.
  - KerfDesk scales only Z by 25.4. A is read as degrees.
  - So with report-inches on, Start from line after an Abort sends `G53 G0 A<start>` with a turn
    25.4 times too small. The re-entry burns round the part, away from the half-burned piece.
  - This is **O12-P1-1**. The fix is
    [#1810](https://github.com/cisgz3a-hub/KerfDesk/pull/1810).
- **The two contradictions are both P3.**
  - The "FluidNC's axis rate is not read" note in v14 and ADR-695 Amendment 1 is wrong in the safe
    direction. FluidNC's `$$` lists `$103` and `$113` as proxies of its YAML, and KerfDesk reads
    them (reproduced).
  - D2's "Marlin `M8` depends on `COOLANT_FLOOD`" leaves out `AIR_ASSIST`, which is the build
    option a laser uses.
- **Four "not verified" items are now settled from source:**
  - grblHAL keeps the A machine count through the Abort's reset (Z2, ADR-695 Amendment 1
    Consequences).
  - FluidNC's `$$` lists `$112`/`$113` (Z2).
  - FluidNC reports `$30`/`$32` (A2 B3-P2-1).
  - MeerK40t's byte meanings for the Ruida swizzle, opcodes, UDP ports and status bits, and for
    the Moshi swizzle (C2 D1, D2).

## Oracle plan

Written before reading the code. Each claim is checked against the source the audit named, at the
tag or commit given, or the current default branch where none was given.

| Claim family | Oracle |
|---|---|
| GRBL 1.1 reset, G92, alarm, settings, homing, WCO | `gnea/grbl` master `bfb67f0c` (`main.c`, `gcode.c`, `motion_control.c`, `system.c`, `report.c`, `config.h`) and `doc/csv/*.csv` |
| grblHAL `$384`, `$376`, reset, inch reporting | `grblHAL/core` master `ffbb587a` (`grbllib.c`, `gcode.c`, `settings.c/.h`, `system.h`, `report.c`) |
| FluidNC reset, G92, `$$` proxies, inch reporting | `bdring/FluidNC` main `22e2add7` (v4.1.1 era): `Protocol.cpp`, `GCode.cpp`, `SettingsDefinitions.cpp`, `Settings.h`, `Report.cpp`, `Types.h` |
| Marlin laser modes, `M7`–`M9` | `MarlinFirmware/Marlin` tag `2.1.2.5` and `bugfix-2.1.x`: `M3-M5.cpp`, `M7-M9.cpp` |
| Smoothieware laser S scale and `M221` | `Smoothieware/Smoothieware` edge: `modules/tools/laser/Laser.cpp` |
| Ruida and Moshi byte meanings | `meerk40t/meerk40t` main `d511944e`: `ruida/rdjob.py`, `ruida/controller.py`, `ruida/udp_transport.py`, `moshi/builder.py` |
| Ruida rotary in the controller | LightBurn docs 2.2, *Rotary Mode (DSP)* |
| Chromium `createImageBitmap`, user activation, Web Serial persistence | `chromium/chromium` main `6e11b4e2`: `image_bitmap_factories.cc`, `image_bitmap.cc`, `blink/common/features.cc`, `user_activation_state.h`, `serial_chooser_context.cc` |
| Web specs | WHATWG HTML §8.10 (ImageBitmap), WHATWG Web Serial, WHATWG WebUSB §6.1.2, WICG File System Access |
| Electron runtime | `releases.electronjs.org/releases.json` |
| NSIS installer on update | `electron-builder@26.17.0` (the repo's version) `templates/nsis/assistedInstaller.nsh` |
| macOS Gatekeeper | Apple Developer News, 2024-08-06, "Updates to runtime protection in macOS Sequoia" |
| Cutter maths | derivation by hand (no outside source needed) |
| Tooling catalogue | Amana Tool and SpeTool product pages |

**Sample.** Every claim behind a P1 got a full check: Z1-P1-1, Z2-P1-1, D2-P1-2 and the A2 B4
chain under B4-P2-1, which feeds the A2 P1. The P2s and the verified-clean lists were sampled by
stratum: firmware family (GRBL, grblHAL, FluidNC, Marlin, Smoothieware, Ruida, Moshi), browser
platform, vendor, and maths. At least one claim was taken from every report section that cites an
outside fact, and every "not verified" item a source could settle was checked.

## Claim table

Verdicts: **V** = VERIFIED, **C** = CONTRADICTED, **U** = UNSOURCED. Each quotation is under 15
words.

### Rolling v14 (Z1–Z4)

| # | Report / ID | Claim | Source | Verdict |
|---|---|---|---|---|
| 1 | Z1-P1-1 (P1) | Chromium decodes `createImageBitmap(blob)` off the thread but builds the bitmap, resize included, on the thread that resolves the promise | `image_bitmap_factories.cc` L418–466: `DecodeImageOnDecoderThread` is posted with `worker_pool::PostTask`. L467–489: `ResolvePromiseOnOriginalThread` constructs `ImageBitmap(image, crop_rect_, options_)` | **V** (matches Z1's CDP trace) |
| 2 | Z1-P3-2 | The default `imageOrientation` is `from-image`; `'none'` does not ignore EXIF in Chrome | HTML §8.10: the enum is `"from-image"`, `"flipY"`; "There used to be a 'none' enum value". Chromium `image_bitmap.cc` L93–105: `none` ignores EXIF only under `kCreateImageBitmapOrientationNone`, which `features.cc` L403–404 sets `FEATURE_DISABLED_BY_DEFAULT` | **V** |
| 3 | Z1 method | Electron 44.5.1 ships Chromium 152.0.7977.130 | releases.json: `44.5.1`, chrome `152.0.7977.130`, 2026-09-29 | **V** |
| 4 | Z2-P1-1 (P1) | Stock GRBL keeps the machine position through `0x18` and clears it only at power-up | `main.c` L27, L47 (`memset(sys_position…)` before the loop), L75 (the loop's `memset(&sys…)` leaves `sys_position` alone) | **V** |
| 5 | Z2-P1-1 (P1) | Stock GRBL and FluidNC clear G92 at the Abort's reset; grblHAL keeps it | GRBL `main.c` L89 calls `gc_init`, and `gcode.c` L44 zeroes all of `gc_state`, `coord_offset` included. FluidNC `Protocol.cpp` L680 calls `gc_init`, and `GCode.cpp` L76 does the same. grblHAL `gcode.c` L796 zeroes only up to `offsetof(parser_state_t, g92_offset)` | **V** |
| 6 | Z2-P1-1 (P1) | grblHAL `$384=0` restores G92 at power-up; `$384=1` does not | `settings.h` L260 `Setting_DisableG92Persistence = 384`; `settings.c` L1295 (`g92_is_volatile`); `gcode.c` L851–856 reads G92 from NVS at cold start unless volatile | **V** |
| 7 | Z2 not verified | Does grblHAL keep the A machine count through the Abort's reset? | `grbllib.c` L360 clears `sys.position` once, before the loop. The loop's `memset` (L460–463) stops at `homed` or `alarm`, and `system.h` L286 places `position` after both | **V: kept** (settles the item) |
| 8 | Z2, refuted claim | GRBL sends WCO in the next report after a G92 change | `gcode.c` L1036 calls `system_flag_wco_change()`; `system.c` L285 sets `report_wco_counter = 0` | **V** |
| 9 | Z2 not verified, A2 B4-P2-1 | A reset during motion raises ALARM:3, and position is "likely lost" | `motion_control.c` L384 (`EXEC_ALARM_ABORT_CYCLE`), `system.h` L43 (= 3); `alarm_codes_en_US.csv` row 3 | **V** |
| 10 | Z2 not verified | Stock GRBL's default first homing cycle is Z | `config.h` L105 `HOMING_CYCLE_0 (1<<Z_AXIS)` | **V** |
| 11 | Z2 not verified | With `$13=1`, grblHAL reports A in inches unless A is marked rotary (`$376`) | `report.c` L104–110: an axis past Z in `settings.steppers.is_rotary` is not converted; the others take `INCH_PER_MM`. `settings.h` L252 `Settings_RotaryAxes = 376` | **V** → **O12-P1-1** |
| 12 | Z2 not verified, Z4 table, ADR-695 Amd 1 D5 | FluidNC's axis rate is "not read" / its `$$` may not list `$112`/`$113` | `SettingsDefinitions.cpp` L114–145 `make_proxies()`: `float_proxy(axis, 110, "Grbl/MaxRate/", …)` and the same for 100, 120 and 130, numbered `110 + axis`. `Settings.h` L215–220: these are `type_t::GRBL`, which `ProcessSettings.cpp` L197–208 lists for `$$` | **C** → **O12-P3-1** |
| 13 | Z2, Z4 | `$11x` is an axis max rate in units/min (degrees/min on a rotary) | `setting_codes_en_US.csv` rows 110/112; grblHAL `settings.h` L556 `Setting_AxisMaxRate` (base 100 + 10) | **V** |
| 14 | Z2 reach | "A USB replug or a Windows sleep resets ESP32 boards" | Not fetched; it does not change the rating (METHOD §3 has no reach clause) | **U** |
| 15 | Z2, Z4 | Falcon A1 Pro values `$384=0`, `$376=0`, `$103=8.9`, `$113=36000`, `$123=1000` | Only the repo fixture (`falcon-a1-pro-dump.ts`); no vendor document found | **U** |

### Code quality C2 (D1, D2)

| # | Report / ID | Claim | Source | Verdict |
|---|---|---|---|---|
| 16 | D2-P1-2 (P1), D2-P3-5 | A Ruida controller keeps its own rotary settings, so `.rd` Y scaling by KerfDesk could double with the controller's own | LightBurn *Rotary Mode (DSP)*: Rotary Setup will "write the changes to the controller", and Read Settings reads them back. Whether the controller rescales file Y when its rotary is on is **not stated** | **V** (controller-held); double scale **U** |
| 17 | D2-P3-4 | Marlin `M3 I` is continuous inline power, and `M4 I` is dynamic (from the feed rate), so a layer emitted as `M3 I` is not "dynamic" | `M3-M5.cpp` (2.1.2.5 and bugfix) L36–42; L85–86 `cutter_mode = is_M4 ? CUTTER_MODE_DYNAMIC : CUTTER_MODE_CONTINUOUS` | **V** |
| 18 | D2 not verified | Marlin accepts `M8` only with `COOLANT_FLOOD` | `M7-M9.cpp` L25 `ANY(COOLANT_MIST, COOLANT_FLOOD, AIR_ASSIST)`, L40 `ANY(COOLANT_FLOOD, AIR_ASSIST)` | **C** (incomplete) → **O12-P3-3** |
| 19 | D2 clean | Smoothieware's laser S runs 0–1, and `M221 S100 P0` is 100 % scale with proportional power on | `Laser.cpp` L109 `laser_module_maximum_s_value` default `1.0`; L198–207 (`M221`: S is a percentage, `P>0` disables auto power) | **V** |
| 20 | D1-P3-1 | WebUSB `open()` and `claimInterface()` resolve on a device the page already holds | WebUSB §6.1.2: "If this.opened is true return a promise resolved with undefined"; `claimInterface` has the same early resolve when already claimed | **V** |
| 21 | D1, D2 not verified | Ruida swizzle (magic `0x88`) and opcodes `88` move, `A8` cut, `C6 01`/`C6 02` power min/max, `C9 02` speed, `CA 01 12/13` air | `rdjob.py` L434–449 (`swizzle_byte` identical to `swizzle.ts`), L778–812, L852–864, L955–961, L978–1001 | **V** |
| 22 | D1 not verified | Ruida UDP: send to 50200, listen on 40200; status bits Moving `0x01000000`, Part end `0x02`, Job running `0x01`, all three busy | `udp_transport.py` L17–18; `rdjob.py` L231–234; `controller.py` L203–217 | **V** |
| 23 | D1 not verified | Moshi command swizzle: two bit permutations chosen by parity | `moshi/builder.py` L755–779 `_swizzle`, `convert`; the bit targets equal `moshi-swizzle.ts` `ODD_BIT_TARGETS` / `EVEN_BIT_TARGETS` exactly | **V** |

### User annoyance A2

| # | Report / ID | Claim | Source | Verdict |
|---|---|---|---|---|
| 24 | B1-P2-4 | Control-click → Open no longer bypasses Gatekeeper on recent macOS ("from memory") | Apple Developer News 2024-08-06: users "will no longer be able to Control-click to override Gatekeeper" (macOS Sequoia) | **V**. Still on main: `public/download.html:1587`, `website/pages/download.mjs:227` |
| 25 | B1-P2-3 | The browser's write-permission prompt needs a recent click, about five seconds ("from memory") | WICG File System Access: the permission request throws `SecurityError` without transient activation. Chromium `user_activation_state.h` L23 `kActivationLifespan = base::Seconds(5)` | **V** |
| 26 | B1 checked and sound | The Web Serial chooser opens only on a click | WHATWG Web Serial `requestPort()`: without transient activation, "reject promise with a 'SecurityError'" | **V** |
| 27 | B1-P3-5 | A USB serial adapter with no serial number is not remembered across restarts (macOS, Linux) | Chromium `serial_chooser_context.cc` L542–564 `CanStorePersistentEntry`: off Windows, persisting needs a non-empty `serial_number` | **V** (browser; the desktop app keeps its own grants, ADR-552) |
| 28 | B1-P2-2 lighter form | An update can skip the licence and location pages | `electron-builder@26.17.0` `assistedInstaller.nsh` L13–15 and L25–26: `skipPageIfUpdated` before `licensePage` and `MUI_PAGE_DIRECTORY`, keyed on `--updated` | **V** (possible; `manual-update-quit.ts:46-48` passes no arguments on purpose) |
| 29 | B3-P2-1 | GRBL `$30` is the power scale and `$32` is laser mode | `setting_codes_en_US.csv` rows 30, 32 | **V** |
| 30 | B3-P2-1 open question | Does FluidNC report `$30`/`$32`? | `SettingsDefinitions.cpp` L146–148 `INT_PROXY("32", "Grbl/LaserMode", …)`, `INT_PROXY("30", "Grbl/MaxSpindleSpeed", …)`. KerfDesk reads them (reproduction below) | **V: yes**, so FluidNC is not affected → **O12-P3-2** |
| 31 | B4-P2-1, B3 table | `G92 Z0` is dropped by stock GRBL and FluidNC at a reset, and grblHAL keeps it | as #5 | **V** |
| 32 | B4-P2-1 | Abort's soft reset mid-motion raises an alarm | as #9 | **V** |

### CNC v2 (J1)

| # | Report / ID | Claim | Source | Verdict |
|---|---|---|---|---|
| 33 | J1 maths | Truncated cone `r(h) = r0 + h·tan(A/2)`, flank cap `(R − r0)/tan(A/2)`; the wall left by a flat tip is `d/tan`, not `(d − r0)/tan` | Derivation: the flat's edge traces the wall | **V** |
| 34 | J1 maths | Floor scallop `p / (2·tan(A/2))`: 0.284 mm at 20° and 0.571 mm at 10° for a 0.1 mm pitch | 0.1 / (2·tan 10°) = 0.2836; 0.1 / (2·tan 5°) = 0.5715 | **V** |
| 35 | J1 maths | A ball of radius R meets a flank at α from the axis at radius `R·cos α`, height `R(1 − sin α)`; ball width `2√(h(D − h))` | Derivation: contact where the sphere's normal is perpendicular to the flank | **V** |
| 36 | J1-P2-1 | The starter 12.7 mm 90° V-bit's flank is 6.35 mm tall, the whole default stock | 6.35 / tan 45° = 6.35 | **V** |
| 37 | J1 maths | `(T − u)·s` plug and `z·s` pocket coincide when the plug top is T deep | Derivation | **V** |
| 38 | J1 catalogue | Amana 46280: 6.23 mm cut on a 6.35 mm shank. SpeTool W01001: 3.15 mm on 3.175 mm | amanatool.com answered HTTP 403. The spetool.com product page was 404, and its home page is unrelated | **U** |
| 39 | J1-P3-3 | 6.35 mm is "the most common real sheet" | No source; an opinion. It does not carry the finding, which stands on the remedy text | **U** |

**Counts:** 39 claims: **33 V, 2 C, 4 U.**

## Reproduction (FluidNC `$$`, claims 12 and 30)

A throwaway Vitest file (not committed), on main `5c351a6b3`, which has the same files as
`420c5f547`, fed a FluidNC v4.1.1-shaped `$$` dump into the real code: `$30=1000`, `$32=1`,
`$100`–`$103`, `$110`–`$113` (`$113=500.000`), `$120`–`$123` and `$130`–`$133`. Each line went
through `fluidncDriver.classifyLine` and the shared `onResponse` collector.

- `fluidncDriver.commands.settingsQuery` is `$$`, inherited from the GRBL driver.
- The snapshot had `maxRateA: 500`, `stepsPerUnitA: 8.9` and `maxPowerS: 1000`. The test passed.
- So the axis-rate warning (`rotary-surface-speed-warnings.ts:114`), the row-step check (`$103`) and
  the laser-mode evidence all receive FluidNC's values. Nothing in them is gated on the controller
  kind.

## Findings

### O12-P1-1 — grblHAL with `$13=1`: the rotary turn is read in inches as degrees, so Start from line and the turn-back after Abort aim at the wrong turn

- **Kind:** wrong clean claim (a "not verified" item that hid a defect). It corrects v14 Z2 "Not
  verified" bullet 3 ("`$13=1` … not traced") and ADR-695 Amendment 1.
- **Oracle:** grblHAL `report.c` L104–110 (claim 11). An A axis not in `$376` is reported times
  `INCH_PER_MM` when `$13=1`.
- **Code read** (origin/main `420c5f547`):
  - `src/ui/laser/abort-rotary-turn.ts:57-72`: `currentMachineTurn` scales Z by 25.4 under
    `reportInches` but returns A raw.
  - `src/ui/state/laser-job-stop.ts:482-491`: `rotaryStartTurnAtStop` does the same for the WCO.
  - `src/core/controllers/grbl/parse-settings.ts`: `$376` is not parsed.
  - `src/core/controllers/grbl/resume-rotary.ts:44` writes the saved turn into `G53 G0 A…` under G21.
  - Nothing refuses an A rotary when `$13=1`. KerfDesk supports `$13=1` elsewhere (X, Y, Z and
    feeds, `machine-envelope.ts:37-53`).
- **Scenario:** a Falcon A1 Pro (`$376=0`) whose operator set `$13=1`. The A job starts at machine
  A = 254°, and the controller reports 10.000 for it. The operator Aborts and uses Start from line.
  - The preamble sends `G53 G0 A10`, then `G92 A0`. The part turns to 10° instead of 254°.
  - The tail burns 244° round the part from the half-burned piece, with no warning.
  - The turn-back after Abort jogs 1/25.4 of the needed turn.
  - Job Review's "turned … since" is 25.4 times too small.
- **Severity: P1.** Wrong physical position, silent (METHOD §3 has no reach clause). It needs a
  non-default `$13=1` on grblHAL with A not flagged rotary. FluidNC never converts A–C (`Report.cpp`
  L77, `Types.h` L59–61 `is_linear`), and stock GRBL has no A axis, so neither is affected.
- **Fix:** separate PR, branched from fresh origin/main.
  - Parse `$376` into `rotaryAxesMask`.
  - Scale a reported A by 25.4 only when `reportInches` is set, `$376` was reported, and its A bit
    (8) is clear.
  - Apply that at both A readers. Regression tests fail before the fix.

### O12-P3-1 — "FluidNC's axis rate is not read" is wrong: KerfDesk reads it from `$$`

- **Kind:** contradiction (wrong clean or announced claim). It corrects:
  - v14 Z2 "Not verified" ("FluidNC `$$` … If not, the axis-rate warning never fires");
  - the Z2 "Fixed" list ("FluidNC's rate is announced as not read");
  - the Z4 setup and table ("FluidNC with A (rates not read, as announced)"; "steps and rates not
    read: row banding cannot be checked");
  - ADR-695 Amendment 1 D5 ("Not read: FluidNC's per-axis `max_rate`").
- **Oracle:** claim 12 plus the reproduction above.
- **Product:** no defect. The warnings the audits thought were missing on FluidNC do run. The only
  thing left to change is the wording in ADR-695 Amendment 1. It names the YAML `max_rate`, which
  KerfDesk indeed never reads, while its `$113` proxy is read. That ADR edit is listed for the
  maintainer, not made here.
- **Severity:** P3. It hides no defect and invents none: the records undersold the product.

### O12-P3-2 — A2 ledger overstates B3-P2-1 for FluidNC

- **Kind:** wrong scope. `../2026-11-11-annoyance-a2/LEDGER.md` "top three" item 3 says Marlin,
  Smoothieware, grblHAL and FluidNC users are "told 'unverified' on every job, for good".
- B3-P2-1 itself names only Marlin and Smoothieware, and it left FluidNC open.
- FluidNC reports `$30` and `$32` (claim 30). Its capability is `readonly-dump`, not `none`
  (`fluidnc/driver.ts:138`). So `settingsObservationIsCurrent`
  (`laser-mode-start-evidence.ts:100-105`) can pass on FluidNC.
- FluidNC and grblHAL remain in **B3-P2-2** (the bed position), which is a different finding.
- **Severity:** P3 (record only).

### O12-P3-3 — D2's Marlin `M8` note leaves out `AIR_ASSIST`

- **Kind:** bad citation (incomplete). D2 "Not verified" says `M8` depends on `COOLANT_FLOOD`.
- Marlin's handler is compiled for `COOLANT_FLOOD` **or `AIR_ASSIST`** (`M7-M9.cpp` L25, L40). On a
  laser build, `AIR_ASSIST` is the usual way to get `M8`.
- **Severity:** P3. No verdict changes, and KerfDesk's air words on Marlin are unaffected.

## O12 corrections (for the coordinator; other audits' files are not edited)

- **v14 LEDGER "Not verified", Z2 report "Not verified" and ADR-695 Amendment 1 Consequences:**
  - grblHAL **does** keep the A machine count through the Abort's reset (claim 7).
  - FluidNC's `$$` **does** list the axis rates (claim 12).
  - `$13=1` with an A axis is now traced: O12-P1-1.
- **v14 Z4:** "FluidNC … rates not read, as announced" → read via the `$$` proxies (O12-P3-1).
- **A2 LEDGER, top three item 3:** drop FluidNC from the B3-P2-1 half (O12-P3-2).
- **C2 D2 "Not verified":** Marlin `M8` needs `COOLANT_FLOOD` or `AIR_ASSIST` (O12-P3-3).
- **C2 D1/D2 "Not verified":** the MeerK40t byte meanings named there are now **verified** at
  `d511944e` (claims 21–23). Real Ruida busy timing and real Moshiboard timing stay unverified.
- **A2 B1-P2-4:** Apple's own notice confirms the "from memory" macOS claim. The two pages still
  carry the Control-click text, so the finding stays open.
- **A2 B1-P2-2:** the "skip the licence and location pages" lighter form is possible with the
  stock template (`--updated`). Whether an update may skip the License & Safety Notice is the
  maintainer's call (listed below).

## Refuted

None of the four rounds' findings is refuted by an outside source.

## Verified clean (outside facts behind earlier clean or refuted claims)

- Z2's refuted "stale WCO at an early Abort": GRBL sends WCO in the next report after G92
  (claim 8).
- D2's "G-code family is one choke point". The power-mode differences it calls by design are real
  firmware facts:
  - Marlin `M3 I` is continuous (claim 17);
  - Smoothieware `M221 S100 P0` is proportional (claim 19).
- D1's "a KerfDesk reconnect still works" after a failed Moshi connect: WebUSB re-open and re-claim
  resolve (claim 20).
- A2 B1 "Web Serial chooser only on a click" (claim 26).

## Not verified

- Whether a Ruida controller with its own rotary mode on rescales the Y of a KerfDesk `.rd` (claim
  16). LightBurn's documentation does not say. #1763 already tells the operator to keep the
  controller's rotary off.
- The Falcon A1 Pro's shipped settings (claim 15) and the tapered-ball catalogue figures (claim 38):
  no reachable vendor page.
- FluidNC's machine position through its soft restart (`system_reset` → `sys.reset()`); not traced.
- ESP32 reset on port open or sleep (claim 14).

## Maintainer decisions

1. **ADR-695 Amendment 1 D5 wording** (O12-P3-1). Change "Not read: FluidNC's per-axis `max_rate`"
   to "read from FluidNC's `$113` proxy of `max_rate_mm_per_min`".
2. **Windows update pages** (A2 B1-P2-2). Should an update relaunch the installer with `--updated`,
   which skips the licence and location pages? The `manual-update-quit.ts` comment rules out
   arguments on purpose (ADR-561 decisions 3–4).

## Fix pull requests

| Finding | PR | State |
|---|---|---|
| O12-P1-1 | [#1810](https://github.com/cisgz3a-hub/KerfDesk/pull/1810), branch `claude/o12-p1-1-grblhal-inch-a`, ADR-695 Amendment 4. The regression test fails 2 of 4 before the fix | opened with auto-merge **off** (1.0.32 release freeze) |

## JSON

```json
{
  "area": "O12 research-reverify",
  "tree": "420c5f547",
  "claims": 39, "verified": 33, "contradicted": 2, "unsourced": 4,
  "findings": [
    {"id": "O12-P1-1", "severity": "P1", "kind": "wrong clean claim", "corrects": "v14 Z2 not verified ($13=1 with A)", "file": "src/ui/laser/abort-rotary-turn.ts", "line": 57, "oracle": "grblHAL core report.c L104-110", "fix": "#1810"},
    {"id": "O12-P3-1", "severity": "P3", "kind": "contradiction", "corrects": "v14 Z2/Z4, ADR-695 Amd 1 D5 (FluidNC rate not read)", "oracle": "FluidNC SettingsDefinitions.cpp make_proxies + REPRO"},
    {"id": "O12-P3-2", "severity": "P3", "kind": "wrong scope", "corrects": "A2 LEDGER top-three item 3 (FluidNC unverified)", "oracle": "FluidNC INT_PROXY 30/32"},
    {"id": "O12-P3-3", "severity": "P3", "kind": "bad citation", "corrects": "C2 D2 not verified (Marlin M8)", "oracle": "Marlin M7-M9.cpp L25,L40"}
  ]
}
```
