# Track CN (partial) — CNC controllers: which controllers real CNC machines use, and what KerfDesk supports

Status: PARTIAL, written mid-track (2026-09-25). Repro tests live in `src/__audit_repro__/CN/`.
Upstream trees are the pinned ones in the shared brief. No hardware was used.

## Short answer to the owner

Yes. Hobby CNC machines ship with different controllers. Most desktop routers speak the GRBL
protocol (GRBL 1.1, grblHAL, FluidNC), and KerfDesk can drive those live. Others use Marlin or
Smoothieware (KerfDesk has live drivers, but CNC jobs are refused), or PC/stand-alone controllers
(Mach3/Mach4, Centroid, UCCNC, MASSO, Buildbotics, Redline, DDCSV, Duet/RepRapFirmware) that
KerfDesk cannot drive at all. For those, the only path is Save G-code, and that file is always
the GRBL CNC dialect. Nothing in the Save flow says so.

## Part 1 — What KerfDesk supports for CNC today (code)

- `cncJobs` is true only for the GRBL family: `grbl/driver.ts:57` (grblHAL and FluidNC spread it,
  `grblhal/driver.ts:12-21`, `fluidnc/driver.ts:76-91`; the Falcon wrapper keeps it). False for
  Marlin (`marlin/driver.ts:49`), Smoothieware (`smoothieware/driver.ts:46`), Ruida
  (`ruida/driver.ts:31`). Comment `controller-capabilities.ts:67-71`: "CNC spindle jobs (ADR-098: CNC
  is GRBL-only) ... Marlin reads P as milliseconds". ADR-098 itself does not say "GRBL-only"; the
  scope comes from ADR-094/095/096 plus this flag.
- Enforcement: Machine Setup validation `device-setup-flow.ts:391-393` ("… cannot run KerfDesk CNC
  jobs. Choose a GRBL-family controller."), an alert inside the collapsed "Controller and connection
  settings" (`DeviceSetupIdentifyStep.tsx:52-57`), Job Review warning `CNC_REQUIRES_GRBL_MESSAGE`
  (`start-job-readiness-policy.ts:20-28`), Start refusal `assertActiveDriverAcceptsMachineKind`
  (`laser-start-program-assertions.ts:74-82`, called `laser-job-actions.ts:220`). Not checked:
  the Laser|CNC toggle (`MachineModeToggle.tsx:16-20` only checks capability labels), Connect, Save
  G-code, tile export, surfacing export.
- One CNC dialect only: CNC projects always emit through `emitCncJobWithPassSpans`
  (`emit-gcode.ts:140-163`), which ignores the device (`cnc-grbl-strategy.ts:101-104`, `_device`).
  Tiles use `cncGrblStrategy.emit` (`tile-emission.ts:62`), surfacing has its own GRBL-shaped
  emitter (`core/cnc/surfacing.ts:103-139`). The CNC file header always says
  `; assumes: GRBL $30=<rpm> ... $32=0 (router mode)` (`gcode-metadata.ts:128-132`,
  `emit-gcode.ts:296-307` ignores controllerKind for CNC).
- Emitted CNC vocabulary: `;` comments, G21 G90 G54 G94 G17, G0/G1, G2/G3 with incremental I/J,
  `M3 S<rpm>`, `G4 P<seconds, 3 decimals>` (e.g. `G4 P3.000`), M5, M7/M8/M9 when coolant is on,
  tool change = retract + M5 + park + `M0` (no T/M6), no canned cycles, no M30.
- CNC machine catalog (`cnc-machine-catalog.ts`): 10 geometry/RPM presets; `controllerSupport` is
  display-only (`DeviceSetupCncPreset.tsx:93`); loading a preset never changes controllerKind
  (`DeviceSetupCncPreset.tsx:18-31`, disclosed in the UI). `applyCncMachinePreset`
  (`machine-actions.ts:176`) has no UI caller.
- Device profiles: only `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE` carries `cnc-output` and a
  `cncSubProfile` (`device-profile.ts:376-454`), controllerKind `grbl-v1.1`. Generic
  GRBL/grblHAL/FluidNC profiles have no kind label (both modes allowed); generic Marlin, Smoothieware
  and Ruida are labelled laser-only.

## Part 2 — Machine table (research so far)

| Machine | Controller / firmware | Protocol family | KerfDesk support today | Source + quote |
|---|---|---|---|---|
| Genmitsu 3018-PRO | GRBL on Arduino (8-bit) | GRBL | Live CNC (grbl-v1.1) | https://www.sainsmart.com/products/sainsmart-genmitsu-cnc-router-3018-pro-diy-kit — "It's built on Arduino and Grbl (both open source)" |
| Genmitsu 3020-PRO MAX V2 | GRBL V1.1 | GRBL | Live CNC (grbl-v1.1) | https://www.sainsmart.com/products/3020-pro-max-v2 — "While remaining based on open-source Grbl V1.1, the 3020-PRO MAX V2 CNC router has been upgraded with high-powered Toshiba TB6S109 drivers featuring 32-bit chips" |
| Genmitsu 4040-PRO (and 4040-PRO MAX) | GRBL, 32-bit MCU, CTL4040 offline controller | GRBL | Live CNC (grbl-v1.1) | https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting — spec table "Control: GRBL", "MCU: 32bits"; https://www.sainsmart.com/products/4040-pro-max — "a comprehensive control system with GRBL firmware-compatible software (such as Candle, LaserGRBL, and LightBurn)" |
| Genmitsu PROVerXL 4030 V2 | GRBL 1.1h | GRBL | Live CNC (grbl-v1.1) | https://www.sainsmart.com/products/proverxl-4030-v2 — "Operate the machine with ease via USB interface using software such as Candle or Universal Gcode Sender thanks to the GRBL-based control board." / "Control Board Compatibility: GRBL 1.1h" |
| Sienci LongMill MK2 (LongBoard) | grbl v1.1h on Arduino Uno | GRBL | Live CNC (grbl-v1.1) | https://resources.sienci.com/view/lmk2-mk2-specs/?print=print — "The LongBoard uses an Arduino Uno running grbl v1.1h powering four 4A TB6600 motor drivers." |
| Sienci LongMill MK2 (SuperLongBoard) | grblHAL on STM32F412 | GRBL (grblHAL) | Live CNC (grblhal) | same page — "SuperLongBoard 5xHAL uses an STM32F412 chip running grblHAL powering four TMC2660C motor drivers." |
| Sienci AltMill | SLB-EXT, grblHAL | GRBL (grblHAL) | Live CNC (grblhal) | https://resources.sienci.com/view/am-about-your-altmill/ — "32-bit SLB-Ext controller running grblHAL firmware, with signal outputs to integrated driver stepper motors." |
| Carbide 3D Shapeoko 3 | Carbide Motion board, GRBL 1.1 | GRBL | Live CNC (grbl-v1.1); vendor build not qualified | https://my.carbide3d.com/pdf/shapeoko3_assembly.pdf p2 — "The Shapeoko 3 Carbide Motion board ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko XXL | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | https://my.carbide3d.com/pdf/shapeoko3_xxl_assembly.pdf p3 — "The Shapeoko XXL controller unit ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 4 | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | https://my.carbide3d.com/pdf/shapeoko4_xxl_assembly_guide_v1-1.pdf p2 — "The Shapeoko 4 controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko Pro | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | https://my.carbide3d.com/pdf/Shapeoko_Pro_assembly_guide_02-05-2021_v1_web.pdf p2 — "The Shapeoko Pro controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 5 Pro | New Carbide electronics, "new GRBL" (version not stated) | GRBL (vendor build) | Probably live via grbl-v1.1; version unverified | https://carbide3d.com/blog/introducing-shapeoko-5-pro/ — "new electronics, new motors, new GRBL, new everything." |
| Carbide 3D Nomad (3) | Carbide Motion board, Atmel 328 running GRBL | GRBL | Live CNC (grbl-v1.1) | https://shop.carbide3d.com/products/nomad-carbide-motion-board — "Atmel 328 running GRBL"; https://carbide3d.com/blog/grbl-1-dot-1-update/ — "our machines are based on the fantastic GRBL machine controller". Board page does not name the Nomad 3 model specifically. |
| Inventables X-Carve | X-Controller, grbl | GRBL | Live CNC (grbl-v1.1) | https://x-carve-instructions.inventables.com/upgrade/step4/ — "If you're using an X-Controller, you'll will already have the correct grbl firmware installed on your controller board." |
| Inventables X-Carve Pro | Grbl 1.1h fork on ATmega2560 | GRBL (vendor fork) | Probably live via grbl-v1.1; not qualified | https://github.com/inventables/grbl-xcp — "Grbl fork for the X-Carve Pro based on ATmega2560" |
| Onefinity Original / PRO series | BB (Buildbotics) controller: stand-alone web server, LinuxCNC-style G-code | Stand-alone (file upload) | No live path; GRBL-dialect export only | https://www.onefinitycnc.com/support — "PRO Series (Gen 1) w/ BB Controller (Discontinued)"; https://www.onefinitycnc.com/product-page/onefinity-controller — "Onefinity BB (Buildbotics) Controller"; https://buildbotics.com/manual-v1-0/ — "It is a stand-alone device that acts as a web server." |
| Onefinity Elite Gen 1 | MASSO G3 Touch (or Redline upgrade) | Stand-alone | No live path | https://www.onefinitycnc.com/post/gen-1-elite-series-vs-gen-2-elite-series-which-onefinity-cnc-is-right-for-you — "Masso G3 Touch (Gen 1): This is a proven, standalone industrial controller" |
| Onefinity Elite Gen 2 | Redline HMI + RealTime Motion Controller | Stand-alone / vendor HMI | No live path; dialect unverified | same page — "the Gen 2 utilizes the Redline HMI paired with the RealTime Motion Controller" |
| Avid CNC (current EX controls) | Centroid CNC12 | PC control | No live path | https://www.avidcnc.com/support/instructions/ — "Systems with EX Controllers (Centroid CNC12)" |
| Avid CNC (legacy Plug & Play) | Mach4 + Ethernet SmoothStepper | PC control | No live path | https://www.avidcnc.com/mach4-cnc-control-software-p-165.html — "We have provided a version of Mach4 with a custom user interface for extremely easy setup and operation of all Avid CNC machines."; support page "Systems with Legacy Controllers (Mach4)" |
| OpenBuilds BlackBox 4X | Grbl (ATmega328p) | GRBL | Live CNC (grbl-v1.1) | OpenBuilds CONTROL source @1adcc121, `app/wizards/flashingtool2/flashingtool.js:251-259` — BlackBox 4X flashes `grbl-3axes-nodoor.hex` via `socket.emit('flashGrbl', data)`. (docs.openbuilds.com unreachable from this sandbox.) |
| OpenBuilds BlackBox X32 | grblHAL | GRBL (grblHAL) | Live CNC (grblhal) | same file `:297-304` — BlackBox X32 flashes `grblhal-grbl3axis.bin` via `flashGrblHal`. |
| V1 Engineering MPCNC / LowRider on SKR Pro (older kits) | Marlin (V1 MarlinBuilder configs) | Marlin | Live driver is laser-only; CNC Start refused; CNC Frame blocked | https://docs.v1e.com/electronics/skrpro/ — "V1 Engineering pre-configured firmware" (links MarlinBuilder) / "You also have the option to get the full Marlin source and edit and compile yourself"; MarlinBuilder @75debb5 `src/configs/V1CNC_SkrPro_2209` enables `accessories/laser` (LASER_FEATURE) and `common/cnc-config` (ARC_SUPPORT, CNC_WORKSPACE_PLANES, CNC_COORDINATE_SYSTEMS, GCODE_MOTION_MODES) |
| V1 Engineering Jackpot board | FluidNC (ESP32) | GRBL (FluidNC) | Live CNC (fluidnc) | https://docs.v1e.com/electronics/jackpot/ — "The Jackpot CNC Control board runs FluidNC which is fully GRBL compatible with extended features" |
| Makera Carvera | Smoothieware branch (Carvera firmware) | Smoothieware | Live driver is laser-only; CNC refused; export GRBL dialect | https://github.com/MakeraInc/CarveraFirmware (README @83c6691) — "This is a branch of the Smoothieware firmware for the Makera Carvera CNC Machine."; https://wiki.makera.com/en/supported-codes — "G4 Dwell P<seconds>", "M6 Auto tool change", "M600 Pauses the machine and waits for a resume command to continue" |
| Two Trees TTC450 (Pro / Ultra) | GRBL (ESP32 board) | GRBL | Live CNC (grbl-v1.1); board build not qualified | https://twotrees3d.com/products/twotrees-ttc450-ultra-cnc-router-machine — "Firmware type: GRBL open source, supports both CNC and laser (no firmware flash required)" |
| FoxAlien Masuter (Pro) | GRBL | GRBL | Live CNC (grbl-v1.1) | https://www.foxalien.com/en-de/collections/cnc-router/products/cnc-router-machine-masuter — "The machine is compatible with Grbl software." (Masuter Pro page itself does not name the firmware) |
| Stepcraft | UCCNC (USB/Ethernet motion controller); WinPC-NC offered in EU | PC control | No live path | https://stepcraft.us/uccncinstall/ — "On this drive is the UCCNC machine control software installer." / "install the correct post-processors for Vectric that allow you to generate the correct G Code for the UCCNC and the STEPCRAFT CNC." (EU WinPC-NC page returned 403: unverified) |
| Chinese 6040 / 3040 (VEVOR example) | Mach3 (USB), plus an independent offline controller | PC control / stand-alone | No live path | https://www.vevor.com/wood-engraving-machine-c_11142/4-axis-cnc-router-6040-machine-4-rotating-axis-milling-1605-ball-screw-us-stock-p_010438919514 — "This cutting machine has an independent offline controller. … 5. Supported software: Mach 3." |
| DDCSV3.1 stand-alone controller (common on 6040s) | Digital Dream DDCS V3.1 | Stand-alone | No live path | https://motioninc.co.za/Content/Images/uploaded/cnc%20-%20plasma/machine%20interface/DS_DDCSV3.1.pdf p43 — G/M code list: G0-G3, G17-19, G28, G31, G54-59, G81-83, G90/91, G98/99, M3, M5, M8-M11 (no G4, G21, G94, M0, M7 listed) |
| Ooznest WorkBee (added: common in UK) | Duet 2, RepRapFirmware 3.3 | RepRapFirmware | No driver; export only | https://ooznest.co.uk/product/original-workbee-replacement-duet/ — "Replacement Duet 2 Controller for the WorkBee CNC Machine" |
| Snapmaker 2.0 (added: common hybrid) | Marlin-based Snapmaker2-Controller | Marlin | Marlin laser driver only | https://github.com/Snapmaker/Snapmaker2-Controller README — "It's based on the popular Marlin firmware with optimized FreeRTOS support." |
| Neotronics 4040 Max (owner's machine) | "offline controller", USB cable, "standard free software"; firmware NOT named | unverified | KerfDesk profile assumes grbl-v1.1 (PROJECT.md:391 "firmware builds unconfirmed") | https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct — "It also comes with an offline controller, Z-Probe, and limit switches, pre-assembled." / "New controller - We mixed the 4040pro controller and the board into a new controller." Firmware: **unverified** — ask the owner to send `$I` and the banner from KerfDesk's Console. |

## Part 3 — dialect notes gathered so far (for file-only controllers)

KerfDesk writes `G4 P3.000` meaning 3 seconds.
- Seconds: GRBL 1.1h (`motion_control.c:195 mc_dwell(float seconds)`), grblHAL (`motion_control.c:853`),
  FluidNC v4.0.3 (`GCode.cpp:1804` `p * 1000`), LinuxCNC ("The P number is the time in seconds"),
  Centroid CNC12 ("The P parameter is used to specify the time in seconds"), Mach4 v1.1 ("If a decimal
  point is used, then P or X specifies seconds"), Smoothieware only in grbl_mode, Carvera ("Dwell P<seconds>").
- Milliseconds: Marlin (`G4.cpp:33`), RepRapFirmware (`GCodes.cpp` 3.6-dev: "P value are in milliseconds"),
  MASSO ("The value is specified in milliseconds"), UCCNC default ("By default the time for dwell is
  measured in milliseconds"), Smoothieware non-CNC build.
- Configurable: Mach3 ("G04 Dwell param in Milliseconds, if checked then the command G4 5000 will give a Dwell in running of 5 seconds").
- Tool change M0: GRBL pauses (`gcode.c:250`); Smoothieware and the Carvera fork have M0 commented out
  (`Robot.cpp:694-696` / Carvera `Robot.cpp:800`); Marlin needs HAS_RESUME_CONTINUE (`gcode.cpp:484`,
  `Conditionals_adv.h:882`); DDCSV lists no M0.
- Comments: KerfDesk writes `;` comments. LinuxCNC documents `;`; the Mach3Mill 1.84 manual documents
  only `( )`, `%` lines and `//`; UCCNC's manual documents `( )` and uses `;` as a function-argument separator.
- Arcs: Mach3 has a configurable "IJ mode" (Inc or Absolute); KerfDesk emits incremental I/J without G91.1.

## Findings so far (brief format, to be finalised)

### CN-1 — Save G-code writes a GRBL-only CNC file for Marlin and Smoothieware profiles without saying so
- severity: medium · verdict: CONFIRMED · status: new
- failure scenario: CNC project, device profile Marlin (e.g. MPCNC) or Smoothieware (e.g. Carvera). Start
  is refused ("… cannot accept LaserForge CNC jobs"), so the operator uses Save G-code and runs the file from
  the board's SD card or another sender. The file's `M3 S12000` / `G4 P3.000` spin-up waits 3 ms on Marlin
  and the bit plunges while the router is still spinning up; on Marlin's default `CUTTER_POWER_UNIT PWM255`
  S12000 clamps to full output; on Smoothieware the tool-change `M0` does not pause, so the next section is cut
  with the wrong bit. No toast says the file is GRBL-dialect.
- kerfdesk evidence: `emit-gcode.ts:140-163`; `gcode-metadata.ts:128-132`; `machine-job-warnings.ts:42-62` (no
  controller check); `file-actions.ts:226-272` (the only pre-save advisory is the $-settings one).
- upstream evidence: Marlin 2.1.2.8 `gcode/motion/G4.cpp:33` "dwell_ms = parser.value_millis(); // milliseconds to wait";
  `parser.h:280` `value_millis() { return value_ulong(); }`; `feature/spindle_laser.h:223` power_delay() is never
  called; `Configuration_adv.h:3372` `#define CUTTER_POWER_UNIT PWM255`, `spindle_laser.h:162-172` constrain to 255.
  Smoothieware 38e2cc08 `Robot.cpp:503-511`, `Kernel.cpp:113-117`, `Robot.cpp:694-696`.
- reproduction: `src/__audit_repro__/CN/cnc-export-non-grbl-controller.test.ts` — 2 of 7 fail on current code
  (toasts received: the $-settings advisory, "Saved G-code to …", the starter-feed note; none names GRBL-family).
- fix: local — reuse `CNC_REQUIRES_GRBL_MESSAGE` as a non-blocking Save/tile/surfacing advisory when
  `machine.kind === 'cnc'` and `!selectControllerDriver(kind, commandSet).capabilities.cncJobs`.

### CN-2 — A Marlin/Smoothieware CNC operator is never told the real reason at Frame
- severity: low · verdict: CONFIRMED (trace) · status: new
- failure scenario: CNC project on a Marlin profile, connected. Frame (dialog-free) first asks to set Work Z
  zero (`use-frame-action.ts:353-388`, sends `G92 Z0`), compiles the job, then refuses with "CNC Frame is
  unavailable because this controller cannot build the required safe-Z retract." (`cnc-frame-lines.ts:27-28,57-59`).
  Start stays disabled (ADR-372), so the Job Review warning `CNC_REQUIRES_GRBL_MESSAGE` and the Start refusal
  are unreachable. The Laser|CNC toggle only checks capability labels; Connect says nothing.
- reproduction: `src/__audit_repro__/CN/cnc-frame-non-grbl-reason.test.ts` (2 correct-behaviour tests fail).
- fix: local — check `driver.capabilities.cncJobs` first in the CNC Frame plan and before the Zero-Z prompt; use
  the GRBL-family text. Same refusal, better order and words. No new gate.

### CN-3 — CNC project on a Ruida profile: Save blames "Fill/Image raster"
- severity: low · verdict: to confirm with repro · `rd-encoder.ts:68-71` treats every non-`cut` group as raster;
  `emit-rd.ts:57-58` message "uses Fill/Image raster output".

## Still to check
- Run the Frame repro; add the Ruida CNC repro.
- Catalog correctness pass (entries checked so far all match their sources; Neotronics correctly `unqualified`).
- Recommendations section (per-machine controller selection, named post-processors, Marlin CNC dialect).
