# Track CN — which controllers real CNC machines use, and what KerfDesk supports

Status: **final**, 2026-09-25. Continues `CN-partial.md` (left in place). Code checked on branch
`claude/focused-tesla-kb5if0` at b44410a (code identical to e2e323b, main 39d7f96 merged).
Upstream trees are the pinned revisions in `method.md` (revisions re-checked). No hardware was used.

Reproduction tests: `src/__audit_repro__/CN/` — 5 files, 22 tests. The 14 fact tests pass; the 8
"correct behaviour" tests fail on current code, as intended:

| file | fails / total | shows |
|---|---|---|
| `cnc-export-non-grbl-controller.test.ts` | 2 / 7 | CN-1 (single-file Save, Marlin and Smoothieware) |
| `cnc-other-exports-non-grbl.test.ts` (new) | 3 / 6 | CN-1 (tile Save, surfacing Save), CN-3 (tiled Save on Ruida) |
| `cnc-frame-non-grbl-reason.test.ts` | 2 / 6 | CN-2 |
| `cnc-ruida-save-reason.test.ts` | 1 / 2 | CN-3 |
| `cnc-output-dialect-ignored.test.ts` | 0 / 1 | CN-4 (fact test only) |

**Evidence limits.** In this session the egress proxy blocked every vendor website tried
(sainsmart.com, docs.sainsmart.com, resources.sienci.com, carbide3d.com, docs.v1e.com,
wiki.makera.com, docs.masso.com.au, marlinfw.org, linuxcnc.org, bobscnc.com and others). GitHub,
raw.githubusercontent.com and one S3-hosted vendor PDF were reachable. So:

- **T** = read in this session (GitHub source at a pinned commit, the pinned upstream trees, or the
  S3 PDF).
- **†** = quoted from the vendor page by the first CN session on 2026-09-25 (recorded in
  `CN-partial.md`); I could not re-fetch it from this session.

Search-engine summaries were **not** used as evidence. One of them attributed "Grbl v1.1f comes
preinstalled" to the PROVerXL 6050, but the PDF it came from covers the 3018/3018-PRO/1810-PRO board.

---

## Short answer to the owner

Hobby CNC routers ship with three kinds of controller.

1. **GRBL and its successors, grblHAL and FluidNC.** This covers most desktop routers: Genmitsu
   (SainSmart), Sienci LongMill and AltMill, Carbide 3D Shapeoko and Nomad, Inventables X-Carve and
   Carvey, OpenBuilds BlackBox, V1 Engineering's Jackpot board, FoxAlien and Two Trees. **KerfDesk
   runs these live:** Frame, Start, probing and tool-change pauses.
2. **3D-printer firmware.** Marlin (older V1 Engineering MPCNC and LowRider boards, Snapmaker),
   Smoothieware (Makera Carvera) and RepRapFirmware (Ooznest WorkBee on a Duet 2). KerfDesk can
   connect to Marlin and Smoothieware boards, **but only as lasers**. It refuses CNC jobs on them,
   and it cannot connect to RepRapFirmware at all.
3. **PC or stand-alone controllers.** Mach3 and Mach4 (typical Chinese 6040s, older Avid), Centroid
   (Avid), UCCNC (Stepcraft), MASSO and Redline (Onefinity Elite), Buildbotics (original Onefinity)
   and DDCSV panels. **KerfDesk cannot connect to any of these.**

For groups 2 and 3, the only route is **Save G-code**, and that file is **always written for GRBL**.
Two things in it mean something different on other controllers:

- **The spin-up wait (`G4 P3.000`).** GRBL waits 3 seconds. Marlin, MASSO, UCCNC and
  RepRapFirmware read it as 3 milliseconds.
- **The tool-change pause (`M0`).** Smoothieware and the Carvera ignore it, so the next section is
  cut with the wrong bit. On RepRapFirmware it ends the job.

KerfDesk knows the Marlin and Smoothieware cases, and says so at Start. But Start can never be
reached there, and Save, tile export and surfacing export say nothing. The fixes below only add
warnings and correct refusal messages; none adds a block.

---

## Part 1 — What KerfDesk supports for CNC today (code)

### Capability

| controller kind | driver | `cncJobs` | CNC Frame retract | what a CNC project gets |
|---|---|---|---|---|
| GRBL 1.1 (`grbl-v1.1`, also the default for profiles with no kind) | `core/controllers/grbl/driver.ts:57` `cncJobs: true` | yes | yes | Live CNC: Frame, Start, probing, M0 tool change |
| grblHAL | `grblhal/driver.ts:12-21` spreads `grblDriver` | yes | yes | Live CNC |
| FluidNC | `fluidnc/driver.ts:65-69` `...grblDriver.capabilities` | yes | yes | Live CNC |
| Falcon A1 Pro command set | `falcon-command-contract.ts:14-15` keeps `...driver.capabilities` | yes | yes (G1 form) | Laser machine; CNC flag inherited |
| Marlin | `marlin/driver.ts:49` `cncJobs: false` | no | none | Laser only; Frame refused; export = GRBL CNC file |
| Smoothieware | `smoothieware/driver.ts:46` `cncJobs: false` | no | none | Laser only; Frame refused; export = GRBL CNC file |
| Ruida (.rd export) | `ruida/driver.ts:31` `cncJobs: false` | no | n/a | Ordinary Save refused (CN-3); tiled Save writes GRBL `.nc` |

- The flag's comment is at `controller-capabilities.ts:67-71`: "CNC spindle jobs (ADR-098: CNC is
  GRBL-only) … Marlin reads P as milliseconds". ADR-098 (DECISIONS.md) does not itself say
  GRBL-only. The scope comes from ADR-094/095/096, the single `cncGrblStrategy` emitter and this
  flag. That is a comment nit, not a defect.
- **Device profiles.** Only `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE` carries `cnc-output`
  (`device-profile.ts:395-404`, controller `grbl-v1.1`, plus `cncSubProfile`). The generic GRBL,
  grblHAL and FluidNC profiles carry no output label, so both modes are allowed
  (`device-profile.ts:306-312`). The generic Marlin, Smoothieware and Ruida profiles are labelled
  laser-only (`profile-catalog.ts:106,132,154`).
- **One CNC dialect.**
  - CNC projects always emit through `emitCncJobWithPassSpans` (`io/gcode/emit-gcode.ts:140-151`:
    "CNC router projects always emit through the Z-aware GRBL strategy").
  - That emitter ignores the device (`core/output/cnc-grbl-strategy.ts:97-100`,
    `_device: DeviceProfile`).
  - Tiles use `cncGrblStrategy.emit` (`ui/app/tile-emission.ts:62`). Surfacing has its own
    GRBL-shaped generator (`core/cnc/surfacing.ts:103-139`).
  - The file header always reads `; assumes: GRBL $30=<rpm> … $32=0 (router mode)`
    (`io/gcode/gcode-metadata.ts:128-131`; `emit-gcode.ts:296-307` ignores `controllerKind` for
    CNC).
- **Emitted CNC vocabulary.**
  - `;` comments.
  - Modal preamble `G21 G90 G54 G94 G17` (`cnc-grbl-transitions.ts:41-52`).
  - G0 and G1; G2 and G3 with incremental I/J.
  - `M3 S<rpm>` then `G4 P<seconds to 3 decimals>` (`cnc-grbl-transitions.ts:124,128`).
  - `M5`; M7, M8 and M9 only when coolant is on.
  - Tool change = retract, `M5`, park, `M0` (`cnc-grbl-transitions.ts:81-111`). No T/M6, no canned
    cycles, no M30.
- **CNC machine catalog** (`core/cnc/cnc-machine-catalog.ts`).
  - 9 geometry and RPM presets (the partial said 10).
  - `controllerSupport` is display-only (`DeviceSetupCncPreset.tsx:93`).
  - Loading a preset never changes `controllerKind` (`DeviceSetupCncPreset.tsx:18-31`), and the UI
    says so (`:94-95`).
  - `applyCncMachinePreset` (`ui/state/machine-actions.ts:176`) is called only from tests.

### What each surface tells a CNC operator whose controller is not GRBL-family

| surface | behaviour (file:line) | tells the truth? |
|---|---|---|
| Machine Setup | Validation issue `device-setup-flow.ts:391-393` ("… cannot run KerfDesk CNC jobs. Choose a GRBL-family controller."). It disables Save of a CNC setup (`DeviceSetupShell.tsx:122,149`). The alert sits in the collapsed "Controller and connection settings" (`DeviceSetupIdentifyStep.tsx:40,52-57`). | **yes** |
| Controller select | Lists all six kinds by label only (`DeviceSetupIdentifyStep.tsx:97-101`). `machineSetupControllerGuide().cncSupported` is computed (`machine-setup-controller-guide.ts:126`) but never rendered. | partly |
| Laser/CNC toggle | Switches mode, and warns only when the profile's **capability label** excludes CNC (`MachineModeToggle.tsx:16-20`). Text: "Confirm the installed spindle, powered Z, and CNC settings in Machine Setup. The capability label is a warning, not a mode gate." (`machine-capability-messages.ts:5`). A custom or imported Marlin profile with no labels gets nothing. | **no** (CN-2) |
| Connect | No machine-kind or CNC check (no `cnc` reference in `ui/state/laser-connect-*.ts`). | **no** (CN-2) |
| Frame | Pressable (`JobActionControls.tsx:201-212`). It prompts to set Work Z zero and sends `G92 Z0` (`use-frame-action.ts:368-378`, `grbl/commands.ts:87`). It then refuses with "cannot build the required safe-Z retract" (`cnc-frame-lines.ts:27-28,57-59`). | **no** (CN-2) |
| Start / Job Review | `CNC_REQUIRES_GRBL_MESSAGE` (`start-job-readiness-policy.ts:20-28`) and the Start refusal (`laser-start-program-assertions.ts:74-82`, called `laser-job-actions.ts:220`). Both are unreachable: Start stays grey until a clean Frame (`JobActionControls.tsx:106-112`, ADR-372), and that Frame cannot succeed. | unreachable |
| Save G-code | Writes the GRBL CNC file. The only controller text is the `$`-settings advisory, shown when connected to a no-`$$` firmware (`controller-readiness.ts:64`). The "assumes GRBL" info toast is laser-only (`file-actions.ts:314`). | **no** (CN-1) |
| Tile export | Same advisories (`save-tiled-gcode.ts:87-95`), GRBL tiles. It runs **before** the file-only route (`file-actions.ts:190-207` vs `:228-233`). | **no** (CN-1, CN-3) |
| Surfacing export | Only the no-go-zone and `$`-settings advisories (`save-surfacing-program.ts:54-61`), GRBL program (`surfacing.ts:125-127`). | **no** (CN-1) |
| Ruida Save (CNC project) | Refused with "Layer L1 uses Fill/Image raster output…" (`rd-encoder.ts:69-70`, `emit-rd.ts:57-58`). | **wrong reason** (CN-3) |
| Output dialect select | Shown for CNC setups with laser dialects only (`DeviceSetupIdentifyStep.tsx:82,107-127`). It has no effect on CNC bytes. | misleading (CN-4) |
| CNC preset | `controllerNote` and `role="alert"` for unqualified presets (`DeviceSetupCncPreset.tsx:93-95`). | yes |

---

## Part 2 — Machine table (verified rows only)

"Live CNC (kind)" means KerfDesk's driver of that kind speaks the protocol. **No machine in this
table is hardware-qualified.** Vendor GRBL forks are protocol-compatible by their own description,
not tested.

| Machine | Controller / firmware | Family | KerfDesk today | Source and exact quote |
|---|---|---|---|---|
| Genmitsu 3018-PRO (and 3018, 1810-PRO) | SainSmart board, Grbl v1.1f on ATmega328P | GRBL | Live CNC (grbl-v1.1) | **T** SainSmart "Genmitsu Controller Board (GRBL)" manual V1.0, https://s3.amazonaws.com/s3.image.smart/download/101-60-284/Controller_Board_User_Manual-English-V1.0-20200612.pdf — p.1 "This controller board is designed for the Genmitsu 1810-PRO, 3018 and 3018-PRO CNC milling/engraving machines."; p.15 "Grbl v1.1f comes preinstalled on the control module."; p.11 "a bootloader is already preinstalled on the ATMEGA328P at the factory". **†** https://www.sainsmart.com/products/sainsmart-genmitsu-cnc-router-3018-pro-diy-kit — "It's built on Arduino and Grbl (both open source)" |
| Genmitsu 3020-PRO MAX V2 | GRBL V1.1 | GRBL | Live CNC (grbl-v1.1) | **†** https://www.sainsmart.com/products/3020-pro-max-v2 — "While remaining based on open-source Grbl V1.1, the 3020-PRO MAX V2 CNC router has been upgraded with high-powered Toshiba TB6S109 drivers featuring 32-bit chips" |
| Genmitsu 4040-PRO / 4040-PRO MAX | GRBL, 32-bit MCU | GRBL | Live CNC (grbl-v1.1) | **†** https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting — "Control: GRBL", "MCU: 32bits"; https://www.sainsmart.com/products/4040-pro-max — "a comprehensive control system with GRBL firmware-compatible software (such as Candle, LaserGRBL, and LightBurn)" |
| Genmitsu PROVerXL 4030 V2 | GRBL 1.1h | GRBL | Live CNC (grbl-v1.1) | **†** https://www.sainsmart.com/products/proverxl-4030-v2 — "Control Board Compatibility: GRBL 1.1h" |
| Sienci LongMill MK1 | GRBL | GRBL | Live CNC (grbl-v1.1) | **T** Sienci's gSender @14c7084c `src/app/src/features/Config/assets/MachineDefaults/defaultMachineProfiles.ts:186` `eepromSettings: longMillGrblEEPROM.LONGMILL_MK1_30x30,` (the GRBL `$` set in `MachineDefaults/grbl/longmill.js:56`). Inferred from vendor code, not a spec sheet. |
| Sienci LongMill MK2, LongBoard | grbl v1.1h on Arduino Uno | GRBL | Live CNC (grbl-v1.1) | **†** https://resources.sienci.com/view/lmk2-mk2-specs/?print=print — "The LongBoard uses an Arduino Uno running grbl v1.1h powering four 4A TB6600 motor drivers." **T** gSender `defaultMachineProfiles.ts:130` `eepromSettings: longMillGrblEEPROM.LONGMILL_MK2_30x30,` |
| Sienci LongMill MK2, SuperLongBoard | grblHAL on STM32F412 | grblHAL | Live CNC (grblhal) | **†** same page — "SuperLongBoard 5xHAL uses an STM32F412 chip running grblHAL powering four TMC2660C motor drivers." **T** grblHAL/STM32F4xx @f331441a `driver.json:558-562` — `"name": "SuperLongBoard (SLB)"`, `"MAP": "boards/longboard32_map.h"` |
| Sienci LongMill MK3 | grblHAL | grblHAL | Live CNC (grblhal) | **T** gSender `defaultMachineProfiles.ts:86` `eepromSettings: longMillGrblHALEEPROM.LONGMILL_MK3_30x30,` (MK3 has no GRBL defaults). Inferred from vendor code. |
| Sienci AltMill | SLB-EXT, grblHAL | grblHAL | Live CNC (grblhal) | **†** https://resources.sienci.com/view/am-about-your-altmill/ — "32-bit SLB-Ext controller running grblHAL firmware, with signal outputs to integrated driver stepper motors." **T** grblHAL/STM32F4xx `driver.json:597-601` — `"name": "SuperLongBoard External (SLB EXT)"` |
| Carbide 3D Shapeoko 3 | Carbide Motion board, GRBL 1.1 | GRBL (vendor build) | Live CNC (grbl-v1.1); not qualified | **†** https://my.carbide3d.com/pdf/shapeoko3_assembly.pdf p2 — "The Shapeoko 3 Carbide Motion board ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko XXL | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | **†** https://my.carbide3d.com/pdf/shapeoko3_xxl_assembly.pdf p3 — "The Shapeoko XXL controller unit ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 4 | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | **†** https://my.carbide3d.com/pdf/shapeoko4_xxl_assembly_guide_v1-1.pdf p2 — "The Shapeoko 4 controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko Pro | GRBL 1.1 | GRBL | Live CNC (grbl-v1.1) | **†** https://my.carbide3d.com/pdf/Shapeoko_Pro_assembly_guide_02-05-2021_v1_web.pdf p2 — "The Shapeoko Pro controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 5 Pro | new Carbide electronics, "new GRBL" (version not stated) | GRBL (vendor build) | Probably live (grbl-v1.1); version unverified | **†** https://carbide3d.com/blog/introducing-shapeoko-5-pro/ — "new electronics, new motors, new GRBL, new everything." |
| Carbide 3D Nomad | Carbide Motion board, Atmel 328 running GRBL | GRBL | Live CNC (grbl-v1.1) | **†** https://shop.carbide3d.com/products/nomad-carbide-motion-board — "Atmel 328 running GRBL". The page does not name the Nomad 3 specifically. |
| Inventables X-Carve (X-Controller) | grbl | GRBL | Live CNC (grbl-v1.1) | **†** https://x-carve-instructions.inventables.com/upgrade/step4/ — "If you're using an X-Controller, you'll will already have the correct grbl firmware installed on your controller board." **T** gnea/grbl wiki @b81e2de `Using-Grbl.md:146` — "Easel is a web based project developed by Inventables specifically for use with X-Carve, Carvey + Grbl." |
| Inventables X-Carve Pro | Grbl 1.1h fork, ATmega2560 | GRBL (vendor fork) | Probably live (grbl-v1.1); not qualified | **T** inventables/grbl-xcp @acbb1d28 `README.md:3` — "Grbl 1.1h fork for the X-Carve Pro machine."; repository description "Grbl fork for the X-Carve Pro based on ATmega2560" |
| Inventables Carvey | Grbl 1.1e fork, Arduino Mega 2560 | GRBL (vendor fork) | Probably live (grbl-v1.1); not qualified | **T** inventables/gCarvin @9954a26d `README.md:2` — "Grbl 1.1e fork for the Carvey machine"; README — 'Make sure to have the "Board" type set as "Arduino Mega 2560".' |
| OpenBuilds BlackBox 4X | Grbl (ATmega328p) | GRBL | Live CNC (grbl-v1.1) | **T** OpenBuilds-CONTROL @1adcc121 `app/wizards/flashingtool2/flashingtool.js:251-254` — `if (selectedControllerType == "blackbox4x") {` … `var filename = "grbl-3axes-nodoor.hex";`, flashed with `socket.emit('flashGrbl', data)` (`:280`) |
| OpenBuilds BlackBox X32 | grblHAL | grblHAL | Live CNC (grblhal) | **T** same file `:297-300` — `} else if (selectedControllerType == "blackboxx32") {` … `var filename = "grblhal-grbl3axis.bin";`, `socket.emit('flashGrblHal', data)` (`:329`) |
| V1 Engineering Jackpot (V1, 2, 3) | FluidNC (ESP32) | FluidNC | Live CNC (fluidnc) | **T** V1EngineeringInc/FluidNC_Configs @fadbfe2e `README.md:2` — "Configuration and support files for the FluidNC boards typically used with the V1 Engineering CNC machines." (lists Jackpot3, Jackpot2, Jackpot V1). **†** https://docs.v1e.com/electronics/jackpot/ — "The Jackpot CNC Control board runs FluidNC which is fully GRBL compatible with extended features" |
| V1 Engineering MPCNC / LowRider on SKR Pro (older kits) | Marlin, V1E MarlinBuilder config | Marlin | Laser-only driver; CNC Frame and Start refused; export = GRBL file | **T** V1EngineeringInc/MarlinBuilder @75debb5 `src/configs/V1CNC_SkrPro_2209:9-15` applies `common/cnc-config`, `accessories/TFT35_e3_v3_CNC` and `accessories/laser`. `accessories/laser:9-12` enables `LASER_FEATURE`; `TFT35_e3_v3_CNC:9,12` enables `EMERGENCY_PARSER` and `REPRAP_DISCOUNT_FULL_GRAPHIC_SMART_CONTROLLER`. **†** https://docs.v1e.com/electronics/skrpro/ — "V1 Engineering pre-configured firmware" |
| Makera Carvera | Smoothieware branch | Smoothieware | Laser-only driver; CNC refused; export = GRBL file | **T** MakeraInc/CarveraFirmware @83c66915 `README.md:2` — "This is a branch of the Smoothieware firmware for the Makera Carvera CNC Machine." **†** https://wiki.makera.com/en/supported-codes — "G4 Dwell P<seconds>", "M6 Auto tool change", "M600 Pauses the machine and waits for a resume command to continue" |
| Snapmaker 2.0 | Marlin-based Snapmaker2-Controller | Marlin (vendor fork) | Not a KerfDesk CNC target (Marlin `cncJobs: false`) | **T** Snapmaker/Snapmaker2-Controller @314c167b `README.md:3` — "Snapmaker2-Controller is the firmware for Snapmaker 2.0 3-in-1 3D Printers. It's based on the popular Marlin firmware with optimized FreeRTOS support." |
| Ooznest WorkBee | Duet 2, RepRapFirmware (version not verified) | RepRapFirmware | No driver; export only | **†** https://ooznest.co.uk/product/original-workbee-replacement-duet/ — "Replacement Duet 2 Controller for the WorkBee CNC Machine". **T** Duet3D/RepRapFirmware @5862b26 `src/Config/Pins_DuetNG.h:8` — "// Pins definition file for Duet 2 WiFi/Ethernet". The partial's "RRF 3.3" is dropped as unsourced. |
| Onefinity Original / PRO series (BB controller) | Buildbotics-derived stand-alone web controller, LinuxCNC-style G-code | Stand-alone | No live path; export only | **†** https://www.onefinitycnc.com/product-page/onefinity-controller — "Onefinity BB (Buildbotics) Controller"; https://buildbotics.com/manual-v1-0/ — "It is a stand-alone device that acts as a web server." **T** OneFinityCNC/onefinity-firmware @44b85bad `setup.py:12` — `description = 'Buildbotics Machine Controller'`; buildbotics/bbctrl-firmware @41e98e31 `src/pug/templates/docs-gcode.pug:29` — "// Modified from https://linuxcnc.org/docs/html/gcode.html" |
| Onefinity Elite Gen 1 | MASSO G3 Touch (or Redline upgrade) | Stand-alone | No live path | **†** https://www.onefinitycnc.com/post/gen-1-elite-series-vs-gen-2-elite-series-which-onefinity-cnc-is-right-for-you — "Masso G3 Touch (Gen 1): This is a proven, standalone industrial controller" |
| Onefinity Elite Gen 2 | Redline HMI + RealTime Motion Controller | Stand-alone | No live path; dialect unverified | **†** same page — "the Gen 2 utilizes the Redline HMI paired with the RealTime Motion Controller" |
| Avid CNC (current EX controls) | Centroid CNC12 | PC control | No live path | **†** https://www.avidcnc.com/support/instructions/ — "Systems with EX Controllers (Centroid CNC12)" |
| Avid CNC (legacy Plug & Play) | Mach4 + Ethernet SmoothStepper | PC control | No live path | **†** https://www.avidcnc.com/mach4-cnc-control-software-p-165.html — "We have provided a version of Mach4 with a custom user interface for extremely easy setup and operation of all Avid CNC machines." |
| Stepcraft | UCCNC | PC control | No live path | **†** https://stepcraft.us/uccncinstall/ — "On this drive is the UCCNC machine control software installer." (the EU WinPC-NC option is unverified) |
| Chinese 6040 / 3040 (VEVOR example) | Mach3 over USB, plus an offline controller | PC / stand-alone | No live path | **†** https://www.vevor.com/wood-engraving-machine-c_11142/4-axis-cnc-router-6040-machine-4-rotating-axis-milling-1605-ball-screw-us-stock-p_010438919514 — "This cutting machine has an independent offline controller. … 5. Supported software: Mach 3." |
| DDCSV3.1 stand-alone (common on 6040s) | Digital Dream DDCS V3.1 | Stand-alone | No live path | **†** https://motioninc.co.za/Content/Images/uploaded/cnc%20-%20plasma/machine%20interface/DS_DDCSV3.1.pdf p43 — G/M list: G0-G3, G17-19, G28, G31, G54-59, G81-83, G90/91, G98/99, M3, M5, M8-M11 (no G4, G21, G94, M0 or M7 listed) |
| Two Trees TTC450 (Pro / Ultra) | GRBL | GRBL | Live CNC (grbl-v1.1); board build not qualified | **†** https://twotrees3d.com/products/twotrees-ttc450-ultra-cnc-router-machine — "Firmware type: GRBL open source, supports both CNC and laser (no firmware flash required)". The partial's "ESP32 board" is not in the quote and is dropped. |
| FoxAlien Masuter | GRBL | GRBL | Live CNC (grbl-v1.1) | **†** https://www.foxalien.com/en-de/collections/cnc-router/products/cnc-router-machine-masuter — "The machine is compatible with Grbl software." (the Masuter Pro page does not name its firmware) |
| **Neotronics 4040 Max (owner's machine)** | "offline controller"; firmware **not named** | **unverified** | KerfDesk profile assumes grbl-v1.1 (`PROJECT.md:401-402` "firmware builds unconfirmed") | **†** https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct — "It also comes with an offline controller, Z-Probe, and limit switches, pre-assembled." / "New controller - We mixed the 4040pro controller and the board into a new controller." SainSmart lists the 4040-PRO's control as GRBL, so GRBL is plausible, not verified. |

---

## Part 3 — Dialect notes (what the GRBL CNC file means elsewhere)

KerfDesk writes `M3 S12000` then `G4 P3.000` (3 s spin-up), `M0` for a tool change, `;` comments,
incremental I/J arcs.

| controller | `G4 P3.000` | tool-change `M0` | other | source |
|---|---|---|---|---|
| GRBL 1.1h | 3 s | pauses | `;` comments; I/J incremental only, `G91.1` is a no-op | **T** `grbl/motion_control.c:195` `void mc_dwell(float seconds)`, `gcode.c:969`; `gcode.c:250` "case 0: … PROGRAM_FLOW_PAUSED; break; // Program pause"; `protocol.c:131-132`; `gcode.c:192,514` |
| grblHAL | 3 s | pauses | `G91.1` accepted, `G90.1` rejected | **T** `motion_control.c:853` `mc_dwell (float seconds)`, `gcode.c:4449`; `gcode.c:1815`; `protocol.c:114`; `gcode.c:1626-1630` |
| FluidNC v4.0.3 | 3 s | pauses | `G91.1` accepted | **T** `GCode.cpp:1804` `mc_dwell(int32_t(gc_block.values.p * 1000.0f))`; `:630`; `:184-185`; `:505-515` |
| Marlin 2.1.2.8 | **3 ms** | pauses only with `HAS_RESUME_CONTINUE` (LCD, `EMERGENCY_PARSER`, …); V1E's TFT35 CNC build has it | Seconds form is `G4 S`. `G91.1` would be read as `G91` (relative mode). Default `CUTTER_POWER_UNIT PWM255` clamps S12000 to full output. | **T** `gcode/motion/G4.cpp:33` "dwell_ms = parser.value_millis(); // milliseconds to wait", `parser.h:277,280`, `G4.cpp:34`; `gcode.cpp:484-487`, `inc/Conditionals_adv.h:882-883`; `gcode.cpp:466` `case 91: set_relative_mode(true);`; `Configuration_adv.h:3372`, `feature/spindle_laser.h:164-171` |
| Smoothieware edge | 3 s only in `grbl_mode` (the CNC-build default); otherwise **3 ms** | **ignored** (M0 commented out; no other handler) | The 3D build excludes `tools/spindle`, so M3 does nothing. `G91.1` would be read as `G91`. | **T** `Robot.cpp:500-511` "in reprap P is milliseconds"; `libs/Kernel.cpp:113-117`; `src/makefile:73-79`; `Robot.cpp:694-696`; `GcodeDispatch.cpp` has no M0 case; `Robot.cpp:622` |
| Makera Carvera | seconds (vendor wiki; same `grbl_mode` switch in code) | **ignored**; its pause is `M600`, its tool change `M6` | — | **T** CarveraFirmware @83c66915 `src/modules/robot/Robot.cpp:539-550`, `:800-802`; `src/modules/utils/player/Player.cpp:257`. **†** wiki |
| RepRapFirmware 3.7-dev | **3 ms** (integer part read) | **ends the job** when read from a file | — | **T** Duet3D/RepRapFirmware @5862b26 `src/GCodes/GCodes.cpp:3908-3909` "P value are in milliseconds"; `src/GCodes/GCodeBuffer/StringParser.cpp:2039-2052`; `src/GCodes/GCodes2.cpp:760-777` "Stopping a job because of a command in the file" → `StopPrint(…normalCompletion)` |
| LinuxCNC (the reference Buildbotics documents) | 3 s | pauses | `( )` and `;` comments | **T** LinuxCNC @f218ffbf `docs/src/gcode/g-code.adoc:520` "The P number is the time in seconds that all axes will remain unmoving."; `m-code.adoc:43` "'M0' - pause a running program temporarily."; `overview.adoc:160` "Comments can be embedded in a line using parentheses () or for the remainder of a line using a semi-colon." |
| Buildbotics / Onefinity BB | PLAUSIBLE 3 s (docs link G4 to LinuxCNC) | PLAUSIBLE pause (docs link M0/M1 to LinuxCNC) | — | **T** bbctrl-firmware @41e98e31 `docs-gcode.pug:29,62-64,237` (links only; planner not read) |
| Centroid CNC12 | seconds | not checked | — | **†** "The P parameter is used to specify the time in seconds" |
| Mach4 v1.1 | seconds if a decimal point is used | not checked | — | **†** "If a decimal point is used, then P or X specifies seconds" |
| Mach3 | configurable | not checked | The 1.84 manual documents only `( )`, `%` and `//` comments; "IJ mode" is configurable (Inc or Absolute) | **†** "G04 Dwell param in Milliseconds, if checked then the command G4 5000 will give a Dwell in running of 5 seconds" |
| MASSO | **milliseconds** | not checked | — | **†** "The value is specified in milliseconds" (docs.masso.com.au G04 page; the catalog also cites it) |
| UCCNC | **milliseconds** by default | not checked | Manual documents `( )` comments and uses `;` as an argument separator | **†** "By default the time for dwell is measured in milliseconds" |
| DDCSV3.1 | G4 not listed | M0 not listed | G21, G94 and M7 not listed either | **†** PDF p43 |

---

## Findings

### CN-1 — CNC exports write a GRBL-only file for Marlin, Smoothieware (and Ruida-tiled) profiles without saying so
- **severity:** medium · **verdict:** CONFIRMED · **status:** new
- **failure scenario:**
  - Setup: a CNC project on a Marlin profile (e.g. a V1E MPCNC) or a Smoothieware profile (e.g. a
    Carvera owner). Machine Setup will not save that combination, but the Laser/CNC toggle, an old
    project or a custom profile reach it.
  - The Frame is refused and Start stays grey (CN-2), so the operator uses Save G-code, tile export
    or surfacing export, and runs the file from the board's SD card or the vendor's sender.
  - Marlin reads the spin-up `G4 P3.000` as 3 ms. Where M3 switches the router (enable-pin relay),
    the bit plunges before the router is at speed.
  - Smoothieware (every build) and the Carvera ignore the tool-change `M0`, so the next section is
    cut with the previous bit. Marlin also skips it on builds without `HAS_RESUME_CONTINUE`.
  - No message says the file is GRBL-dialect. The toasts are the `$`-settings advisory (only when
    connected to a no-`$$` board), "Saved …" and the starter-feed note.
  - On the file-only Ruida profile, tiled Save writes GRBL `.nc` tiles the controller cannot run,
    also without a word (see CN-3).
- **kerfdesk evidence:**
  - `src/io/gcode/emit-gcode.ts:140` "CNC router projects always emit through the Z-aware GRBL
    strategy"; `src/core/output/cnc-grbl-strategy.ts:99` `_device: DeviceProfile,` (the device is
    ignored); `cnc-grbl-transitions.ts:92` `lines.push('M0');`, `:124` `` `M3 S${…}` ``, `:128`
    `` `G4 P${fmt(spinupSec)}` ``.
  - `src/ui/app/file-actions.ts:184-235`. `handleSaveGcode` has no `cncJobs` check (none anywhere
    under `src/ui/app`). The only pre-save controller text is `controllerReadinessAdvisories`
    (`:247-253`, which leads to `core/preflight/controller-readiness.ts:64` "This controller does
    not report GRBL $-settings, so the spindle S scale … is NOT verified").
  - `:314` `if (ctx.controllerSettings === null && machineKindOf(ctx.project.machine) !== 'cnc')`:
    the "assumes GRBL" note is laser-only.
  - `src/ui/laser/machine-job-warnings.ts:42-62`: the CNC advisories have no controller check.
  - `src/ui/app/save-tiled-gcode.ts:87-95` and `src/ui/app/tile-emission.ts:62`
    `cncGrblStrategy.emit(job, project.device)`.
  - `src/ui/machine/save-surfacing-program.ts:54-61`: no controller check;
    `src/core/cnc/surfacing.ts:125-127` emits `M3 S…` / `G4 P…`.
  - The only statement of the fact is a comment inside the file (`gcode-metadata.ts:130`), plus the
    unreachable Start warning `start-job-readiness-policy.ts:20-28`.
- **upstream evidence:**
  - Marlin 2.1.2.8:
    - `Marlin/src/gcode/motion/G4.cpp:33` `if (parser.seenval('P')) dwell_ms = parser.value_millis(); // milliseconds to wait`,
      with `parser.h:277,280` (`strtoul(value_ptr, nullptr, 10)`) — https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G4.cpp#L33
    - `gcode.cpp:484-487` (`#if HAS_RESUME_CONTINUE case 0: … M0_M1();`) and
      `inc/Conditionals_adv.h:882-883` —
      https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L484-L487
    - `feature/spindle_laser.h:223` `power_delay()` has no caller in the tree (grep).
  - Smoothieware 38e2cc08:
    - `src/modules/robot/Robot.cpp:500-511`, `src/libs/Kernel.cpp:113-117`,
      `src/modules/robot/Robot.cpp:694-696` (M0 commented out) —
      https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L694-L696
  - CarveraFirmware @83c66915: `Robot.cpp:800-802` —
    https://github.com/MakeraInc/CarveraFirmware/blob/83c669154df7b02718a0eecb9032de84eca5c7ad/src/modules/robot/Robot.cpp#L800-L802
  - V1E MarlinBuilder @75debb5: `accessories/TFT35_e3_v3_CNC:9,12` gives the V1E TFT35 CNC build
    `HAS_RESUME_CONTINUE`, so M0 **does** pause there; the dwell defect remains.
- **refutation tried:**
  - No guard in `handleSaveGcode`, the tile path or the surfacing path.
  - The CNC mode stays reachable: the toggle only warns (`MachineModeToggle.tsx:16-20`).
  - Upstream makes it harmless only partly: the Smoothieware CNC build reads P in seconds, and V1E
    TFT35 builds pause on M0. The claim is narrowed accordingly.
- **reproduction:**
  - `src/__audit_repro__/CN/cnc-export-non-grbl-controller.test.ts`: 2/7 fail.
  - `src/__audit_repro__/CN/cnc-other-exports-non-grbl.test.ts`: tile Save on Marlin, surfacing
    Save on Marlin and tiled Save on Ruida fail. The received toasts contain no GRBL-family
    statement.
- **fix (local):**
  - One helper, e.g. `cncExportControllerAdvisory(project)`. When `project.machine.kind === 'cnc'`
    and `!selectControllerDriver(device.controllerKind, device.controllerCommandSet).capabilities.cncJobs`,
    it returns a non-blocking warning.
  - Push it in `saveOrdinaryGcode` beside the readiness advisories (before the picker), in
    `saveConfiguredTiledGcode` and in `saveSurfacingProgram`.
  - Word it per controller rather than reusing the Start text verbatim, because "reads the G4
    spin-up dwell in milliseconds" is not true of a Smoothieware CNC build. For example:
    - Marlin: "`G4 P` is read in milliseconds".
    - Smoothieware: "`M0` tool-change pauses are ignored; `G4 P` is milliseconds unless grbl_mode is on".
  - Bytes and saves unchanged.

### CN-2 — A Marlin or Smoothieware CNC operator is never told the real reason CNC cannot run
- **severity:** low · **verdict:** CONFIRMED (repro of the plan order + trace of the UI flow) ·
  **status:** new
- **failure scenario:**
  - Setup: a CNC project on a connected Marlin or Smoothieware profile.
  - The Laser/CNC toggle says only that the profile "declares Laser only" and to confirm the spindle
    in Machine Setup; an unlabelled profile gets nothing. Connect says nothing.
  - Frame then selects G54, asks to set Work Z zero and sends `G92 Z0`, compiles the job, and
    refuses with "CNC Frame is unavailable because this controller cannot build the required safe-Z
    retract."
  - Start stays grey (ADR-372), so `CNC_REQUIRES_GRBL_MESSAGE` and the Start refusal are never
    shown.
  - The operator is sent to zero Z for a Frame that can never be built, and is never told that
    KerfDesk CNC needs a GRBL-family controller.
- **kerfdesk evidence:**
  - `src/ui/laser/use-frame-action.ts:192-212`: order is G54 normalization, absolute offset, then
    `prepareFrameLaser`. `:368-378` is the Zero-Z confirm and `await laser.zeroZHere();`, which sends
    `G92 Z0` (`core/controllers/grbl/commands.ts:87`).
  - `src/ui/state/cnc-frame-lines.ts:51-59` checks Work Z evidence and position **before**
    `if (input.buildRetract === undefined) return { kind: 'blocked', message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE };`.
    It is reached through `laser-frame-motion-plan.ts:43-60` and thrown at
    `laser-jog-actions.ts:187-190`.
  - `JobActionControls.tsx:106-112`: Start is disabled until a clean Frame.
  - `machine-capability-messages.ts:5`: the toggle text. `MachineModeToggle.tsx:18` checks the label
    only.
- **upstream evidence:** the refusal itself is right. Marlin 2.1.2.8 `G4.cpp:33` (dwell in ms) and
  Smoothieware `Robot.cpp:694-696` (no M0) are why a GRBL CNC program is unsafe there (URLs as in
  CN-1).
- **refutation tried:**
  - `offerFrameBlockerFixes` → `findMachineStartIssues` (`start-job-input.ts:62-85`) has no CNC or
    controller check.
  - The Frame button has no capability check (`JobActionControls.tsx:201-212`).
  - No other Start path exists for CNC.
- **reproduction:** `src/__audit_repro__/CN/cnc-frame-non-grbl-reason.test.ts`: the two
  correct-behaviour tests fail (Zero-Z message first; retract message instead of the GRBL-family
  reason). A fact test pins that an unlabelled Marlin profile gets no toggle warning.
- **fix (local):** the same refusal with a different order and words, not a new gate.
  - In `prepareFrameLaser` and `buildCncFrameMotion`, check `driver.capabilities.cncJobs` first and
    refuse with the GRBL-family text. This also stops the needless `G92 Z0`.
  - In `MachineModeToggle`, when the active profile's driver has `cncJobs: false`, show that text
    instead of the label warning (still a warning, not a gate).

### CN-3 — CNC project on the Ruida profile: Save blames "Fill/Image raster"; tiled Save bypasses the .rd route
- **severity:** low · **verdict:** CONFIRMED · **status:** new
- **failure scenario:** a CNC project on the generic Ruida profile (reachable through the toggle).
  - Save G-code shows "Cannot save .rd file: • Layer L1 uses Fill/Image raster output, which the
    experimental .rd encoder does not support yet. Use Line mode layers for Ruida export." A CNC
    layer has no Line mode; the real reason is that a router job cannot be a Ruida laser file.
  - With tiling on, the same Save never reaches the .rd route. It writes GRBL `.nc` tiles for a
    controller that runs `.rd` files, with no statement.
- **kerfdesk evidence:**
  - `src/core/controllers/ruida/rd-encoder.ts:69-70`: `if (group.kind !== 'cut') { return { ok: false, error: { kind: 'raster-unsupported', … } }; }`
    catches `kind: 'cnc'` groups (`core/job/job.ts:239`).
  - `src/io/rd/emit-rd.ts:57-58`: the raster message.
  - `src/ui/app/file-actions.ts:190-207` (tiled path) runs before the `transport === 'file-only'`
    route at `:228-233`.
- **upstream evidence:** the refusal is factual. meerk40t @7e82652 `meerk40t/ruida/README.md:6-8`
  "tested … using a Ruida RDC6442S controller and a monport MP-570 CO2 laser"; no spindle, router
  or RPM concept in `meerk40t/ruida/*.py` (grep). The .rd layer model is laser power and speed.
- **reproduction:**
  - `src/__audit_repro__/CN/cnc-ruida-save-reason.test.ts`: the correct-behaviour test fails.
  - `cnc-other-exports-non-grbl.test.ts`: fact tests show the untiled refusal and the tiled `.nc`
    write; the advisory test fails.
- **fix:**
  - **Local:** add a `cnc-unsupported` `RdEncodeError` (or map `group.kind === 'cnc'`) with "A CNC
    router job cannot be exported as a Ruida .rd laser file. Switch the project to Laser mode or
    choose a GRBL-family profile." The CN-1 advisory covers the tiled path.
  - **Needs decision:** whether tiled Save on a file-only profile should refuse like the untiled
    Save (rule 7 allows it: no .rd can be produced) or keep writing GRBL tiles with the advisory.

### CN-4 — Machine Setup's "Output dialect" choice looks like it sets CNC output; it only affects laser output
- **severity:** low · **verdict:** CONFIRMED (fact test + UI trace) · **status:** new
- **failure scenario:**
  - In a CNC or hybrid Machine Setup (e.g. the owner's Neotronics 4040 profile), "Controller and
    connection settings" shows **Output dialect**, titled "Choose the output syntax expected by the
    selected controller firmware."
  - It lists laser dialects only: GRBL Dynamic, Compatible, Raster, Neotronics 4040 Safe; for Marlin
    it lists Marlin Inline and Fan-mosfet.
  - A CNC user can reasonably believe "GRBL Compatible" or "Neotronics 4040 Safe" shapes the router
    program. It does not: CNC output is byte-identical for every choice.
- **kerfdesk evidence:**
  - `src/ui/laser/device-setup/DeviceSetupIdentifyStep.tsx:82`
    `const dialects = props.controllerKind === 'marlin' ? MARLIN_GCODE_DIALECTS : GRBL_GCODE_DIALECTS;`
    is rendered for every serial controller regardless of machine kind (`:107-127`, title at
    `:112`).
  - `core/devices/gcode-dialects.ts:87,111,129,144` descriptions are laser terms ("dynamic-power
    cuts, fill and raster sweeps").
  - `core/output/cnc-grbl-strategy.ts:99` ignores the device.
- **upstream evidence:** none needed (KerfDesk wording). All three GRBL-family firmwares accept the
  one CNC dialect (Part 3).
- **reproduction:** `src/__audit_repro__/CN/cnc-output-dialect-ignored.test.ts` passes. It pins
  that all four GRBL dialect choices give byte-identical CNC output. The defect is the label, so no
  failing test.
- **fix (local):** label it "Laser output dialect" when the setup includes CNC, or add one hint line:
  "CNC programs always use KerfDesk's GRBL CNC dialect."

---

## Recommendations

1. **Say it at every CNC export (CN-1).** This is the smallest change with the most effect, and it
   is warn-only.
   - Also add one neutral line to the Save dialog for **every** CNC export, whatever the profile:
     "CNC files are written for GRBL, grblHAL and FluidNC: `G4 P` in seconds, `M0` tool-change
     pauses, `;` comments. Mach3/4, MASSO, UCCNC, Centroid, Marlin, Smoothieware and RepRapFirmware
     can read these differently."
   - This helps owners of the PC or stand-alone controllers in Part 2 group 3, whom KerfDesk cannot
     detect.
2. **Frame, toggle and controller list (CN-2).**
   - Put the capability check first in CNC Frame.
   - Make the toggle warning name the controller fact.
   - Show the already-computed `cncSupported` in the controller select (e.g. "Marlin — laser only")
     when the setup includes CNC.
3. **Ruida (CN-3).** Give the right refusal reason. Decide whether tiled Save should honour the
   file-only route.
4. **Per-machine controller selection.** Keep it explicit; never switch the controller silently.
   - Presets stay geometry-only, but each could show the vendor-documented firmware and the matching
     KerfDesk choice with its source, plus a one-click, operator-pressed "Use grblHAL".
   - Sourced candidates from Part 2: LongMill MK2 (LongBoard GRBL 1.1h / SLB grblHAL), LongMill MK3
     and AltMill (grblHAL), OpenBuilds BlackBox 4X (GRBL) and X32 (grblHAL), V1E Jackpot (FluidNC),
     Genmitsu 3018-PRO (Grbl 1.1f), Shapeoko 3/4/Pro/XXL (GRBL 1.1), X-Carve Pro and Carvey (vendor
     GRBL forks).
   - For `unqualified` presets, say plainly that KerfDesk cannot connect to the stock controller and
     the export is GRBL-dialect.
   - The Connect banner (`detectedControllerKind`, already shown in Machine Setup) stays the
     confirmation.
   - Add catalog rows only with sources. Fix the X-Carve entry's provenance (see "Catalog pass").
5. **Named post-processors, or a Marlin or Smoothieware CNC dialect.** Not worth building before the
   warnings above. If demand appears, build them one controller at a time. Why:
   - **There is no single portable form.** Dwell is seconds on GRBL-family, LinuxCNC, Centroid and
     Mach4 (with a decimal point), but milliseconds on Marlin, MASSO, UCCNC and RepRapFirmware, and
     configurable on Mach3. `M0` pauses, is ignored, or ends the job depending on the controller.
   - **Do not add `G91.1` to the shared preamble**, although GRBL, grblHAL and FluidNC accept it as a
     no-op (`grbl/gcode.c:192`, `grblhal gcode.c:1626-1630`, `FluidNC GCode.cpp:505-515`). Marlin
     2.1.2.8 `gcode.cpp:466` and Smoothieware `Robot.cpp:622` ignore the `.1` and would switch to
     **relative** positioning. That is exactly the kind of cross-controller hazard a named post
     must be tested against.
   - **Marlin CNC:** the user base is shrinking. V1E's current boards are FluidNC Jackpots
     (FluidNC_Configs README); older MPCNC and LowRider SKR/Rambo boards run MarlinBuilder.
     - An export-only dialect would need `G4 S<sec>`, an S scale per `CUTTER_POWER_UNIT`, and a
       caveat that `M0` needs an LCD or `EMERGENCY_PARSER`.
     - Live Marlin CNC would also need a Frame retract, probing and CNC resume. **Needs decision;**
       low priority.
   - **Smoothieware or Carvera:** the tool change would have to be `M6` (ATC) or `M600`, and Makera
     ships its own CAM and controller software. Low priority; qualify on a Carvera first.
   - **PC or stand-alone controllers**, in order of likely reach:
     - MASSO (Onefinity Elite Gen 1, many retrofits): milliseconds dwell.
     - Mach3 and Mach4 (6040s, legacy Avid).
     - Buildbotics / Onefinity BB: LinuxCNC-documented and closest to the current output.
     - UCCNC (Stepcraft), Centroid (Avid), RepRapFirmware (WorkBee).
     - Each needs vendor-doc-backed tests and an air cut before it is offered.
6. **What to tell owners of PC or stand-alone controllers** (help text, plain words): KerfDesk cannot
   connect to your controller. You can design and save G-code, but the file is written for GRBL.
   Before running it:
   1. **Spin-up wait.** The file waits with `G4 P3.000`. MASSO, UCCNC, Marlin and RepRapFirmware
      read that as 3 ms; on Mach3 it depends on the "G04 Dwell param in Milliseconds" setting. Set
      the spin-up delay to 0 and start the spindle yourself, or edit that line.
   2. **Tool changes.** Multi-tool jobs pause with `M0`. Smoothieware and the Carvera ignore it, and
      RepRapFirmware ends the job. Export one file per tool instead.
   3. **Comments** start with `;`. Mach3's manual documents only `( )`; check your controller.
   4. **Arcs** use incremental I/J. Set Mach3's IJ mode to Incremental.
   5. **DDCSV panels** do not list G4, G21, G94, M0 or M7. Expect errors.
   6. Air-cut the file first with the bit raised.
7. **The owner's own machine (Neotronics 4040 Max).** The firmware is unverified. Send the Console
   output of `$I` and the connect banner. If it reports `Grbl 1.1…`, the profile's `grbl-v1.1` is
   right. If not, choose the kind the banner names.

---

## Checked and correct

- GRBL 1.1h reads `G4 P` in seconds (`grbl/motion_control.c:195`, `gcode.c:969`). `M0` pauses
  (`gcode.c:250`). `;` comments are accepted (`protocol.c:131-132`). Arcs use incremental I/J
  (`gcode.c:192`). KerfDesk's CNC vocabulary matches. https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L195
- grblHAL: dwell in seconds (`motion_control.c:853`, `gcode.c:4449`), `M0` pause (`gcode.c:1815`),
  `;` comments (`protocol.c:114`). https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L853
- FluidNC v4.0.3: dwell `p * 1000` ms, i.e. seconds (`GCode.cpp:1804`); `M0` (`:630`); `;` comments
  (`:184-185`). https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L1804
- `cncJobs` is true for exactly the GRBL-family drivers, including the Falcon wrapper, and false for
  Marlin, Smoothieware and Ruida (Part 1 table).
- Machine Setup refuses to save a CNC setup on a non-GRBL-family controller, as a factual validation
  (`device-setup-flow.ts:391-393`, `DeviceSetupShell.tsx:122,149`).
- The Start refusal `assertActiveDriverAcceptsMachineKind` is a factual transport refusal; it stays
  as defence in depth (`laser-job-actions.ts:220`).
- CNC Frame refusal on Marlin and Smoothieware is correct in substance (no retract builder); only
  its order and wording are wrong (CN-2).
- **Catalog pass (9 entries, `cnc-machine-catalog.ts`).** No entry's controller claim contradicts a
  source.
  - `genmitsu-3018` (GRBL): **T** SainSmart board manual; **†** product page. The "57600 baud
    variants" note was not re-verified (docs.sainsmart.com unreachable).
  - `genmitsu-4040` (GRBL): **†**.
  - `neotronics-4040-max` (`unqualified`): correct, the sources do not name the controller.
  - `shapeoko-3` and `shapeoko-xxl` (GRBL 1.1): **†** assembly manuals.
  - `xcarve-1000` (GRBL X-Controller): **plausible, but the catalog cites no controller source.** Its
    two sources cover work area and router use. Add a controller source; grbl wiki
    `Using-Grbl.md:146` covers X-Carve generally, not the November 2021 generation.
  - `onefinity-woodworker` and `onefinity-journeyman` (`unqualified`): correct.
    - **T** onefinity-firmware `setup.py:12` "Buildbotics Machine Controller"; **†** MASSO and
      Redline.
    - The note "MASSO dwell P uses milliseconds" is **†** (docs.masso.com.au).
  - `longmill-mk2-30x30` (GRBL 1.1h or grblHAL): **†** Sienci specs; **T** gSender and the grblHAL
    `driver.json`.
- Preset loading never changes the controller, and the UI says so (`DeviceSetupCncPreset.tsx:18-31,94-95`).

## Not covered

- **Vendor pages could not be re-fetched in this session** (egress proxy). Rows and dialect notes
  marked † rest on the first CN session's quotes. The lead may want to re-open them from a session
  with web access.
- **Machines left out as unverified** (no primary source reachable; vendor URLs found by search for
  follow-up):
  - Genmitsu 3018-PROVer V2 (https://docs.sainsmart.com/article/appuv0ufmb-3018-prover-v-2).
  - SainSmart PROVerXL 6050 / 6050 Plus
    (https://docs.sainsmart.com/article/cc5dkqbvzq-genmitsu-prover-xl-6050-plus-resource-page).
  - Carbide 3D Shapeoko HDM (https://carbide3d.com/hub/docs/shapeoko-hdm-v3/).
  - BobsCNC E3/E4 (https://www.bobscnc.com/blogs/help-center/installing-the-latest-grbl-firmware-to-the-e3-cnc-router).
  - Vevor 3018, Ortur and Atomstack CNC kits, CNC4Newbie/MASSO retrofits, MillRight, YoraHome.
  - Sienci's gSender ships size presets for several of these. That shows they are used with
    GRBL-family senders, not what their stock controller is, so it is not used as evidence.
- **Firmware behaviour not settled from source:** Carvera official binaries' build flags (the CNC
  define decides `grbl_mode`); Buildbotics planner handling of G4 and M0 (docs links only); Redline
  and DDCSV dialects beyond the † PDF; RepRapFirmware `;` comment handling.
- **Out of CN scope:**
  - Marlin's reply to `G54` on builds without `CNC_COORDINATE_SYSTEMS` during Frame normalization
    (MA and CG tracks). It would change which wrong message CN-2's operator sees first, not the
    finding.
  - Laser-dialect correctness for Smoothieware in the Output dialect select (OR track).

## Changes from CN-partial.md

- **Catalog count** is 9, not 10.
- **Line references updated:** FluidNC capability spread `fluidnc/driver.ts:65-69` (was 76-91);
  `PROJECT.md:401-402` (was 391).
- **CN-1 narrowed with upstream facts:** a Smoothieware CNC build reads `G4 P` in seconds, and V1E
  TFT35 Marlin builds pause on M0. **CN-1 widened** to tile and surfacing exports.
- **CN-3 written up in full,** with the tiled-Ruida bypass. **CN-4 added.**
- **Machine table:**
  - Added (T): LongMill MK1 and MK3, Carvey, Genmitsu 1810-PRO, plus GitHub corroboration for eight
    rows.
  - Dropped unsourced details: WorkBee "RRF 3.3", TTC450 "ESP32 board".
