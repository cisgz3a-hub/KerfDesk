# Rolling audit v6 — K3 Falcon A1 Pro truth

- **When:** 2026-10-28, morning +0800.
- **Tree:** origin/main @ `9e20cc061` (`9e20cc06195a9c3e4e241462df8f487ead94579a`, the merge of #1485).
  - `git diff --stat 93334429e origin/main -- src` is empty, so the source is the one J8 audited.
  - Code was read with `git show origin/main:<path>`. Repros ran in the scratchpad copy `j7-main`, whose files in scope are byte-identical to main (checked file by file).
- **Scope:**
  - **Presets:** the grblHAL Falcon presets. That means the Falcon A1 Pro (`falcon-profiles.ts`), the only grblHAL Falcon. It also covers the Ortur LM3 grblHAL presets and the withdrawn Falcon-compatible fallback (ADR-660).
  - **Checked against:** two published A1 Pro `$I`/`$$` transcripts, Creality's A1 Pro pages and LightBurn device file, and grblHAL core at the build the dump reports.
  - **Code paths:** the Falcon command contract, homing and placement, the native bed frame, preflight, jog limits, the camera calibration notes, Start's `$30`/`$32` acknowledgement, automatic overscan and its Job Review advisory, the Console, and the Machine Setup guide.
  - **ADRs:** ADR-322 §4, ADR-323, ADR-370, ADR-495, ADR-637 Amd 2, ADR-660, ADR-663 Amd 4 and ADR-664.
- **Lenses run:**
  - **L2 ground truth (main pass).** Every `$` value in the dump was compared with KerfDesk's assumption.
  - **L1 contract:** ADR-322 §4, ADR-495 and ADR-370.
  - **L3 twins:**
    - the vendor bed frame against the preset;
    - ADR-495's model against the firmware;
    - Machine Setup's guide against the Console.
  - **Not run:** L4–L7. This area is about data and assumptions, not input handling.
- **Primary sources (all fetched 2026-10-28):**
  - **Transcript 1:** barebaric/rayforge PR #461.
    - Merged 2026-09-26: merge `2ed50476475a22703812781f369bc2f871225725`, head `2675a36a`.
    - The PR body holds the `$I` and `$$` transcript. Body SHA-256 `49f2cf09…1db90d0`, the same body J8's refuter fetched.
    - The device file the PR derived from it is [`device.yaml` @ `2ed50476`](https://github.com/barebaric/rayforge/blob/2ed50476475a22703812781f369bc2f871225725/rayforge/resources/devices/creality-falcon-a1-pro/device.yaml#L14-L22), SHA-256 `07762847…5e665eb`. It records 363 × 273, acceleration 1000 and `home_on_start: true`.
    - After the read the contributor wrote (issue comment 5837779449) that he "did do some basic homing and laser positioning, and that worked fine".
  - **Transcript 2 (new here, independent):** LightBurn forum topic 177926, post 3, 2025-08-19.
    - Another A1 Pro's `$$`, read by LightBurn. It gives the same values: `$20=0 $21=1 $22=43 $23=3 $30=1000 $32=1 $62=0 $120=1000 $130=363 $131=273 $150=16 $151=16 $152=16 $153=16`.
    - The banner is `GrblHAL 1.1f ['$' or '$HELP' for help]`.
    - Archived copy: [web.archive.org/web/20251208074651](https://web.archive.org/web/20251208074651/https://forum.lightburnsoftware.com/t/several-errors-in-the-same-work-creality-falcon-a1-pro/177926), HTML SHA-256 `c3a440fd…7cb3af4`. Topic JSON SHA-256 `333f4f26…2e39de39`.
  - **grblHAL core** at [`04a5edcf`](https://github.com/grblHAL/core/tree/04a5edcf8353f7294167d12d32e4b073d9be9ce4). This is the commit that sets `GRBL_BUILD 20231005` (`grbl.h` L45), the core build the dump reports as `[VER:1.1f.20231005:]`.
  - **Creality's A1 Pro pages:**
    - [FAQ, archived 2026-01-15](https://web.archive.org/web/20260115113240/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/faq) (SHA-256 `d612df90…6bca19`);
    - ["laser not emitting", archived 2026-04-20](https://web.archive.org/web/20260420214030/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/homing-no-emitting) (SHA-256 `bb0169bc…44d33bb41`);
    - the GRBL page snapshot J8 pinned (`62e0e6cb…5f4ee54`);
    - the LightBurn bundle `11b13328…f988405b`, whose `.lbdev` hashes to `9635b931…6d8f83ad`;
    - the troubleshooting page, read live in Chinese (wiki.creality.com redirects this region to `/zh/`). Live SHA-256 `8e7bdf5a…ee1ef`. An English snapshot from 2026-04-12 exists, but Wayback answered 429.
  - **LaserGRBL** [`GrblCore.cs` @ `1f9337b3`](https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs), SHA-256 `61c799df…df2288ed`.
- **Repro:**
  - **File:** `j7-main/src/zz-k3-falcon-truth.test.ts`, 1 passed. Run alone with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run src/zz-k3-falcon-truth.test.ts --silent=false --disableConsoleIntercept`, then deleted.
  - **What it drives:** the real Falcon driver, the preset, KerfDesk's `$$` parser on the dump, `resolveNativeBedFrame`, `resolveManualMotionLimits`, `trustedMotionOffsetForPreflight`, `laserModeStartSnapshotIsVerified`, `automaticOverscanMm`, and the two bounds checks.
  - **Output:** quoted in the findings below.
- **Counts:** 4 raised → 0 refuted → P1 1 / P2 1 / P3 2 (+ 9 KNOWN re-observed). The refuter confirmed all four and raised K3-P2-2 to P1 (§3: reachable today, no specific warning).
- **Refuter (fresh context, 2026-10-28):**
  - **Re-fetched and pinned:**
    - rayforge PR #461 through the GitHub API. Merged 2026-09-26T21:27:13Z, merge `2ed50476…`, head `2675a36a`. The body SHA-256 `49f2cf09…1db90d0`, `device.yaml` `07762847…5e665eb` and issue comment 5837779449 all match.
    - LightBurn topic 177926. The Wayback Machine refused the fetch (bot block), so the archive HTML hash is UNVERIFIED by the refuter. The live topic JSON was fetched 2026-10-28; post 3's `cooked` has SHA-256 `f8301eba…` and was last edited 2025-08-19T20:55Z. It shows the same value on every row tabled below.
    - Creality's bundle `11b13328…f988405b` and its `.lbdev` `9635b931…6d8f83ad` match. Its macro labelled "Home" is `$HX\n$HY\n`.
    - LaserGRBL `GrblCore.cs` @ `1f9337b3` matches (`61c799df…df2288ed`).
    - Creality wiki archives (FAQ, "laser not emitting", troubleshooting): the Wayback Machine refused. These are UNVERIFIED by the refuter, and no finding rests on them alone.
  - **Firmware pin correction.** The dumps' core is not stock `04a5edcf`.
    - Both dumps print `[KINEMATICS:CoreXY v2.02]`. Core `04a5edcf` prints "CoreXY v2.00" (`kinematics/corexy.c` L210).
    - v2.02 first appears at core [`f8f10aec`](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L240) (2024-11-21, `GRBL_BUILD 20241120`).
    - Both dumps also print `[Firmware:Version v1.0.4]` between `[VER:…]` and `[OPT:…]`. Stock `report_build_info` prints no such line (`report.c` L799-830).
    - So the A1 Pro runs Creality's modified grblHAL, which reports core build 20231005.
    - The refuter re-checked every firmware mechanism this report uses at `f8f10aec` as well, and the CoreXY/planner pair at the current core [`35431d1b`](https://github.com/grblHAL/core/blob/35431d1bd39151935a9681354312f0bd23c70add/kinematics/corexy.c#L68-L78) (2026-07-26). Nothing changed, except the CoreXY "set machine origin to 0" code (see K3-P2-1).
  - **Refuter repro:** `j7-main/src/zz-k3r-falcon-refute.test.ts`, 1 passed, run alone and then deleted. It drives main's code and an independent numeric model of grblHAL's CoreXY planner. Its output is quoted under each finding.
  - **Main moved to `ef52782a6` during the refutation.** #1486 (ADR-370 Amendment 1), #1487 and #1489 merged. `git diff 93334429e ef52782a6` was read for every file the verdicts rely on.
    - **#1486 changed:**
      - the Falcon contract's Console writes: on grblHAL it lists none (`falcon-command-contract.ts`, `console-setting-writes.ts`);
      - the air-standby remedy: the A1 Pro is no longer told to send `$152=100` (`air-standby-remedy.ts`);
      - comments in `falcon-profiles.ts` and `device-profile.ts`.
    - **It did not change:**
      - the preset's inherited `homing: { enabled: false }`;
      - `settings: 'none'`, `settingsQuery: null` and `buildInfoQuery: null`;
      - the evidence notes. They are now at `falcon-profiles.ts:60` and `:65`, one line lower.
    - **ADR-370 Amendment 1 item 5 restates the ban.** It keeps "settings fetch and `$I`" disabled "as Creality's own LightBurn device does (ADR-322)" and sends no new query.
    - **Other K3 paths:** no file on any of them changed. That covers automatic overscan, the runway advisory, the native bed frame, placement, the preflight bounds checks, the jog limits, the handshake, the Console classifier and the camera note.
    - **Result:** every K3 finding holds on `ef52782a6`. J8-P3-2 (KNOWN) is fixed there.

## Headline

**Reading is safe; the preset's homing-off belief is the costliest mismatch.**

**Homing.** The A1 Pro firmware has homing on. `$22=43` means enabled, single-axis, set machine origin to 0, startup lock off. Creality's own workflow homes before every job. KerfDesk's preset still inherits `homing.enabled: false`. That belief does more than hide the Home button:
- KerfDesk's own A1 Pro bed frame never applies, although it was built for exactly this firmware.
- Every A1 Pro job therefore gets a size-only preflight, even in Absolute. The repro: a runway that reaches X −23 passes, where the homed path refuses it.
- An enabled no-go zone refuses every Start.
- Jogging and "move laser here" have no bed limits.
- The camera calibration tells the operator "This machine has no homing" and drops the advice to home first.
- The default flow starts with Release motors, which `$62=0` always refuses.

This is K3-P2-1.

**CoreXY.** The A1 Pro is CoreXY. grblHAL limits acceleration per motor, so a 45° scan gets a/√2. KerfDesk's automatic overscan and its Job Review runway advisory assume the Cartesian a·√2. Today the shipped 500 mm/s² happens to cancel this exactly at 45°. An operator who follows KerfDesk's own tooltip and enters the firmware's `$120=1000` gets about half the runway a 45° scan needs, and no advisory (K3-P2-2). Under constant power (M3) the scan edges then burn up to 1.34× the dose the Preview shows, so the refuter rates it P1.

**Settings reads.** Reading `$$` and `$I` is safe on this firmware. Two independent A1 Pro dumps completed normally. Creality lists LaserGRBL as supported for live control, and LaserGRBL sends `$$` and `$I` on every connect. KerfDesk's no-`$$` rule rests only on a LightBurn preference. It leaves Start's `$30`/`$32` check permanently unanswerable on the Falcon (K3-P3-1). Reading at connect would also settle the `$150`–`$152` question for the fix session.

**What matches.** `$30`/`$31`/`$32`, the S scale, the origin corner, the travel direction (358 × 268 sits inside 363 × 273) and the Home order all match.

## Settings table

The dump is rayforge PR #461. The LightBurn forum post 3 copy is identical on every row below.

**Not used by KerfDesk, and not tabled:**
- `$0`, `$2`–`$5`, `$9`, `$12`, `$14`–`$18`, `$26`, `$28`, `$29`, `$64`;
- the Trinamic current and driver rows `$140`–`$143`, `$200`–`$223`, `$338`/`$339`;
- `$341`–`$346`, `$376`, `$481`, `$486`–`$488`, `$810`–`$813`.

Grouped rows below give their match per setting.

| setting | dump value | meaning (grblHAL core `04a5edcf` + Trinamic plugin) | KerfDesk assumption (file:line on main) | match? |
|---|---|---|---|---|
| `$1`, `$37` | 100, 4 | Step idle delay 100 ms. `$37` "Specifies which steppers not to disable when stopped": Z only (settings.c L438, L678) | Not modelled. Release motors (`$SLP`) assumes the motors stay energized until it runs (`NoHomingPositionGuide.tsx:133-140`) | unknown: whether X/Y really de-energize at idle with the Trinamic hold current (Not verified) |
| `$10` | 511 | Report MPos, Bf, Ln, FS, Pn, WCO, Ov, probe, WCO sync (settings.c L456) | WCO and Ov arrive from bits 5 and 6 (`grblhal/driver.ts:90-92`). The Falcon never reads `$10` | match |
| `$11` | 0.010 | Junction deviation | `junctionDeviationMm: 0.01` (`device-profile.ts:413`) | match |
| `$13` | 0 | Reports in mm | mm assumed with no `$$` | match |
| `$20` | 0 | Soft limits off (settings.c L469, L653) | No firmware envelope is assumed under a command set (`manual-motion-limits.ts:136-146`). KerfDesk's own bed limits need homing on (K3-P2-1) | match (no reliance) |
| `$21` | 1 | Hard limits on, not strict (settings.c L472-477) | Not read. A hard-limit alarm is handled like any alarm | n/a |
| `$22` | 43 | Bits 0, 1, 3, 5: "Enable", "Enable single axis commands", "Set machine origin to 0", "Allow manual". Bit 2, "Homing on startup required", is clear (settings.c L480, getter L1586-1592) | `homing: { enabled: false }` (`device-profile.ts:408`, spread by `falcon-profiles.ts:6`) | **mismatch** (K3-P2-1) |
| `$23` | 3 | X and Y search for the switch in the negative direction (settings.c L484, L660). With `MirrorY: false` that is front-left. With bit 3, MPos is 0,0 at the pulled-off home (`kinematics/corexy.c` L108-127) | `direction: 'front-left'` (`device-profile.ts:408`). The vendor bed frame is native 0..358 × 0..268 (`native-bed-frame.ts:102-109`) | match |
| `$24`–`$27`, `$43`, `$180`–`$193` | 1000, 4000, 100, 5, 1; per-axis 1000 / 4000 | Homing feeds, debounce, pull-off and passes | Without `$$`, Home waits up to the 30-minute backstop (`laser-home-action.ts:75-83`) | match (no reliance) |
| `$44`–`$47` | 4, 1, 2, 0 | `$H` homes Z, then X, then Y. CoreXY refuses X and Y in one cycle (`corexy.c` L195-198) | Home sends `$HX` then `$HY` and leaves Z alone (`falcon-command-contract.ts:25`). Same as Creality's macro | match |
| `$30` | 1000.000 | Maximum S | `maxPowerS: 1000` (`device-profile.ts:397`). Creality's `S_Scale: 1000` | match |
| `$31` | 0.000 | Minimum S | `minPowerS: 0` (`device-profile.ts:398`) | match |
| `$32` | 1 | Laser mode (settings.c L493) | `laserModeEnabled: true` (`device-profile.ts:399`). Start can never verify it on this contract (`laser-mode-start-evidence.ts:99-104`) | match, unverifiable (K3-P3-1) |
| `$33`–`$36` | 1000, 0, 0, 1000 | PWM 1 kHz and off/min/max duty. Core caps `$34`–`$36` at "100" percent (settings.c L495-497). Creality's A1 Pro GRBL page says "max: 1000" for each, so these are vendor-scaled | Not read or written. Power is scaled by `$30` alone | n/a |
| `$39`, `$40` | 1, 1 | `?!~` act inside lines; `$J` limited for homed axes (settings.c L680-681) | The Console refuses those characters inside a line (`console-command.ts:45-55`). The Falcon jogs with G1, not `$J` | match / n/a |
| `$62` | 0 | Sleep disabled: `$SLP` returns `Status_InvalidStatement` (error:3) (system.c L767-777) | The no-homing guide's first action sends `$SLP` (`NoHomingPositionGuide.tsx:133-140`). The refusal text is `controller-sleep.ts:39-54` | **mismatch**: the step always fails on this build (KNOWN HF-4; part of K3-P2-1) |
| `$63` | 3 | "Disable laser during hold, Restore spindle and coolant state on resume" (settings.c L528) | Pause relies on the firmware to turn the laser off | match |
| `$100`–`$103` | 80, 80, 78.39, 8.9 | Steps/mm | Not used on the Falcon | n/a |
| `$110`/`$111` | 36000 | Per-motor maximum rate (CoreXY). Diagonal moves are capped at $110/√2 ≈ 25456 mm/min | `maxFeed: 36000` (`falcon-profiles.ts:42`), Creality's 600 mm/s. Frame runs at 10000 | match (diagonal cap harmless) |
| `$112`, `$122`, `$132` | 2000, 500, 33 | Z rate, acceleration and travel | No generic Z jog. `zTravelMm` unset | n/a |
| `$120`/`$121` | 1000 | Per-motor acceleration (CoreXY): along a scan at θ it is a/(\|cos θ\|+\|sin θ\|) | `accelMmPerSec2: 500` (`device-profile.ts:412`). The along-scan model is a/max(\|cos\|,\|sin\|) (`automatic-overscan.ts:53-56,105-110`) | value: KNOWN C7-P3-3 (safe direction). Model: **mismatch** (K3-P2-2) |
| `$130`/`$131` | 363, 273 | Maximum travel; MPos 0 is the pulled-off home | Bed 358 × 268 (`falcon-profiles.ts:17-18`), Creality's engraving area. The front-left Y flip uses 268 for burn and camera alike (`origin-transform.ts:57-58,72-75`) | match (5 mm of travel at the far edges unused; matches the vendor area) |
| `$150`–`$153` | 16 | X/Y/Z/A microsteps (Trinamic plugin) | Console writes 150–152 as "airflow"/"standby" (`falcon-command-contract.ts:55-59`) | **mismatch**, KNOWN J8-P3-2 (P1). Fixed on `ef52782a6` by #1486: the grblHAL Falcon contract lists no write |
| `$384` | 0 | G92 is saved and restored at power-up (settings.c L571, L763) | Set origin here is G92. Job Review's restored-origin warning covers it (`restored-origin-warning.ts:39-51`). The `$384` sentence needs `$$` | match (KNOWN ADR-375 M-4) |
| `$398`, `[OPT:…,512,65536,…]` | 512 | Planner blocks and receive buffer | The 1024-byte window is bounded by `Bf:` (`falcon-profiles.ts:20-24`). A maintainer saw `Bf:512,65535` | match |
| `$I` `[FIRMWARE:grblHAL]`; banner `GrblHAL 1.1f` | — | grblHAL at compatibility level 0 (XBitfield `$22`) | `controllerKind: 'grblhal'` (`falcon-profiles.ts:13`); banner detection at `detect-controller.ts:16` | match |
| `$I` `[KINEMATICS:CoreXY v2.02]` | — | Motor A = X+Y, B = X−Y. Rate and acceleration are limited per motor (`corexy.c` L66-78, L166-193; `planner.c` L345-356, L505-507; `motion_control.c` L80-84) | Cartesian per-axis model (`automatic-overscan.ts:5-10`; ADR-495 Decision 2; `scan-quality-warnings.ts:54-59`) | **mismatch** (K3-P2-2) |

## Findings

### K3-P2-1 — The A1 Pro preset says homing is off, but the firmware homes ($22=43), so KerfDesk's own A1 Pro bed frame never applies: every job gets a size-only preflight, no-go zones refuse Start, jogs have no bed limits, and the camera calibration says the machine "has no homing"

- **Where:**
  - **The belief.** The preset sets no `homing`, so it inherits `homing: { enabled: false, direction: 'front-left' }` (`src/core/devices/falcon-profiles.ts:5-72`; `src/core/devices/device-profile.ts:408`).
  - **The A1 Pro frame that needs it.** `resolveNativeBedFrame` returns null unless `device.homing.enabled` (`src/ui/state/native-bed-frame.ts:101`). That is before `hasVendorPositiveContract` (`:102-109`, `:118-131`), which exists only for this command set.
  - **What a missing frame removes:**
    - `trustedMotionOffsetForPreflight` returns undefined (`src/ui/job-placement.ts:176-177`).
    - Start then takes `preflightCoordinateMode: 'relative-origin'` for every placement, Absolute included, and adds the generic unverified-mapping warning (`src/ui/laser/start-job-readiness.ts:435-440`).
    - Preflight checks only the span (`src/core/preflight/preflight.ts:310-319`). It refuses any enabled zone with "No-go zones cannot be checked from this hand-set origin…" (`:230-238`). Every preflight issue blocks (`:196`).
    - Jog and click-to-position limits are null without a frame (`src/ui/state/manual-motion-limits.ts:50-54`, `:140-146`; `src/ui/workspace/position-laser-click.ts:126-128`).
  - **What the operator sees:**
    - Home becomes "Set up homing" (`src/ui/laser/JobSetupControls.tsx:76-88`, `src/ui/commands/laser-command-family.ts:39,63`).
    - The default Start from is User Origin, and the no-homing guide leads with `$SLP` (`job-placement.ts:35-46`, `NoHomingPositionGuide.tsx:133-140`).
    - The camera target note is "This machine has no homing…" instead of "Home the machine before engraving the target…" (`src/ui/camera/calibrate/CalibrationSetupStep.tsx:239-253`).
    - Print and Cut is unavailable (`src/ui/commands/use-app-commands.ts:99`, `print-cut-command-family.ts:17-18`).
    - The checkpoint banner offers no Home (`CheckpointResumeBanner.tsx:152`).
- **Anchor:**
  - **Ground truth.**
    - Both A1 Pro dumps read `$22=43` (rayforge PR #461; LightBurn topic 177926 post 3, archived 2025-12-08).
    - grblHAL `settings.c` @ `04a5edcf` [L480](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/settings.c#L480) names the bits: "Enable,Enable single axis commands,Homing on startup required,Set machine origin to 0". The getter is at [L1586-1592](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/settings.c#L1586-L1592). 43 is Enable, single-axis, origin 0 and manual, with the startup lock off.
    - Creality's own LightBurn device carries a Home macro `$HX\n$HY\n` (`.lbdev`, SHA-256 `9635b931…`). `HomeOnStartup: false` only means LightBurn does not home on connect.
    - Creality's troubleshooting page describes the normal job as "homing, preview, running engraving" (archived 2026-04-20). The Chinese troubleshooting page also tells owners to check the X/Y "限位开关" (limit switches).
  - **Twin.**
    - `hasVendorPositiveContract` (`native-bed-frame.ts:118-131`) was written for the A1 Pro's `NegativeWorkspace=false`, and the preset makes it unreachable.
    - Controller audit v3 D5-P3-4 assumed it worked: it described the size-only path as "always" on grblHAL "except the Falcon A1 Pro".
    - The dump makes the frame's assumption exact: `$23=3` plus bit 3 put MPos 0,0 at the front-left home (`kinematics/corexy.c` [L108-127](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/kinematics/corexy.c#L108-L127)).
  - **Not a contract.** The audit record `docs/audits/2026-09-21-coordinates-origin/machine-settings.md:63` calls homing off "the preset's initial local Home policy". That is an audit's description, not an ADR.
- **Scenario:**
  1. An A1 Pro owner picks the listed preset and connects. Home reads "Set up homing". The default flow's first step, Release motors, is refused every time, because the factory `$62=0` disables `$SLP`.
  2. The owner switches Start from to Absolute, or the camera target does it. They place a fill at canvas X 2–102 at 10000 mm/min.
     - The automatic runway is 25 mm (accel 500), so motion reaches X −23.
     - On the homed path, preflight refuses "X out of bed: -23" with the overscan note.
     - On the shipped preset, preflight checks only the span and passes. Job Review gives only the generic "controller-to-bed coordinate mapping is unverified".
     - On a machine that homed (MPos 0 is 5 mm off the X switch, `$27=5`), the run drives into the switch: `$21=1` raises ALARM:1 mid-job, the burn is half done and position is lost.
  3. The owner sets a no-go zone (the preset advertises `no-go-zones`). Every Start, Absolute included, is refused with "…cannot be checked from this hand-set origin…".
  4. The owner calibrates the camera. KerfDesk says the machine "has no homing" and does not say to home first. The rings are burned from whatever zero the controller holds. The calibration silently stops lining up after the next Home, whether from the screen, Falcon Design Space or LightBurn.
- **Evidence:** REPRO + SOURCE. Repro output on main's code:
  ```
  PRESET homing={"enabled":false,"direction":"front-left"} bed=358x268 …
  PARSED homingEnabled=true soft=false hard=true dirMask=3 forceOrigin=true bed=363x273 …
  PLACEMENT default startFrom=user-origin
  FRAME shipped(homing off, homed in session)=null
  FRAME homing on + homed={"nativeBounds":{"minX":0,"minY":0,"maxX":358,"maxY":268},"nativeToBedOffsetMm":{"x":0,"y":0}}
  JOGLIMITS shipped=null
  JOGLIMITS homing on={"minX":0,"minY":0,"maxX":358,"maxY":268}
  PREFLIGHT offset shipped absolute=undefined homing-on absolute={"x":0,"y":0}
  BOUNDS machine-mode (homing on, frame) issues=["X out of bed: -23"]
  BOUNDS relative-origin (shipped homing off) issues=[]
  ```
  The UI consequences (Home label, camera note, no-go refusal, Print and Cut) are READ.
- **Severity:** P2.
  - Every A1 Pro job is affected, and an ordinary user sees the "Set up homing" button, the failing first step, the blocked zone and the false camera note.
  - It is not P1: Job Review does warn that the bed mapping is unverified before output, and nothing burns where the operator did not place it. In the hard-limit case the firmware stops the job.
  - The refuter should weigh the X −23 case against §3: the warning there is generic, not about the runway.
- **Novelty:** New as a finding.
  - **Related KNOWN:** H6-P1-1 (rolling v4) named the homing-off default as the mechanism behind its camera P1. That fix (ADR-663 Amd 4) added a warning and kept homing off. HF-4 covers the `$SLP` text, D5-P3-4 the zone wording, and J8 "Not verified" left `$22=43` unassessed.
  - **Open PRs:** none touch these files (`gh pr list`: only #1478).
- **Refuter:** CONFIRMED, P2 (unchanged). It still holds on `ef52782a6`: #1486 left the homing flag alone.
  - **What would make it false:**
    - firmware with homing off (another build);
    - an ADR that keeps the A1 Pro homing-off on purpose;
    - a path that applies the vendor frame without `homing.enabled`.
  - **Checked: the firmware.**
    - Both re-fetched dumps read `$22=43`.
    - Both also print `HOME` in `[NEWOPT:…]`. Core prints that only when `settings.homing.flags.enabled` is set (`report.c` L920-924 @ `04a5edcf`). That is a second, independent line in each dump.
    - The rayforge contributor homed the unit.
    - The macro labelled "Home" in Creality's `.lbdev` is `$HX\n$HY\n`.
    - The `$22` bit names are the same at `f8f10aec` (`settings.c` L444).
  - **Checked: the ADRs.** No ADR keeps homing off.
    - ADR-322 §4 itself gives the contract's Home as "$HX followed by $HY".
    - ADR-663 Amd 4 mentions homing off only as context.
    - Machine Setup's Falcon guide also says KerfDesk "homes X then Y" (`machine-setup-controller-guide.ts:46`).
  - **Checked: the code.** `resolveNativeBedFrame` tests `device.homing.enabled` first (`native-bed-frame.ts:101`), and no other path builds the frame.
  - **Own repro (main's code):**
    ```
    PRESET homing={"enabled":false,"direction":"front-left"} accel=500 bed=358x268
    DUMP $22=43 -> homingEnabled=true hard=true soft=false dir=3; patch accel=1000 bed=363x273
    FRAME shipped=null homingOn={"minX":0,"minY":0,"maxX":358,"maxY":268}
    JOG shipped=null homingOn={"minX":0,"minY":0,"maxX":358,"maxY":268}
    PLACEMENT shipped=user-origin homingOn=absolute
    BOUNDS relative=[]   BOUNDS absolute=["X out of bed: -28.6"]   (a 30.6 mm runway before the 25 mm Fill cap)
    ```
  - **Corrections:**
    - **"Move laser here" is refused, not unlimited.** With no frame it toasts "The controller-to-bed mapping is unverified. Home with a supported coordinate mapping before moving to a canvas point." (`position-laser-click.ts:62-70`). The operator cannot follow that advice, because Home reads "Set up homing". The feature is lost; no unlimited move is made. Jog does have no bed limits (confirmed).
    - **Scenario 2 ends earlier.** Start's Frame traces the motion envelope, runway included (`frame-trace-flow.ts:178-182`, `computeFrameJobMotionBounds` in `job-bounds.ts:84-86`). On a homed unit the beam-off Frame therefore reaches the X switch and raises ALARM:1 before any burn. This job leaves no half-done burn.
    - **The origin citation.** `corexy.c` L108-127 @ `04a5edcf` is the v2.00 code. It has a bug: `if (cycle.mask & bit(--idx))` tests the A bit first, so `$HX` sets no origin. Core [`f8f10aec`](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L139-L154) fixed it ("Fixed bug in setting home position to 0 when CoreXY kinematics is enabled"). The dumped firmware reports v2.02, which has the fix, so MPos 0,0 is the pulled-off home. The conclusion holds; cite `f8f10aec` L139-154.
  - **Severity weighed against §3.** Job Review's `UNKNOWN_NATIVE_BED_MESSAGE` is generic, and H6-P1-1 already found it insufficient for a camera mismatch. So the refuter looked for a wrong output that only this message guards:
    - **X −23.** No wrong burn: Frame trips the hard limit beam-off first, so the job is refused.
    - **A jog past the bed.** The move is the operator's own command. On X−/Y− the `$21=1` switch raises an alarm. On X+/Y+ there is no switch and `$20=0`, so a long jog can reach the frame end. That is a lost clamp, not an unexpected move.
    - **Camera.** After the zero changes, camera-placed Absolute jobs burn away from the picture, and Start shows only the generic note. The zero changes on a power cycle of a unit that does not home itself, or after a Home in another program.
      - The specific warning comes at calibration: "…the camera lines up only while the controller keeps the zero it has when the target is engraved" (`CalibrationSetupStep.tsx:241-242`).
      - That is ADR-441 Amd 5 Decision 1's accepted advice for machines without homing. Its after-the-fact note (Decision 2) cannot fire here, because it needs a frame.
      - The refuter counts the calibration note as the specific warning, so the finding stays P2.
      - If checklist step 0 shows that the A1 Pro does not home at power-on, the coordinator should weigh this camera path for P1. A KerfDesk-only owner then never has a stable zero.
- **Fix direction:**
  - Ship the A1 Pro preset with `homing: { enabled: true, direction: 'front-left' }`, citing both dumps, their `NEWOPT` `HOME` and Creality's Home macro.
  - Bump `catalogVersion`, and add a preset-correction note for saved copies that still have homing off (ADR-322 Amd 1).
  - Alternatively, or as well, read `$22` at connect (K3-P3-1) and offer to turn homing on when bit 0 is set.

### K3-P2-2 — Automatic overscan and the Job Review runway advisory use a Cartesian acceleration model; on the A1 Pro's CoreXY grblHAL a 45° scan gets half the acceleration KerfDesk assumes

- **Where:**
  - `src/core/job/automatic-overscan.ts:5-10`, `:53-56` and `:105-110`: `alongScanAccelMmPerSec2 = a / max(|cos θ|, |sin θ|)`.
  - `src/ui/laser/scan-quality-warnings.ts:54-59`: the advisory uses the same function.
  - `src/ui/laser/PlannerAdvanced.tsx:42`: the tooltip tells the operator to "Use the lower of the controller's $120/$121 values".
  - `src/core/controllers/grbl/parse-settings.ts:176-179`: "Use detected values" copies min(`$120`, `$121`) on any profile that reads `$$`.
- **Anchor:**
  - **Contract.** ADR-495 Decision 2 (`docs/decisions/ADR-495-automatic-overscan-from-speed-and-acceleration.md`): "A 45° scan needs √2 times less runway than one along an axis." Decision 5 makes the advisory follow the same rule. Its Consequences say to read the acceleration from the controller (`$120`, `$121`).
  - **Ground truth.** grblHAL @ `04a5edcf` moves the planner into motor space:
    - `motion_control.c` [L80-84](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/motion_control.c#L80-L84) passes each target through `kinematics.segment_line`;
    - `kinematics/corexy.c` [L66-78](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/kinematics/corexy.c#L66-L78) transforms it, `target[X_AXIS] = position[X_AXIS] + position[Y_AXIS];`;
    - [L166-193](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/kinematics/corexy.c#L166-L193) rescales the feed;
    - `planner.c` [L345-356](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/planner.c#L345-L356) and [L505-507](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/planner.c#L505-L507) then limit each motor by `settings.axis[idx].acceleration`;
    - so the Cartesian acceleration along θ is a/(|cos θ|+|sin θ|): a along an axis, a/√2 at 45°.
    - The A1 Pro's `$I` reads `[KINEMATICS:CoreXY v2.02]` (rayforge PR #461).
- **Scenario:**
  1. The owner opens Machine Setup → Advanced. As the tooltip says, they enter the A1 Pro's `$120`/`$121` value of 1000. It is printed in both public dumps, and a typed `$$` shows it.
  2. They turn on Automatic overscan for an image at a 45° scan angle, or a fill hatched at 45°, at 10000 mm/min.
  3. KerfDesk computes a 10.9 mm runway. The firmware needs 19.6 mm to reach speed. The head enters the burn at about 124 mm/s, 74% of the commanded 167 mm/s, and is still accelerating for about 9 mm.
  4. On a Constant Power (M3) operation those ends over-burn. M4 scales power with speed, so the default mode mostly hides it.
  5. With a stored 5 mm runway, the advisory is silent where a stored runway is short. At 6000 mm/min and 45° it computes 3.5 mm needed against 7.1 mm real.
  - **Today's preset:** the error is masked. 500·√2 = 707 = 1000/√2, so at 45° KerfDesk's figure equals the real one, and at 0° KerfDesk's 500 is safely below 1000.
  - **Wider reach:** any CoreXY grblHAL machine whose `$$` KerfDesk reads gets the doubled figure from "Use detected values".
- **Evidence:** REPRO (KerfDesk side) + SOURCE (firmware side):
  ```
  OVERSCAN accel=500 angle=45 kerfdesk along=707 runway=21.7 | coreXY real along=707 needs=19.6 (x1.1=21.6)
  OVERSCAN accel=1000 angle=0 kerfdesk along=1000 runway=15.3 | coreXY real along=1000 needs=13.9 (x1.1=15.3)
  OVERSCAN accel=1000 angle=30 kerfdesk along=1155 runway=13.3 | coreXY real along=732 needs=19.0 (x1.1=20.9)
  OVERSCAN accel=1000 angle=45 kerfdesk along=1414 runway=10.9 | coreXY real along=707 needs=19.6 (x1.1=21.6)
  ```
  The "real" column is computed from the firmware source above, not measured on a machine.
- **Severity:** auditor P2; **refuter P1** (see Refuter below).
  - It is misleading advice: following KerfDesk's tooltip silences the runway advisory and halves the automatic runway on diagonal scans.
  - The burn effect needs Automatic overscan, which is off by default, a diagonal scan, and Constant Power to be clearly visible.
  - The refuter should weigh §3. If an M3 diagonal over-burn counts as wrong power output, reach cannot lower it. P2 is proposed because the shipped preset is exact at 45° and safe elsewhere.
- **Novelty:** New. No `docs/audits/` or ADR text applies CoreXY to ADR-495. The July 2026 motion audit (`2026-07-13-cnc-motion-control-drive-process-and-metrology.md` §5.2) said CoreXY "must map path motion to motor/joint motion first", in general terms only.
- **Refuter:** CONFIRMED; **severity raised to P1**. It holds on `ef52782a6`: no overscan, advisory or preset acceleration file changed.
  - **What would make it false:**
    - firmware that plans in Cartesian space;
    - vendor kinematics that limit acceleration differently;
    - a KerfDesk guard that adjusts the acceleration for CoreXY.
  - **Checked: is the unit CoreXY?** Both dumps say so twice: `[KINEMATICS:CoreXY v2.02]`, and `C` in `[OPT:…]`. Core adds that `C` only `#if COREXY` (`report.c` L828 @ `04a5edcf`).
  - **Checked: the firmware mechanism.** Re-derived at three core commits: `04a5edcf`, `f8f10aec` (the firmware's v2.02) and `35431d1b` (2026-07-26).
    - `transform_from_cartesian` is A = x+y, B = x−y (`35431d1b` corexy.c L68-78).
    - `segment_line` scales the feed by motor distance over Cartesian distance, which is √2 (L197-222).
    - `limit_acceleration_by_axis_maximum` takes min aᵢ/|uᵢ| in motor space ([planner.c L347-356](https://github.com/grblHAL/core/blob/35431d1bd39151935a9681354312f0bd23c70add/planner.c#L347-L356); the jerk and profile variants are compile options and use the same limit).
    - None of these changed between the three commits.
    - So the Cartesian acceleration along θ is a/(|cos θ|+|sin θ|). The refuter's own motor-space model matches that closed form to 3·10⁻¹³ over 0–180°.
  - **Checked: own repro** (KerfDesk's real functions; the "firmware" column comes from the model):
    ```
    ACCEL kd(a=500,45deg) along=707 runway=21.7 | firmware(1000) 707 needs 19.6 mm; entry 100.0%, M3 edge dose 1.00x
    ACCEL kd(a=1000,0deg) along=1000 runway=15.3 | firmware(1000) 1000 needs 13.9 mm; entry 100.0%, M3 edge dose 1.00x
    ACCEL kd(a=1000,30deg) along=1155 runway=13.3 | firmware(1000) 732 needs 19.0 mm; entry 139.5/166.7 mm/s (83.7%), M3 edge dose 1.19x, ramp into burn 5.7 mm
    ACCEL kd(a=1000,45deg) along=1414 runway=10.9 | firmware(1000) 707 needs 19.6 mm; entry 124.2/166.7 mm/s (74.5%), M3 edge dose 1.34x, ramp into burn 8.7 mm
    ADVISORY 6000/45 kd needs=3.54 real=7.07
    ```
  - **Checked: guards.** There are none.
    - `alongScanAccelMmPerSec2` has no kinematics input.
    - Automatic overscan has no dialect or angle condition (`automatic-overscan.ts:67-105`, `compile-job-raster.ts:208`, `fill-group-build.ts:42`).
    - GRBL Compatible (M3 images) can be chosen for grblHAL in Machine Setup.
  - **Extra reach.** Machine Setup's automatic fill copies acceleration even for a listed machine; only the work area is kept (ADR-637 Amd 2 Decision 1, `device-setup-auto-fill.ts:145-150`). So a CoreXY grblHAL set up with a `$$` read gets `$120` without anyone pressing a button.
  - **Open PR #1491** (constant-power advice) is not on main. It advises dialect-default M3 images about planner slowdown, says nothing about runways, and gives a hand-set Constant operation no advice.
  - **Severity: P1.**
    - **The dose error.** The entry speed is √(1.1 × 707/1414) = 74% of the feed at any feed. Under M3 the scan edge therefore gets 1.34× the dose, falling to 1.0× over 8.7 mm at 10000 mm/min (3.2 mm at 6000). At 30° it is 1.19× over 5.7 mm. This happens at both ends of every row.
    - **Why it counts as wrong output.** An image's Preview shows the intended tone, so the burn differs from what the app shows. That is the test that made Q1-P2-1 a P1. The runway advisory, the warning that exists for exactly this, is silent by construction when the runway is automatic.
    - **Reachable today.** It needs four settings: the GRBL Compatible dialect, Automatic overscan, a diagonal scan angle, and the acceleration KerfDesk's own tooltip asks for. §3 says narrow reach (settings off by default) cannot lower a reachable P1, and no specific warning reaches the operator.
    - **What stays P2-like.** Under the default M4 the dose stays near 1.0×, and the defect is only a wrong runway and estimate. A hand-set Constant Fill shows no tone, which is the Q6-P2-1 case and P2 on its own.
- **Fix direction:** Give the profile a kinematics field: CoreXY for the A1 Pro, and read `[KINEMATICS:…]` from `$I` where it is read. Use a/(|cos θ|+|sin θ|) for CoreXY in both `automaticOverscanMm` and `runwayWarning`. Amend ADR-495 Decision 2.

### K3-P3-1 — The Falcon contract's settings-fetch ban rests on a LightBurn preference; reading `$$`/`$I` is safe on this firmware, and the ban leaves Start's `$30`/`$32` check permanently unanswerable

- **Where:**
  - `src/core/controllers/falcon-command-contract.ts:6-9`, `:19` (`settings: 'none'`), `:26-27` and `:46`.
  - `src/ui/state/laser-mode-start-evidence.ts:99-104`: never verified while settings is `'none'`, even after a typed `$$` in the same session.
  - `src/ui/laser/laser-mode-start-acknowledgement.ts:10-13`: "Cancel and re-read the controller information when possible".
  - Twin: `src/ui/laser/device-setup/machine-setup-controller-guide.ts:38-47` lists no identity command, while the Falcon Console's quick row offers `$I` (repro: `quick=$X,$#,$I,$G,?`).
  - Drift: `falcon-profiles.ts:36-41` and `:59` say `$110`/`$111` "are not published and cannot be read". `native-bed-frame.ts:119-121` says the banner "is not recorded anywhere".
- **Anchor:**
  - **Contract.** DECISIONS.md ADR-322 item 4: "Its source disables settings fetch and native $J jogging". The source is the `.lbdev` `AllowSettingsFetch: false`, a LightBurn connect preference. ADR-370 does not hide `$$`; it only lists the numeric writes.
  - **Ground truth: reads are report-only.** grblHAL `system.c` @ `04a5edcf` [L203-204, L251, L262](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/system.c#L203-L262) maps `$$`, `$I` and `$ES` to report functions.
  - **Ground truth: two A1 Pro units answered `$$` in full.**
    - The rayforge PR body says "The `$I` and `$$` commands are read-only", and the contributor homed fine afterwards.
    - On the LightBurn forum, LightBurn itself read the unit's settings.
  - **Ground truth: Creality supports a program that reads at every connect.** Creality's FAQ (archived 2026-01-15) lists LaserGRBL to "control the device in real time via a data cable". LaserGRBL calls `RefreshConfigOnConnect` on every connect (`GrblCore.cs` @ `1f9337b3` L503-506). It sends `new GrblCommand("$$")` (L1025) and `$I` (L911-918, on by default).
  - **Likely reason for the flag (inference, not proven).**
    - LightBurn staff on topic 177926 (post 6) explained the mismatch notice that settings fetch raises: the firmware's 363 × 273 against the profile's 358 × 268. They said they did not know "the correct maximum travel of the axes on the A1 Pro".
    - After Creality's updated device profile, the owner reported "And the workspace error is gone." (post 14).
- **Scenario:**
  - Every A1 Pro Start asks the operator to confirm that `$30`/`$32` are unverified and to "re-read the controller information". A typed `$$` that shows `$30=1000 $32=1` cannot clear it.
  - KerfDesk cannot see `$22` (K3-P2-1), `$62`, `$10`, `$384`, or whether `$150`–`$152` are microsteps (J8-P3-2), on the user's actual unit.
- **Evidence:** REPRO + SOURCE.
  ```
  DRIVER settings=none settingsQuery=null buildInfoQuery=null home="$HX\n$HY" quick=$X,$#,$I,$G,? writes=150,151,152
  CONSOLE $$ -> ok kind=settings-query effect=read-only confirm=false
  CONSOLE $ES -> ok kind=report-query effect=read-only confirm=false
  LASERMODE verified with a current $$ showing $30=1000 $32=1 on this driver=false
  ```
- **Counter-evidence considered:**
  - LightBurn staff on topic 177926 (post 13) wrote that the A1 Pro "is not using a standard GRBL firmware".
  - One owner there saw `error:7` ("EEPROM read error") at each connect on firmware older than V1.0.38. The command that drew it cannot be told from the log, and the same session's `$$` completed.
  - In grblHAL the only report that can return error:7 is `$#`. A failed coordinate read rewrites that record to zero (`settings.c` [L2011-2021](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/settings.c#L2011-L2021); `report.c` L580-583). So `$#` is left out of the checklist below.
  - No source reports `$$`, `$I` or `$ES` misbehaving on an A1 Pro.
- **Severity:** P3. Nothing burns wrongly: the acknowledgement is honest that settings are unverified. The cost is a prompt that can never be satisfied, plus everything K3-P2-1 and J8-P3-2 cannot check.
- **Novelty:** Partly KNOWN. ADR-322 §4 records the ban, and HF-4 noted that `$62` "was never read". New here: the evidence that reading is safe, the unanswerable prompt, and the guide/Console twin.
- **Refuter:** CONFIRMED, P3 (unchanged). It holds on `ef52782a6`.
  - **On `ef52782a6`:** #1486 kept `settings: 'none'` and both queries null. ADR-370 Amendment 1 item 5 now restates the ban, again citing Creality's LightBurn device and not a firmware hazard. The fix needs to amend that item too.
  - **What would make it false:** a read that writes or moves on this firmware, or a contract that grounds the ban in a hazard.
  - **Checked: the firmware.** `$$`, `$I` and `$ES` map to report functions at `04a5edcf` (`system.c` L203-262) and at `f8f10aec` (`system.c` L838-916). `report_grbl_settings` and `report_settings_details` read the settings held in RAM.
  - **Checked: KerfDesk.**
    - Start's evidence requires `settingsCapability !== 'none'` (`laser-mode-start-evidence.ts:99-104`), so a typed `$$` cannot clear the prompt.
    - A Falcon connect sends only the realtime `?` and `$G` (`laser-controller-handshake.ts:157-160`, `:180-198`; `active-wcs-readback.ts`).
    - An idle disconnect sends nothing (`laser-store-helpers.ts:244-261`).
  - **Checked: other software.** LaserGRBL reads `$$` and `$I` at connect (confirmed @ `1f9337b3`).
  - **Corrections:**
    - **`$I` is not strictly write-free.** `build_info` calls `settings_read_build_info`, which rewrites a corrupt build-info record as an empty line (`settings.c` L1959-1967 @ `04a5edcf`; same at `f8f10aec`). That record holds only the free-text label in `[VER:…:<label>]`, so `$I` stays safe in practice. The read-only claim should say so.
    - **"The only report that can return error:7 is `$#`" is too narrow.** `$N` can return it too (`system.c` L913-914), and `gc_init` reports it at every reset for the active WCS, and at cold start for G92 (`gcode.c` L316-320).
    - **"The command that drew it cannot be told from the log" is wrong for that log.** Post 3's connect log prints `[G54:…]` through `[G28:…]` and then `error:7`. `report_ngc_parameters` reads G28 and then G30 (`report.c` L578-583), so `$#`'s reply failed on the G30 record. So `$#` drew that `error:7`. The owner kept seeing it (posts 7 and 14), so the rewrite did not stick on that unit. LightBurn's connect sent that `$#` (`$I`, `$#` in post 3). This strengthens the checklist's exclusion of `$#`.
- **Fix direction:**
  - Let the Falcon contract read `$I` and `$$` at connect, read-only, with no write surface added.
  - Use the reads to verify `$30`/`$32`, show `$22` and `$62`, and gate the `$150`–`$152` writes on what the controller reports, which the fix session needs.
  - Keep ADR-637 Amd 2's rule that the listed 358 × 268 survives the read. Keep "Use detected values" from copying `$130`/`$131` over a listed machine.
  - Amend ADR-322 §4.

### K3-P3-2 — Two published A1 Pro dumps now settle facts the preset's evidence notes and comments still call unknown

- **Where:**
  - `falcon-profiles.ts:59`: "`$110`/`$111` are not published and cannot be read".
  - `falcon-profiles.ts:64`: "the exact firmware build is not independently established".
  - `native-bed-frame.ts:119-121`: the banner "is not recorded anywhere".
  - `falcon-profiles.ts:26-31` and `device-profile.ts:248-260`: these present `$152` as the A1 Pro's standby timer. KNOWN, J8-P3-2 fix session.
- **Anchor:** Ground truth: both dumps report `$110/$111=36000`, `[FIRMWARE:grblHAL]`, `[BOARD:A1 Pro Laser Master]`, `[KINEMATICS:CoreXY v2.02]` and the banner `GrblHAL 1.1f`. Contract: AGENTS.md "Never invent controller settings" asks for sources.
- **Scenario:** A maintainer reading the evidence note concludes that `$110`, the firmware family and `$22` are unknowable. That led to decisions like homing off (K3-P2-1) being kept.
- **Evidence:** READ + SOURCE.
- **Severity:** P3 (provenance).
- **Refuter:** CONFIRMED, P3 (unchanged). It holds on `ef52782a6`: #1486 changed only the air comments in `falcon-profiles.ts`. Both evidence notes are unchanged, now at `:60` and `:65`. `native-bed-frame.ts:119-121` is unchanged.
  - **Checked:** the three texts against both re-fetched dumps.
  - **Corrections to the fix direction:**
    - **Both units print `[Firmware:Version v1.0.4]`.** The 2025-08 unit reports `[BUILD:20250618205542]` and the 2026-09 unit `[BUILD:20260706154934]`.
    - **"Before V1.0.38" is another poster's firmware.** It comes from AdiGital (post 12). The dumped unit (serjforius) reads v1.0.4.
    - **The firmware is Creality's modified grblHAL.** It reports core build 20231005, but runs CoreXY v2.02 from core 20241120 and prints an extra version line (see the header). So "the exact firmware build is not independently established" stays partly true. Cite it as Creality's grblHAL fork reporting core 20231005, not as stock core `04a5edcf`.
- **Fix direction:** Cite both transcripts in the preset's evidence: vendor version v1.0.4, builds 20260706154934 and 20250618205542. Say that the maintainer's own unit is still unread.

## Maintainer read-only checklist

Reading is safe (K3-P3-1). These steps send no write command, no motion and no laser command.

One caveat: grblHAL rewrites a stored record that it finds corrupt while reading it.
- For `$I` that record is only the free-text build label (`settings.c` L1959-1967), so `$I` stays in.
- For `$#` it is a work offset, so `$#` stays out (below).

**Refuter verdict: safe as corrected.**
- **Checked against stock grblHAL source** at `04a5edcf` and `f8f10aec`: `$I`, `$$`, `$ES` and `?` are reports. None writes a setting, resets or homes, and `$H` is not in the table.
- **What could not be checked:** Creality's own changes to the firmware. As a cross-check, LightBurn and rayforge have read `$$` and `$I` on A1 Pros with no harm reported, and LaserGRBL, which Creality lists, reads both at every connect.
- **What the refuter corrected:**
  - which console to use, and the Console's quick buttons;
  - Machine Setup's automatic fill;
  - step 3's condition;
  - step 0's moving head.

**Before you start:**
- Run them with the lid closed and no job running.
- **Use KerfDesk's Console on the Falcon preset only.**
  - On this preset, connecting sends only the status query `?` and `$G`, and an idle disconnect sends nothing.
  - Typed `$I`, `$$`, `$ES` and `?` are read-only there, with no confirmation (refuter repro).
  - **Do not use LightBurn.** Its connect sent `$#` to an A1 Pro (topic 177926 post 3).
  - **Do not use LaserGRBL either.** By default it soft-resets the controller at connect ("Reset Grbl On Connect", `GrblCore.cs` L2011).
- **Type each command.** Do not click the Console's quick buttons. On this preset they include `$X` (unlock) and `$#`.
- **Never send a line that contains `=`.**
  - KerfDesk builds before #1486 (`ef52782a6`) also told A1 Pro owners in Job Review to "send $152=100". Ignore that advice: on this firmware `$152` is the Z microstep setting.
- **Keep Machine Setup closed.**
  - After `$$`, KerfDesk shows a toast about detected values. Do not press **Use detected values**: it would copy the 363 × 273 travel and acceleration 1000 into the profile.
  - With Machine Setup open on a new machine, KerfDesk fills acceleration 1000 by itself; the listed 358 × 268 is kept. If that happens, press Undo or close without saving.
  - These are changes to KerfDesk's profile only. Nothing here writes to the controller.

| # | Send | What it settles |
|---|---|---|
| 0 | Nothing. Power the machine on and watch the head. Keep your hands clear of the gantry, because it may home by itself | Whether the A1 Pro homes itself at power-on. This decides whether camera and Absolute coordinates survive a power cycle without a KerfDesk Home. It also decides whether K3-P2-1's camera path should be weighed for P1. |
| 1 | `$I` | **Firmware:** `[FIRMWARE:grblHAL]` and the build/version against v1.0.4, build 20260706. **Hardware:** `[KINEMATICS:CoreXY …]` (K3-P2-2) and `[PLUGIN:Trinamic …]` (J8-P3-2). **Options:** `[NEWOPT:…ENUMS…]` (whether step 3 exists), and the receive buffer in `[OPT:…]`. |
| 2 | `$$` | **Homing:** `$22` (is bit 0 set? is bit 2, the startup lock, clear? K3-P2-1), `$23` and `$27`. **Limits:** `$20`/`$21`. **Power:** `$30`/`$31`/`$32` against S1000 and laser mode. **Release motors:** `$62` (does it fail?). **Reports:** `$10` (WCO fields). **Motion:** `$110`/`$111`, `$120`/`$121` (do not enter 1000 into Machine Setup until K3-P2-2 is fixed). **Travel:** `$130`/`$131`. **The open question:** `$150`–`$153` (16 means microsteps: never send `$150`–`$152`). **Origin:** `$384` (G92 kept at power-up). |
| 3 | `$ES` (step 1 will list `ENUMS`: this core always prints it, `report.c` L920, and both dumps show it) | The firmware's own name for settings 150–153 ("…microsteps" or an air setting). This settles J8-P3-2 for this unit. The output runs to over 100 lines; KerfDesk's Console keeps the last 500. |
| 4 | `?` | MPos, `Bf:` (compare 512,65535) and whether `WCO:` appears. |

**Left out on purpose:**
- `$#`: on grblHAL a corrupt offset record is rewritten to zero (`settings.c` L2011-2021).
  - The refuter confirmed this at `04a5edcf` and `f8f10aec`.
  - On one A1 Pro (topic 177926 post 3), LightBurn's connect-time `$#` drew `error:7` on the G30 record, and the owner kept seeing `error:7` afterwards (posts 7 and 14).
- `$H`, `$HX`/`$HY`, `$HZ1`, `$X`, `$SLP`, `$RST`, and any `$N=`.

## KNOWN re-observed

- **J8-P3-2 (P1, rolling v5): the `$150`–`$152` "air" writes are microsteps.**
  - The second dump (LightBurn topic 177926, 2025-08) independently shows `$150=16 $151=16 $152=16 $153=16`.
  - The card "Falcon A1 Pro: no $150–$152 air writes on grblHAL" owns the fix. It is not re-raised here.
  - **Refuter:** fixed on `ef52782a6` by #1486 (ADR-370 Amendment 1). The grblHAL Falcon contract lists no Console write, and the A1 Pro gets no `$152=100` advice.
- **C7-P3-3: the A1 Pro inherits 500 mm/s².** The firmware is 1000 on both units. Estimates run long and runways are longer than needed (safe direction).
- **HF-1 (controller audit 2026-09-25, fixed): Falcon Home relock.** Both dumps have the startup lock off (`$22` bit 2 clear), so the relock race does not arise on these builds.
- **HF-4 / HF-7 (fixed text): Release motors refused.** Both dumps have `$62=0`, so `$SLP` is always refused on the default flow's first step (folded into K3-P2-1).
- **HF-8: grblHAL greeting as "Grbl 1.1f".** Not applicable: this firmware greets `GrblHAL 1.1f` (topic 177926).
- **HF "Not covered" / ADR-375 M-4: G92 persistence.** `$384=0` on both units, so G92 survives power cycles. Covered by the restored-origin warning; the `$384` sentence needs `$$` (K3-P3-1).
- **H6-P1-1 (fixed by ADR-663 Amd 4).** The homing-off default makes User Origin the default on the A1 Pro.
- **D5-P3-4: the "hand-set origin" zone message on Absolute jobs.** D5 thought the A1 Pro was exempt; with homing off it is not (K3-P2-1).
- **ADR-322 §4 / J8 (firmware build unknown).** Two units now report grblHAL core 20231005 on "A1 Pro Laser Master". The maintainer's unit is still unread.

## Refuted

- **"358 × 268 refuses jobs the A1 Pro could run."** Creality's engraving area is 358 × 268: the FAQ (archived 2026-01-15) answers "358mm*268mm". The extra 5 mm of `$130`/`$131` equals the `$27=5` pull-off. KerfDesk matches the vendor's usable area.
- **"The 268 vs 273 height shifts Absolute or camera positions."** With front-left origin, MPos 0 is the front-left home (`$23=3`, `$22` bit 3). `toMachineCoords` flips with 268 for burns and camera alike (`origin-transform.ts:57-58,72-75`). The vendor frame maps native 0..358 × 0..268 one-to-one, the same as LightBurn's Absolute.
- **"`$30`/`$31`/`$32` disagree with the preset."** All three match (1000 / 0 / laser).
- **"`$HX` then `$HY` is wrong on CoreXY."** grblHAL's CoreXY refuses only X and Y in one cycle (`corexy.c` L195-198). Two single-axis cycles are valid, and they are Creality's own macro.
- **"Falcon jogs or Frame exceed the CoreXY motor limit."** The firmware caps a diagonal at $110/√2 ≈ 25456 mm/min. KerfDesk's Frame feed is 10000, and the Falcon has no hold-to-jog (`jogCancel: false`). At worst a move runs slower than asked.
- **"The laser dot cannot fire in laser mode (`$32=1`)."** ADR-664 Decision sends Fire's own `G1 F… M3 S…`, a motion line, as LightBurn's Fire does.
- **"`$36=1000` means the PWM is mis-scaled."** Creality's A1 Pro GRBL page documents `$34`–`$36` with "max: 1000" (a vendor scale). KerfDesk neither reads nor writes them, and scales power by `$30` alone.
- **"Reading `$$` is unsafe on Creality firmware."** See K3-P3-1. No source shows `$$`, `$I` or `$ES` misbehaving.

## Verified clean

- **Matches.** S scale, laser mode, `$31`, origin corner, travel direction, Home order, `$10` fields, junction deviation, mm reports, the `$110`/`$111` feed ceiling, the receive window against `$398`/`Bf`, and grblHAL family and banner detection (`detect-controller.ts:16`).
- **Firmware behaviour on read.** `$$`, `$I` and `$ES` are report-only in grblHAL core (`system.c` L203-262). The Falcon Console classifies them read-only with no confirmation (repro).
- **The KerfDesk `$$` parser on the A1 Pro dump.** It yields homing true, soft limits false, hard limits true, direction mask 3, force-origin true, 363 × 273, 36000, accel 1000, S 0–1000, laser mode true, G92 persistence on (repro `PARSED`). These are the right meanings for every field it reads.
- **The vendor bed frame.** With homing on and a KerfDesk Home, the frame is exactly native 0..358 × 0..268 with zero offset, and jog limits follow it (repro).
- **ADR-660.** The Falcon-compatible fallback is stock-GRBL, withdrawn, and has no command set, so nothing in this report applies to it.

## Not verified

- **The maintainer's own A1 Pro.** Its firmware version and settings, and whether it homes at power-on, are unread. Use the checklist. The two dumps come from other units (2025-08, before V1.0.38; 2026-09, v1.0.4).
- **Whether X/Y de-energize at idle.** `$1=100` with `$37=4` keeps only Z enabled. With Trinamic hold current that may or may not let the head be pushed.
- **The `error:7` on one 2025-08 unit.** ~~Its trigger cannot be attributed.~~
  - **Refuter:** post 3's log attributes one `error:7` to `$#` failing on the G30 record (see K3-P3-1).
  - Still not attributed: the power-on "G0 / error:7" of post 7. It may be `gc_init`'s read at reset (`gcode.c` L316-320).
  - KerfDesk's Frame step "Select G54" reads only the G54 record. So it would meet the error only if G54 itself were corrupt.
- **Creality wiki archives and the LightBurn topic's archive HTML.** The refuter could not re-fetch them: the Wayback Machine returned a bot block. The topic content was checked through the live topic JSON instead.
- **Creality's firmware changes.** Read-only behaviour was checked against stock grblHAL at two commits. The vendor fork's source is not public.
- **Creality code 01001046, "home the machine to continue".** This is grblHAL `Status_HomingRequired` (`errors.h` L78), returned at `$X` when the startup lock is on (`system.c` L640-643). The published dumps have the lock off; other builds were not seen.
- **Ortur LM3 grblHAL presets.** No LM3 `$$` was checked. They read `$$` at connect, so Job Review shows `$22`, and the LM3 is a Cartesian gantry, so K3-P2-2 does not apply. Their homing default is the same inherited off.
- **FluidNC CoreXY.** Whether FluidNC limits acceleration per motor too was not read. K3-P2-2's wider reach is claimed for grblHAL only.
- **What a typed `$$` triggers on the Falcon.** Whether Machine Setup shows a detected-settings review was not run in a browser.
  - **Refuter, by reading the code:** the read fills `detectedSettings`, and `DetectedSettingsToast` shows an info toast. Nothing is applied by itself, except Machine Setup's automatic fill on a new machine, or after Find my machine in that setup (`use-controller-auto-fill.ts`). That fill copies acceleration but keeps a listed machine's work area.
  - Nothing writes to the controller. Still not run in a browser.
- **Other Creality wiki pages.** The English firmware, usage and troubleshooting snapshots (Wayback 429) were read only in their live Chinese versions.

```json
[
  {"id":"K3-P2-1","severity":"P2","area":"falcon-a1-pro-truth","file":"src/core/devices/falcon-profiles.ts","line":5,"anchor":"Ground truth: A1 Pro $$ $22=43 (rayforge PR #461 merge 2ed50476, body sha256 49f2cf09...1db90d0; LightBurn topic 177926 post 3, web.archive.org/web/20251208074651); grblHAL settings.c @ 04a5edcf L480, L1586-1592; Creality .lbdev Home macro $HX/$HY (sha256 9635b931...); Creality 'homing, preview, running engraving' (web.archive.org/web/20260420214030). Twin: native-bed-frame.ts:101-131 hasVendorPositiveContract unreachable with homing off; D5-P3-4 assumed the Falcon gets the frame","evidence":"REPRO (zz-k3-falcon-truth.test.ts; refuter zz-k3r-falcon-refute.test.ts: FRAME null shipped vs 0..358x268 homing on; JOG null; BOUNDS relative passes, absolute refuses) + SOURCE (both dumps 2=43 and NEWOPT HOME; corexy.c v2.02 @ f8f10aec L139-154) + READ (UI copy)","verdict":"CONFIRMED (refuter: P2 kept; holds on ef52782a6; Move laser here is refused not unlimited; Start Frame trips the hard limit beam-off before any burn; camera path to be re-weighed for P1 if the A1 Pro does not home at power-on)","known":"partly: H6-P1-1 mechanism, HF-4, D5-P3-4","summary":"The A1 Pro preset inherits homing off while the firmware has $22=43 and Creality homes before every job; KerfDesk's own A1 Pro bed frame then never applies: size-only preflight on every job (Absolute included), no-go zones refuse every Start, no jog or click-to-position limits, Home reads 'Set up homing', camera calibration says 'This machine has no homing', and the default guide starts with $SLP which $62=0 always refuses"},
  {"id":"K3-P2-2","severity":"P1","area":"falcon-a1-pro-truth","file":"src/core/job/automatic-overscan.ts","line":54,"anchor":"Contract: ADR-495 Decision 2 (45 deg scan gets a*sqrt2) and Decision 5; Ground truth: grblHAL @ 04a5edcf motion_control.c L80-84, kinematics/corexy.c L66-78 L166-193, planner.c L345-356 L505-507 (per-motor accel => a/(|cos|+|sin|)); A1 Pro $I [KINEMATICS:CoreXY v2.02]","evidence":"REPRO (KerfDesk runway 10.9 mm at 45 deg/10000 mm/min/accel 1000 vs 19.6 mm needed; refuter motor-space model matches a/(|c|+|s|) to 3e-13; M3 edge dose 1.34x at 45 deg, 1.19x at 30 deg, any feed) + SOURCE (corexy.c and planner.c unchanged at 04a5edcf, f8f10aec, 35431d1b; both dumps CoreXY in KINEMATICS and OPT C)","verdict":"CONFIRMED (refuter raised P2 to P1: M3 image edges burn up to 1.34x the Preview dose with the runway advisory silent; reachable today; holds on ef52782a6)","known":false,"summary":"Automatic overscan and the Job Review runway advisory model acceleration as Cartesian; on CoreXY grblHAL a 45 deg scan gets a/sqrt2, not a*sqrt2. Masked exactly on the shipped A1 Pro (500 vs real 1000); entering the firmware's $120=1000 as KerfDesk's tooltip advises halves diagonal runways and silences the advisory; any CoreXY grblHAL with Use detected values is affected"},
  {"id":"K3-P3-1","severity":"P3","area":"falcon-a1-pro-truth","file":"src/core/controllers/falcon-command-contract.ts","line":19,"anchor":"Contract: DECISIONS.md ADR-322 item 4 (settings fetch disabled, from LightBurn AllowSettingsFetch=false); Ground truth: grblHAL system.c @ 04a5edcf L203-262 ($$, $I, $ES report-only); two A1 Pro dumps answered; Creality FAQ lists LaserGRBL, which sends $$ and $I every connect (GrblCore.cs @ 1f9337b3 L503-506, L911-918, L1013-1025); Twin: machine-setup-controller-guide.ts:38-47 vs Console quick $I","evidence":"REPRO (Console $/$I/$ES read-only; laserModeStartSnapshotIsVerified false with a current $ on settings 'none') + SOURCE","verdict":"CONFIRMED (refuter: P3 kept; holds on ef52782a6, where ADR-370 Amd 1 item 5 restates the ban; $I also rewrites a corrupt build-info label; the forum error:7 is attributable to $#)","known":"partly: ADR-322 item 4, HF-4","summary":"The Falcon no-$$ rule rests on a LightBurn preference; reading $$/$I is safe on this firmware. The ban makes Start's $30/$32 acknowledgement permanently unanswerable (a typed $$ never counts) and hides $22, $62, $10, $384 and the $150-$152 meaning; recommend a read-only $I/$$ at connect"},
  {"id":"K3-P3-2","severity":"P3","area":"falcon-a1-pro-truth","file":"src/core/devices/falcon-profiles.ts","line":59,"anchor":"Ground truth: both A1 Pro dumps ($110/$111=36000, grblHAL, CoreXY, banner GrblHAL 1.1f); Contract: AGENTS.md never invent controller settings","evidence":"READ + SOURCE","verdict":"CONFIRMED (refuter: P3 kept; notes unchanged on ef52782a6 at falcon-profiles.ts:60,:65; both units print Firmware:Version v1.0.4; firmware is a vendor grblHAL fork, not stock 04a5edcf)","known":false,"summary":"Preset evidence notes and comments still say $110/$111, the firmware build and the banner are unknown or unreadable; two public dumps now settle them and should be cited"}
]
```
