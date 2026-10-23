# Meta audit v1 — M5 Primary-source citations (`meta-citations`)

- **When:** 2026-10-23 12:15–13:10 (+08)   **Tree:** worktree HEAD `c795f081e` (audit branch);
  `origin/main` @ `87ecb4f24` (last fetched ref, not re-fetched: no writing git commands). ADR and
  WORKFLOW quotes were checked against each round's own audited tree, exported read-only to the
  scratchpad with `git archive`: `70c01e11f` (rolling-v2; 13 used `2c8d988db`), `99a2e64b7` (C),
  `7cd526213` (D), `71ff820ce` (E), `17f4d6b68` (F), and `87ecb4f24`.
- **Scope:** every primary-source citation in rolling-v2 01–28, controller-v2 C1–C8, controller-v3
  D1–D8, controller-v4 E1–E6 (the held E4 file was read in place, not added) and CNC v1 F1–F6. F7 is
  in progress and was left out.
- **Method:** METHOD.md with the meta changes in AREAS.md. Report only; nothing in the repo was
  changed except this file.
  - **Candidate list (grep).** About 250 distinct firmware `file:line` references, 9 upstream commit
    SHAs, 60 external URLs, and 323 `ADR-NNN … "quote"` pairs.
  - **How the sample was chosen.**
    - Every P1 or P2 (confirmed, KNOWN or raised) whose anchor names a ground-truth source or quotes
      an ADR was taken first. The table covers 59 such findings, including all four P1s with such an
      anchor (F3-P1-1, F6-P1-1, 09-P1-1, C2-P1-1). The only P1/P2 with a public outside anchor left
      out is 21-P2-1, whose ground truth is real `.lbrn2` sample files, not a page. The other
      rolling-v2 P1s anchor on twins and code and were fully re-run by M1.
    - P3 and "Verified clean" citations were then added so that every firmware and vendor family has
      at least three groups.
    - Last, a scripted scan checked every ADR-quote pair (below). Its 71 non-matches were triaged
      by hand.
  - **Upstream SHAs.** All 9 resolved with `gh api repos/<o>/<r>/commits/<sha>`: grblHAL core
    `d7aaee3d`, `62f25d42`, `4ec1ae44`; gnea/grbl `bfb67f0c`; Smoothieware `91fe428`, `38e2cc08`;
    FluidNC `6735500`, `fdc17a2c`; Plugin_networking `e0131fb2`. Tags used: gnea `v1.1f.20170801`,
    Marlin `2.1.2.5` and `2.1.2.8`, FluidNC `v4.0.3`.
  - **How sources were re-fetched.**
    - Firmware files came from `raw.githubusercontent.com` at the cited SHA or tag. Where the report
      said "master" or "main", the commit nearest the audit was used.
    - Docs and vendor pages came through `curl` plus a text extractor, or WebFetch. PDFs were read
      with the repo's `pdfjs-dist`.
    - Copies are in the scratchpad `m5-src\`, `m5-dl-ortur\` and `m5-dl-amana\`. The scripts are in
      `m5-scripts\` (`adr-quotes.mjs`, `find-quote.mjs`, `htmltext.mjs`, `pdftext.mjs`).
  - **Scripted ADR-quote scan.** `adr-quotes.mjs` matched each quote against the cited ADR (base,
    file amendment or inline amendment), after normalising whitespace and quote marks.
    - Of 319 in-scope pairs, 242 matched the cited ADR verbatim, and 6 matched an inline amendment
      of the same ADR.
    - The other 71 were triaged by hand against the audit-time trees with `find-quote.mjs`:
      - most quote UI text, code comments or outside sources that sit next to an ADR mention;
      - some are line-wrap or punctuation artefacts;
      - the rest are listed in M5-P3-1 to M5-P3-5.
  - **Rules for a result.**
    - Line drift of a few lines with the content present is **clean** (noted in the table).
    - A quotation whose words are not in the source but whose meaning is is **paraphrase**.
    - A quote or claim that the cited source does not contain, or attributes to the wrong source,
      is **bad**.
- **Counts:** 123 citation groups sampled by hand (about 330 individual lines and quotes), plus 319
  ADR quotes by script.
  - **Bad: 4**, none verdict-changing. After the refuter: **8**, still none verdict-changing. The
    four ADR rows of M5-P3-5 are verbatim ADR-tagged code comments or README text, so they are
    wrong source like M5-P3-2.
  - **Paraphrased quotes: 8**, all with their substance supported. After the refuter: **3** (the
    two LightBurn rows and Cloudflare NEL). Four moved to Bad, and the E4-P2-4 row is acceptable.
  - **Unverifiable: 2.**
  - **Meta findings: 6, all P3.** Refuter (2026-10-23): confirmed 6, plausible 0, refuted 0.
    - M5-P3-3, P3-5 and P3-6 are amended. One M5-P3-5 row (E4-P2-4) is refuted.
    - No REFUTER-RAISED finding.
    - Independent re-fetch of 15 "clean" rows (3, 4, 8, 12, 13, 15, 22, 24, 25, 50, 64, 83, 84,
      98, 123): 15/15 clean.
    - Also clean, outside the table: 03-P1-1's ADR-273 quote and gnea `protocol.c:79` (CR ends a
      line); grblHAL `changelog.md` `$384` under "Build 20210928" (M3-P3-2).

## Headline

No sampled citation that decided a P1 or P2 verdict is false. The firmware citations are
consistently accurate:

- 50 groups across GRBL, grblHAL, FluidNC, Marlin and Smoothieware;
- every cited SHA and tag exists;
- every `file:line` holds the cited code within a few lines;
- each behaviour the reports draw from the code is what the code does.

LightBurn, vendor, CAM and platform citations hold too. They had three paraphrases and one page
that moved.

The defects are in quotations of KerfDesk's own ADRs:

- a quote credited to the wrong ADR (23-P2-3: ADR-311, not ADR-313);
- a code comment presented as ADR text (14-P3-1);
- an ADR "naming" a mechanism in words it does not contain (C1-P3-4, ADR-257);
- a refuter's ADR quote altered from `$32` to `$$` (E2-P2-1, ADR-637 Amd 1).

Each verdict still stands on its other evidence (a REPRO, a WORKFLOW clause or a verified outside
source), so every meta finding is P3. One method gap (M5-P3-6): SOURCE evidence is often cited as
"master", "main", "latest" or with no URL. Two cited pages have already moved or been reworded, and
one refuter could not re-fetch a ground-truth page that still exists.

## Citation table

Columns: **Exists** = the cited file, line, page or quote exists at the cited ref. **Says** = it
says what the report claims. **Verdict** = the finding's verdict depends on it (Y), partly (part),
or not (N). gnea/grbl is `bfb67f0` unless noted.

| # | Citation | Report / finding | Exists | Says | Verdict | Result |
|---|---|---|---|---|---|---|
| 1 | gnea `system.c:270` trailing char → `STATUS_INVALID_STATEMENT` | C4-P2-1 (twin) | Y | Y | part | clean |
| 2 | gnea `protocol.c` L96, L120, L122, L125, L131; `system.c` L230, L235 | C5-P3-1 | Y | Y | Y | clean |
| 3 | gnea `spindle_control.c` L197-213 (`rpm_min >= rpm_max` → max PWM before the S0 branch; linear `floor((rpm-rpm_min)*pwm_gradient)` L213); `settings.c` L194 | 03-P2-4, 03-P2-5 | Y | Y | Y | clean |
| 4 | gnea `gcode.c` :44, :418-421, :590-598, :664, :848-866, :1092-1095; `planner.c:389` (`limit_value_by_axis_maximum`); `probe.c:59-65` | D2-P3-3 (P2); 18-K-2, E6-K-1 (P2 KNOWN) | Y | Y | Y | clean |
| 5 | gnea `gcode.c` L869-872 laser disable only under `BITFLAG_LASER_MODE` | D5-P2-2 | Y | Y | Y | clean |
| 6 | gnea `gcode.c:1084-1089`, `protocol.c:208`, `:349-366`, `system.c:132` | E3-P2-1 | Y | Y | Y | clean |
| 7 | gnea `system.c:179-180` (`$H` with homing off → error:5) | E2-P3-2 | Y | Y | Y | clean |
| 8 | gnea `gcode.c` L944 "All spindle state changes are synced"; Laser Mode wiki M3 "regardless if the machine is moving, accelerating, or stopped" | C1-P3-4 | Y | Y | Y | clean |
| 9 | gnea `config.h` L88 `HOMING_INIT_LOCK`, L106 `HOMING_CYCLE_1`; `alarm_codes_en_US.csv` code 9 | D3-P2-2 | Y | Y | Y | clean |
| 10 | gnea `protocol.c` `/` ignored; `config.h` L501 `$RST=*` enabled by default | 17-P3-2 | Y | Y | Y | clean |
| 11 | gnea `report.c:172` banner (master 1.1h and tag `v1.1f.20170801`), `grbl.h:25-26`; grbl/grbl 0.9j `report.c:151` | D6-P3-3, P3-4 | Y | Y | Y | clean |
| 12 | gnea `gcode.c` L540 ("Index P0 as the active coordinate system"), L997 (G5x persists) | C2-P1-1 | Y | Y | part | clean |
| 13 | GRBL Laser Mode wiki "**MUST** disable laser mode … `$32=0`"; gnea `protocol.c` L672-673 skips spin-up in laser mode | D4-P2-1 | Y | Y | Y | clean |
| 14 | GRBL wiki FAQ "hardwired to reset and re-flash the Arduino" | 18-P2-1 | Y | Y | part | clean |
| 15 | GRBL Configuration wiki `$130` "maximum travel from end to end" | E2-P2-1 | Y | Y | part | clean |
| 16 | gnea `settings.c` L229 (non-axis setting truncated to uint8) | C4-P2-1 via ADR-375 | Y | Y | part | clean |
| 17 | gnea `gcode.c` L462-469 G18/G19 axis map | 26-K-1 (P2 KNOWN) | Y | Y | Y | clean |
| 18 | gnea `report.c:515` WCO includes TLO; `serial.c:150-156` realtime bytes | E4 table rows | Y | Y | N | clean |
| 19 | gnea `alarm_codes_en_US.csv` code 3 "Reset while in motion" | 05-K-3, 08-K-2 (P2 KNOWN) | Y | Y | Y | clean |
| 20 | GRBL Laser Mode wiki: jogs "inherit and maintain the previous laser state" | D5 Verified clean | Y | Y | N | clean (Laser Mode page, not Jogging) |
| 21 | grblHAL `d7aaee3d` `machine_limits.c:116-140` (134-135), 156-159; `settings.h:714-725`; `settings.c:473`, `:1775-1782`; `config.h:96-97`, `:1944-1946`; `motion_control.c:832-835`; `errors.h:47`; `report.c:944-945` | C3-P2-1 | Y | Y | Y | clean (`force_set_origin` at L719) |
| 22 | grblHAL `d7aaee3d` `settings_store_setting` L3527-3552; `nuts_bolts.c` `read_uint` L195-244 (`.0` multiplies) | C4-P2-1, C5-K-3 (P2 KNOWN) | Y | Y | Y | clean |
| 23 | grblHAL `d7aaee3d` `settings.h` `reportmask_t` L657-665; `set_report_mask` L854-864; `$10` legacy text L2363; `report.c` Ov/WCO gates L1446/L1466 | C8-P2-2 | Y | Y | Y | clean |
| 24 | grblHAL `stream.c@62f25d42` L394-397, L433-434; Plugin_networking `telnetd.c@e0131fb2` L239-249, L409-410, L442-443 | D7-P2-1, D7-P3-4 | Y | Y | Y | clean |
| 25 | grblHAL `stream.c@4ec1ae44` `stream_usb_linestate_changed` (welcome 200 ms after DTR); RP2040 `usb_serial.c:318-322`; STM32F4xx `usbd_cdc_if.c:230-233` | D7-R1 | Y | Y | Y | clean |
| 26 | grblHAL `coolant_control.c` `coolant_set_state_synced`: sync, then `on_delay` | 03-P2-1 | Y | Y | Y | clean |
| 27 | grblHAL `settings.c` Format_Password printed unless `webui_connected` (master L1961-1962); ESP32 `main/wifi.c` 75/77/533 | 27-P2-3, C5-P2-1 | Y | Y | Y | clean |
| 28 | grblHAL `gcode.c:1825-1827` M1 optional stop | E4-P2-3 | Y | Y | Y | clean |
| 29 | grblHAL `gcode.c:2418` push last feed; `gc_init` zeroes the parser state | D2-P3-3 | Y | Y | part | clean |
| 30 | grblHAL `gcode.c:1861-1863` M7 refused without a mist output | D1-P3-1 (twin) | Y | Y | part | clean |
| 31 | grblHAL `report.c:307-316` banner by `COMPATIBILITY_LEVEL`; `:921-923` extended `$I` | D6-P3-2, P3-3 | Y | Y | Y | clean |
| 32 | grblHAL `d7aaee3d` `settings.h:130-131` (`$74`/`$75` WiFi) | C7-P2-2 | Y | Y | Y | clean |
| 33 | grblHAL `d7aaee3` `errors.h:93-99,101,120,124,129`; `errors.c:36,68,109` | C5-P3-3 | Y | Y | Y | clean |
| 34 | grblHAL `d7aaee3d` `protocol.c`: no `/` handling | 17-P3-2 | Y | Y | part | clean |
| 35 | FluidNC `6735500` `Spindle.h:182-188` `spinup_ms` "@default 0"; `Spindle.cpp:280`; `Parking.cpp:147-158`, `185-187` | D4-P2-2 | Y | Y | Y | clean |
| 36 | FluidNC `v4.0.3` `GCode.cpp:314-327` (`#`, O-word); `Parameters.cpp:583-584` (`[expr]`) | E4-P2-2 | Y | Y | Y | clean |
| 37 | FluidNC main `GCode.cpp:813-816`, `v4.0.3` `:634-636` "M1 - Optional Stop not supported"; gnea `gcode.c:251` "Optional stop not supported. Ignore." | E4-P2-3 | Y | Y | Y | clean |
| 38 | FluidNC `6735500` `SettingsDefinitions.cpp:107-108` `Start/Message`; `Protocol.cpp:699-700` | D6-P3-5 | Y | Y | Y | clean |
| 39 | FluidNC `v4.0.3` `ProcessSettings.cpp` L1034, L1067, L1080, L1090, L1213, L1224-1240 | C6-P3-1 | Y | Y | Y | clean |
| 40 | FluidNC `6735500` `GCode.cpp:855-870` (M8 only if `hasFlood`), `:1947-1964` (sync) | D1-P3-1, P3-3 | Y | Y | Y | clean |
| 41 | FluidNC `6735500` `GCode.cpp:606-610` "No probe pin defined" | D2-P3-1 | Y | Y | Y | clean |
| 42 | Marlin 2.1.2.5 `M3-M5.cpp` L84-85 (`M3 I` continuous); `stepper.cpp` L2345-2348 (off at empty planner only when dynamic); `M7-M9.cpp` L35 sync; `planner.cpp` L115 `BLOCK_DELAY_FOR_1ST_MOVE 100U` | 03-P2-2 | Y | Y | Y | clean |
| 43 | Marlin 2.1.2.8 `motion.h:461-465`, `G0_G1.cpp:48`, `motion.cpp:1465-1496`, `queue.cpp:523-535` | C6-P2-2 | Y | Y | Y | clean |
| 44 | Marlin 2.1.2.5 `spindle_laser_types.h` L62-67 (`uint8_t cutter_power_t`); `gcode.cpp` L236-240; `spindle_laser.h` L162; `M3-M5.cpp` L94 | E1-P3-3 | Y | Y | Y | clean |
| 45 | Marlin 2.1.2.8 `Configuration_adv.h:3626`, `:2404`; `Configuration.h:1697`; `MarlinCore.cpp:1185` | D6-P3-1, C6-P3-4, P3-5 | Y | Y | Y | clean |
| 46 | Marlin 2.1.2.5 `probe.cpp:894-897` (nozzle moves by the probe XY offset) | D2-P3-4 | Y | Y | Y | clean (2.1.2.8: L896-899) |
| 47 | Smoothieware `38e2cc08` `Laser.cpp:198-212` (M221 S), `:251` (power = S × ratio × scale); `Robot.cpp:331-352`; smoothieware.org "M221 Snnn globally scales the laser power provided by G1" | C6-P2-1 | Y | Y | Y | clean (formula at L251; L252-264 is the ISR) |
| 48 | Smoothieware `91fe428` `GcodeDispatch.cpp:385-422`; `Switch.cpp:62-70` `on_halt` | D1-P3-1, P3-2 | Y | Y | Y | clean |
| 49 | Smoothieware `91fe428` `SimpleShell.cpp:683-686` (reboot in 5 s), `:210-213`; `USBSerial.cpp:258-261` (256-byte rx flush) | E4-P2-4, E4 table | Y | Y | Y | clean |
| 50 | LightBurn 2.1 RotaryModeGCode: roller Object Diameter "does not affect output"; Test turns "the roller or wheel driven by the motor" | D3-P2-1 | Y | Y | Y | clean |
| 51 | LightBurn 2.1 RotaryModeGCode: Current Position best; "centered around the starting position of the laser head" | 03-P2-3 | Y | Y | Y | clean |
| 52 | LightBurn 2.1 RotaryModeGCode: Alarm:2 "because rotary travel exceeds the Y axis Max Travel" | D3-P2-2 (P3) | Y | paraphrase | N | M5-P3-5 |
| 53 | LightBurn SettingsPreferences: SVG "96 DPI — the default for Inkscape", "72 DPI — the default for Adobe Illustrator" | 14-P2-1 | Y | Y | Y | clean |
| 54 | LightBurn SettingsPreferences: DXF "doesn't contain its units … may import at the wrong scale" | 14-P3-4 | Y | paraphrase | N | M5-P3-5 |
| 55 | LightBurn 2.1 VariableText: Max Width limits output width after expressions are converted | 15-P2-1 | Y | Y | part | clean |
| 56 | LightBurn 2.1 SubLayers: "Toggle the Output switch on or off to determine whether a given Sub-Layer is included" | 21-P2-2 | Y | Y | Y | clean |
| 57 | LightBurn 2.1 GRBLConfiguration: "GRBL 1.1e or older … must use the GRBL-M3 device" | 21-P3-1 | Y | Y | Y | clean |
| 58 | LightBurn CamerasWindow / EditCamera: "cameras are specific to each device", `.lbcm` | 12-P2-1 (P3) | Y | Y | Y | clean |
| 59 | LightBurn MoveWindow: keypad jogging needs Num Lock | C8-P2-1 | Y | Y | part | clean |
| 60 | LightBurn 2.1 CNCBasedLasers: "Type `$10=0` in to the Console Window"; no grblHAL mention | C8-P2-2 | Y | Y | part | clean |
| 61 | LightBurn 2.1 MaterialTest: "an ascending list of potential risk of burning or charring material" | E5-P2-3 | Y | Y | Y | clean |
| 62 | LightBurn OptimizationSettings: "The outer shape must be closed in order for this optimization to apply" | 03-P2-9 | Y | Y | part | clean |
| 63 | LightBurn TraceImage: "A value of 0 leads to no optimization"; no default for Ignore Less Than or Smoothness | 07-P3-2, P3-4 | Y | Y | Y | clean |
| 64 | LightBurn "Moves are burned": GRBL laser "still on when moving between shapes" → `$32=1` | D5-P2-2 | Y | Y | part | clean (no URL in the report; the refuter got 404; it is at `/2.0/Troubleshooting/JobQuality/MovesAreBurned/`) |
| 65 | LightBurn forum t/167561 "The rotary device replaces one of the axis motors, so the engraver can't reach the switch" | D3-P2-2 | Y | Y | N | clean (a user post, used as secondary) |
| 66 | LightBurn forum t/3392/2 "the default setting is 2.5%" | 21-P3-8 | Y | Y | Y | clean |
| 67 | LightBurn forum t/50968: Oz, auto-close joins lines whose ends are within the distance | 03-P2-9 | Y | Y | N | clean |
| 68 | LightBurn forum t/76960: LM3 `[FIRMWARE:grblHAL]`, `GrblHAL 1.1f` banner | C7-P2-2 | Y | Y | Y | clean |
| 69 | LightBurn forum t/88769: "The workspace of the S30 Pro is NOT 400x410! It's 380×385." | E2-P2-1 | Y | Y | part | clean |
| 70 | creality.com Falcon A1: "Engraving Area 305 mm × 381 mm" | C7-P2-3 | Y | Y | Y | clean |
| 71 | creality.com Falcon A1 Pro: "Engraving Area: 268*358mm", "600mm/s" | C7 vendor table | Y | Y | N | clean |
| 72 | xTool help 17020224257559 (Zendesk API): "The maximum processing speed for D1 Pro is 400mm/s" | C7-P3-3 | Y | Y | Y | clean |
| 73 | xTool help 14109952045463: "Working Area 430 * 400 mm 430 * 390 mm" | C7 vendor table | Y | Y | N | clean |
| 74 | Ortur OLM3 manual (Ortur-Tech GitHub, 40 pp.): p.12 `$74`/`$75`; p.20 "S-MAX 1000", "20000mm/min", "M4-Dynamic Power"; p.25 400 mm and "Front Left" | C7-P2-2, P3-3 | Y | Y | Y | clean |
| 75 | sculpfun.com "Setting Up The Software": homing "usually … not enabled in the firmware", `$22=1`, "S-Value must be set to 1000", "front left is correct" | C7-P3-2 | Y | Y | Y | clean |
| 76 | neotronics.co.za 4040 Max: "Working Area : 400x400x75mm", "By Default we provide the 500w spindle motor" | C7 vendor table | Y | Y | N | clean |
| 77 | Carbide 3D forum 52642: "Width of cut / 2 / tan(half angle of bit)" | F1-P2-1 | Y | Y | part | clean |
| 78 | Vectric V12 VCarve Desktop: clearance tools "will leave an allowance for the V-Carving tool" | F1 Verified clean | Y | Y | N | clean |
| 79 | Vectric V12 VCarve Pro: "Start Depth (D) specifies the depth at which the V-Carving toolpath is calculated"; Carbide 3D 28552/4 "The 'Start Depth' is the amount the inlay will insert…" | F5-P2-1 | Y | Y | part | clean |
| 80 | Vectric V12.5 VCarve Inlay: Glue Gap is "the distance between the Top of the Plug and the Bottom of the Pocket" when placed together | F5-P2-2, P3-1 | Y | Y | part | clean |
| 81 | Vectric V12 Aspire material-setup-flat: "The gaps defined here are for the entire combined models from both sides" | F6-P1-1 | Y | Y | part | clean |
| 82 | Amana 2-flute DLC solid-wood chart: 1/8" and 1/4" softwood, hardwood and MDF chiploads | F4 chart table | Y | Y | N | clean (all six cells match) |
| 83 | Autodesk Fusion 3D Adaptive reference: "guarantees a maximum tool load"; "A positive stock value leaves material" | F2-P1-1 | Y | Y | part | clean |
| 84 | Vectric V12 pocketing form: "previously unmachined areas"; stepover "greater than 50% … 'Tail' moves" | F2-P2-2 | Y | Y | part | clean (no URL in the report; found at Aspire `uiPocketMachineForm`) |
| 85 | Glowforge 10859: Responsive export "doesn't set the height and width at all" | 14-P2-1 | Y | Y | part | clean |
| 86 | OpenCAMLib README "drops a cutter … until it touches the 3D model"; `millingcutter.cpp` L386-403; `adaptivepathdropcutter.cpp` 0.1 / 0.01 | 16-P2-1, F6 | Y | Y | part | clean |
| 87 | Cloudflare Rate Limiting: "permissive, eventually consistent" | 01-P2-5 | Y (archive) | Y | N | clean (the live page was reworded "Last updated Oct 21, 2026"; the quote is in the 2026-10-05 Wayback copy) |
| 88 | Cloudflare trace spans: `user_agent.original`, `geo.locality.name`, `cloudflare.asn`, `url.full` | 02-P3-16 | Y | Y | Y | clean |
| 89 | Microsoft ConfigMgr: "some specialty hardware devices have duplicate identifiers" | 02-P3-15 | Y | Y | Y | clean |
| 90 | Cloudflare NEL: browsers "report their own network failures to an external endpoint" | 22-P3-4 | Y | paraphrase ("network" inserted) | N | M5-P3-5 |
| 91 | GitHub secure-use: "Any user with write access to your repository has read access to all secrets"; pin to a commit SHA | 11-P3-1 (P2) | Y | Y | Y | clean |
| 92 | GitHub billing: Actions "free for self-hosted runners and for public repositories that use standard GitHub-hosted runners" | 11-P3-10 | Y | Y | Y | clean |
| 93 | Chromium `user_activation_state.h:23` `kActivationLifespan = base::Seconds(5)` | 19-P3-2 | Y | Y | Y | clean (L18 is the 60 s MSan build) |
| 94 | Chromium `serial_io_handler_win.cc:244` `DTR_CONTROL_ENABLE` | D7-R1 | Y | Y | Y | clean |
| 95 | FFmpeg `rtsp.c:2253` 3xx → redirect; commit `a441a2eb38` | 04-P3-10 | Y | Y | Y | clean (author date 2026-07-22, as stated) |
| 96 | W3C uievents-code: Numpad3 "3 PgDn", Numpad9 "9 PgUp"; NumLock "mimicking the keys of the control pad" | C8-P2-1 | Y | Y | Y | clean |
| 97 | WICG File System Access `index.bs` L832 "Set entry's binary data to an empty byte sequence" | 19-P2-1 | Y | Y | Y | clean |
| 98 | ADR-140 Decision (projects tab-center anchors, "preserves tab locations"); ADR-258 "Finishing tab centres are still projected…", "a running spindle" | F3-P1-1 | Y | Y | Y | clean |
| 99 | ADR-580 Decision 4 ("1 mm frame … centred in stock … one web apart … stays held"); split UI note | F6-P1-1 | Y | Y | Y | clean |
| 100 | ADR-250 Decision 1 (waste side); Consequences "a disjoint neighbouring part" | 09-P1-1 | Y | Y | Y | clean |
| 101 | ADR-493 decision 6 (keypad jogs while Num Lock is on; with it off "one key never both nudges and jogs") | C8-P2-1 | Y | Y | Y | clean (the anchor's "never jogs" is a fair reading) |
| 102 | ADR-375 decision 9 `:236-237` "grblHAL refuses such values itself" | C4-P2-1 | Y | Y | Y | clean |
| 103 | ADR-375 decision 3 "from grblHAL's own envelope"; 4th bullet "With hard limits on (or `$21` unread) …"; "typed head moves … are unchanged" | C3-P2-1, P2-2 | Y | Y | Y | clean |
| 104 | ADR-398 Amd 3 Consequences "neither resets when its port opens nor loses power shows no banner on reconnect" | D7-P2-1, D7-R1 | Y | Y | Y | clean |
| 105 | ADR-400 Amd 1 rule 1 "a Z target and an optional feed" | D2-P3-3 | Y | Y | Y | clean |
| 106 | ADR-046 Consequences "mm-sized exports import at true physical size; an import DPI setting … stays future work" | 14-P2-1 | Y | Y | part | clean |
| 107 | WORKFLOW F-CNC15 Success 1-3 (re-zero Z in the hold; Continue disabled until Z is set) | E3-P2-1 | Y | Y | Y | clean |
| 108 | ADR-497 D3 "Every axis runs from its lowest-risk value … the first cell burned is the gentlest" | E5-P2-3 | Y | Y | Y | clean |
| 109 | ADR-412 Consequences "replaced by a chord below it … A finer grid is the remedy"; Amd 1 "at most half a cell" | 16-P2-1 | Y | Y | part | clean |
| 110 | "ADR-313 §2: 'same-document reopen remains resumable'" | 23-P2-3 | Y in ADR-311 §2 | wrong ADR | part | **bad**, M5-P3-1 |
| 111 | WORKFLOW F-L1 step 4 "reopening the same image resumes it"; `ImageEditorTopBar.tsx:145` Close title | 23-P2-3 | Y | Y | Y | clean |
| 112 | "ADR-358 Amendment 2 item 4: … because 'clip geometry decides what is cut'" | 14-P3-1 | N in ADR; Y in `svg-clip-presentation.ts:4` | wrong source | part | **bad**, M5-P3-2 |
| 113 | "ADR-257 names this mechanism ('burns at full programmed S while accelerating')" | C1-P3-4 | N | N | N | **bad**, M5-P3-3 |
| 114 | "ADR-637 Amd 1 #1, whose reasoning ('`$$` is a setting of its controller')" | E2-P2-1 (refuter) | N as quoted; ADR says "`$32` is a setting of the controller" | altered | part | **bad**, M5-P3-4 |
| 115 | ADR-409: commit converts settings "so they drop what the preview dropped" | 07-P2-2 | Y | paraphrase | part | M5-P3-5 |
| 116 | ADR-454: Line + fill strokes "burn once down their centre" | 07-P2-3 | Y | paraphrase (title) | part | M5-P3-5 |
| 117 | ADR-307 Amd 1 holds "every other command that adds objects in one step" to the limits | 13-P2-1 | Y | paraphrase (decision 7) | part | M5-P3-5 |
| 118 | ADR-585 contract "disconnect refused during a job or motion" | 17-P3-3 | Y | paraphrase | N | M5-P3-5 |
| 119 | ADR-630 Amendment 1 refuses `$` lines that "belong in the Console" | E4-P2-4 | Y in base Decision (Refusals), not Amd 1 | wrong section | N | M5-P3-5 |
| 120 | ADR-245 §1 "Layer count is operator-bounded, not guarded." | 23-P3-5 | Y | Y | Y | clean |
| 121 | ADR-258 Amd 3 item 3 "Inlay pairs, whose plug is cut from its own board, do not pass through this gate" | 09 Verified clean | Y | Y | N | clean |
| 122 | ADR-630 Amd 1 item 2 "is placed on the bed the way a jog's path is"; Amd 1 "not in the Frame outline" | D5-P2-3, 26-K-1 | Y | Y | part | clean |
| 123 | FluidNC `v4.0.3` `SpindleDatatypes.h:5` `typedef uint32_t SpindleSpeed`; `GCode.cpp:1650` `pl_data->spindle_speed = gc_state.spindle_speed` (float → uint32) | E1-P2-1 | Y | Y | Y | clean (firmware; listed last) |

## Findings

### M5-P3-1 — Bad citation (23-P2-3): the "ADR-313 §2" quote is ADR-311 §2

- **Corrects:** rolling-v2 23-P2-3 anchor: "ADR-313 §2: 'same-document reopen remains resumable'
  (exact identity was meant to fence *replacement documents*)". JSON anchor "ADR-313 s2".
- **Kind:** Bad citation (wrong ADR).
- **Where:** `docs/audits/2026-10-21-rolling-v2/23-image-editor.md:152` and the JSON at `:570`.
- **What the source says:**
  - On `70c01e11f` the sentence is in DECISIONS.md L19379. That is ADR-311 ("Exact owners govern
    machine commands, async documents, and release publication"), decision 2, "Asynchronous
    document ownership": "Stashes purge owners from older document epochs while same-document
    reopen remains resumable."
  - ADR-313 §2 is "Compatibility without a new refusal" and covers SVG units.
  - ADR-313 §1 does bind Edit Image to the exact object owner, so the refuter's "ADR-313 §1" at
    `:173` is right.
- **Verdict impact:** none.
  - 23-P2-3 also stands on WORKFLOW F-L1 step 4 ("reopening the same image resumes it", verified) and
    on the Close title at `ImageEditorTopBar.tsx:145` (verified).
  - The refuter reproduced it.
  - The quoted words exist, in a sibling ADR with the same meaning.
- **Evidence:** SOURCE. `find-quote.mjs` located the quote; `awk` found the enclosing ADR header.
- **Severity:** P3.
- **Refuter:** CONFIRMED (2026-10-23). I re-read `DECISIONS.md` at `70c01e11f` myself.
  - "Stashes purge owners from older document epochs while same-document reopen remains resumable"
    is at L19378-19379, under `## ADR-311` (L19323), decision 2.
  - ADR-313 decision 2 (from L19552) is "Compatibility without a new refusal". ADR-313 decision 1
    does say "same-document reopen", but about Design Library dialog revisions, not resumable
    sessions.
  - The fix itself landed as `ADR-311-amendment-2-studio-session-survives-placement-changes.md`
    (on `87ecb4f24`), which confirms ADR-311 is the ADR in charge.
  - The verdict does not change. WORKFLOW F-L1 step 4 (`WORKFLOW.md` L8015-8017 at `70c01e11f`,
    "reopening the same image resumes it") and the Close title (`ImageEditorTopBar.tsx:145`) were
    re-read and say what 23 claims, and the REPRO stands.
- **Fix direction:** Change "ADR-313 §2" to "ADR-311 §2" in the 23 report and its JSON.

### M5-P3-2 — Bad citation (14-P3-1): a code comment is quoted as ADR-358 Amendment 2 text

- **Corrects:** rolling-v2 14-P3-1: "ADR-358 Amendment 2 item 4: refuse rather than guess, because
  'clip geometry decides what is cut'".
- **Kind:** Bad citation (wrong source).
- **Where:** `docs/audits/2026-10-21-rolling-v2/14-vector-importers.md:113`.
- **What the source says:**
  - ADR-358 Amd 2 item 4 lists refusals, including "Clip geometry or transforms set through CSS".
  - Neither it nor any other ADR-358 file contains "decides what is cut".
  - The phrase is the header comment of `src/io/svg/svg-clip-presentation.ts:4` on `70c01e11f`:
    "Clip geometry decides what is cut".
- **Verdict impact:** none. The refusal itself is in item 4, and 14-P3-1 is a twin finding (clip
  reader against artwork reader).
- **Evidence:** SOURCE (ADR-358 files at `70c01e11f` and `87ecb4f24`; `git grep` on src).
- **Severity:** P3.
- **Refuter:** CONFIRMED.
  - ADR-358 Amd 2 item 4 at `70c01e11f` (file L57-66) lists "Clip geometry or transforms set
    through CSS" among the refusals. It never says "decides what is cut".
  - `git grep` over `DECISIONS.md` and `docs/decisions` on `70c01e11f` and `87ecb4f24` finds the
    phrase only in `src/io/svg/svg-clip-presentation.ts:4`.
  - This softens the fault but does not refute it. That comment ends "(ADR-358 Amendment 2)", and
    the file is the twin that 14 cites in the same sentence. So the auditor quoted an ADR-tagged
    code comment as ADR text; it did not invent the words.
  - The verdict does not change: item 4's CSS refusal is in the ADR, and the finding rests on its
    REPRO.
- **Fix direction:** Attribute the quote to `svg-clip-presentation.ts:4`. Keep "item 4" for the
  refusal.

### M5-P3-3 — Bad citation (C1-P3-4): ADR-257 does not contain the words the report says it "names"

- **Corrects:** controller-v2 C1-P3-4, "Project precedent: ADR-257 names this mechanism ('burns at
  full programmed S while accelerating')".
- **Kind:** Bad citation (quote not in source).
- **Where:** `docs/audits/2026-10-22-controller-v2/C1-ctl-native-resume.md:288`.
- **What the source says:**
  - ADR-257 (DECISIONS.md on `99a2e64b7`) quotes GRBL's laser-mode doc: M3 lead-in and lead-out
    "to give some space for the machine to accelerate and decelerate" against scorching.
  - Its Consequences say "M4 reduces delivered power in acceleration zones".
  - The quoted phrase appears nowhere in any ADR on any audited tree.
- **Verdict impact:** none. C1-P3-4 also cites the GRBL v1.1 Laser Mode wiki, and that quote is
  verbatim: M3 "keeps the laser power as programmed, regardless if the machine is moving,
  accelerating, or stopped". The mechanism is correct; only the quotation is invented.
- **Evidence:** SOURCE (`adr-quotes.mjs`, `find-quote.mjs` over six trees; wiki re-fetched).
- **Severity:** P3.
- **Refuter:** CONFIRMED, amended.
  - **Confirmed:** ADR-257 at `99a2e64b7` (`DECISIONS.md` from L13020) does not contain "burns at
    full programmed S while accelerating".
  - **Amended: the quote is not invented.** It is verbatim in the ADR-257-tagged comment at
    `src/core/devices/gcode-dialects.ts:88-89` on `99a2e64b7`: "// ADR-257: … Under M3 the head
    burns at full programmed S while accelerating out of a corner". M5's search covered the ADRs,
    WORKFLOW, PROJECT and AGENTS, but not `src`.
    - So the kind is "wrong source", the same class as M5-P3-2, not "quote not in source".
    - The sentence "only the quotation is invented" should go.
  - "ADR-257 names this mechanism" is true in substance.
    - Its Context quotes GRBL's M3 lead-in advice, "to give some space for the machine to
      accelerate and decelerate".
    - Its Consequences say "M4 reduces delivered power in acceleration zones".
    - Row 113 should read: Says = Y in meaning, wrong words.
  - **Verdict:** unchanged. Two GRBL sources are verbatim:
    - the re-fetched Laser Mode wiki, L33: "regardless if the machine is moving, accelerating, or
      stopped";
    - gnea `gcode.c:944`: "All spindle state changes are synced, even in laser mode".

    C1-P3-4 also has its own REPRO.
- **Fix direction:** Replace the quote with ADR-257's GRBL sentence, or drop the quotation marks.
  (Refuter: or attribute the words to `gcode-dialects.ts:88-89`.)

### M5-P3-4 — Bad citation (E2-P2-1 refuter): ADR-637 Amendment 1 #1 is misquoted (`$32` becomes `$$`)

- **Corrects:** controller-v4 E2-P2-1 refuter's anchor correction: "The contract break is with
  ADR-637 Amd 1 #1, whose reasoning ('`$$` is a setting of its controller') protects only the
  type."
- **Kind:** Bad citation (altered quote).
- **Where:** `docs/audits/2026-10-22-controller-v4/E2-ctl-machine-setup-flow.md:158-159`.
- **What the source says:** ADR-637 Amendment 1 item 1, inline in
  `ADR-637-machine-setup-leads-with-one-machine-list.md` L108 on `71ff820ce`: "`$32` is a setting of
  the controller, not a measurement of the machine, and ADR-240 #2 already keeps `$$` values from
  establishing identity".
- **Why it matters:**
  - The altered quote widens a sentence about `$32` into one about all `$$` values. That is the very
    point under dispute: whether the rule covers `$130`/`$131`.
  - Even read correctly, the refuter's conclusion holds. Item 1's rule is about the type, and the
    `$$`-identity clause it leans on is ADR-240 #2, which E2-P2-1 already cites.
- **Verdict impact:** none. E2-P2-1 stands on its REPRO (S30 380 × 385 becomes 400 × 410), ADR-420
  rule 8, ADR-240 #2, GRBL's `$130` wording ("maximum travel from end to end", verified) and forum
  t/88769 (verified).
- **Evidence:** SOURCE.
- **Severity:** P3.
- **Refuter:** CONFIRMED.
  - `ADR-637-machine-setup-leads-with-one-machine-list.md` at `71ff820ce`, L108: "`$32` is a
    setting of the controller, not a measurement of the machine, and ADR-240 #2 already keeps `$$`
    values from establishing identity". The refuter's "`$$` is a setting of its controller" is not
    there.
  - The other half of the same anchor correction is verbatim: "leaves the draft as a machine that
    isn't listed" (L87-88).
  - One support M5 lists is weak. E2's own refuter says ADR-420 rule 8 sits in the catalog-pick
    rule, and that the fill follows rule 5.
  - The P2 holds without either ADR sentence. It rests on:
    - both REPROs (380 × 385 becomes 400 × 410, and the row stays chosen);
    - the twin preset note;
    - the GRBL `$130` line, re-fetched (Configuration wiki L267, "maximum travel from end to
      end");
    - forum t/88769, re-fetched ("NOT 400x410! It's 380×385.").
- **Fix direction:** Quote item 1 verbatim, and name ADR-240 #2 for the `$$` part.

### M5-P3-5 — Bad citation, minor (8 places): paraphrases presented as verbatim quotes, or quotes credited to the wrong section

- **Corrects:** in each case the source supports the meaning, but not the quoted words or the
  section.

  | Finding | Quoted as | Source says |
  |---|---|---|
  | 07-P2-2 | ADR-409: "so they drop what the preview dropped" | "so the commit drops the specks the preview dropped" (decision 4) |
  | 07-P2-3 | ADR-454: strokes "burn once down their centre" | title "thin ink burns once down its centre" |
  | 13-P2-1 | ADR-307 Amd 1: "every other command that adds objects in one step" | decision 7 "Every command that adds objects in one step keeps to the same limits" |
  | 17-P3-3 | ADR-585: "disconnect refused during a job or motion" | "`disconnect()`; refused while a job or motion is active" |
  | E4-P2-4 | ADR-630 **Amendment 1**: `$` lines "belong in the Console" | base Decision, Refusals ("They belong in the Console"); Amd 1 does not say it |
  | D3-P2-2 (P3) | LightBurn rotary: Alarm:2 "because rotary travel exceeds the Y axis Max Travel" | "exceeding the Max Travel limit for the Y Axis, as set in your laser's firmware" |
  | 14-P3-4 | LightBurn Settings: DXF "doesn't contain its units, you should select the unit … Otherwise, the DXF may import at the wrong scale" | "Select the appropriate unit of measurement for your DXF if the units are not contained in the file, or the DXF may import at an incorrect scale" (identical in 1.7, 2.0, 2.1, latest) |
  | 22-P3-4 | Cloudflare NEL: browsers "report their own network failures to an external endpoint" | "allows users to report their own failures to an external endpoint" (page dated 2026-05-07) |
- **Kind:** Bad citation (quote fidelity). METHOD §4 SOURCE evidence is "URL and a short quote".
- **Verdict impact:** none. Each paraphrase keeps the source's meaning, and 07-P2-2, 07-P2-3 and
  13-P2-1 are confirmed by REPRO.
- **Evidence:** SOURCE (pages and ADRs re-fetched; matched by `htmltext.mjs` and `find-quote.mjs`).
- **Severity:** P3.
- **Refuter:** CONFIRMED, amended. Seven of the 8 rows stand: 3 as paraphrases and 4 reclassified
  as wrong source. One row is refuted.
  - **Outside pages: paraphrases, as stated (re-fetched).**
    - LightBurn 2.1 RotaryModeGCode: "exceeding the Max Travel limit for the Y Axis, as set in your
      laser's firmware".
    - LightBurn SettingsPreferences, 2.1 and latest: "if the units are not contained in the file, or
      the DXF may import at an incorrect scale".
    - Cloudflare NEL ("Last updated May 7, 2026"): "allows users to report their own failures to an
      external endpoint".
  - **Four ADR rows are not paraphrases.** Each quote is verbatim in an ADR-tagged comment or
    README on the audited tree. `git grep` over the whole tree finds them; M5's ADR-only corpus did
    not.
    - 07-P2-2: `src/ui/trace/trace-decode-cap.ts:26` (ADR-409 is named at `:24`).
    - 07-P2-3: `src/core/trace/trace-presets.ts:109`, and `trace-hybrid.test.ts:1`, which reads
      "(ADR-454): thin pen lines burn once down their centre".
    - 13-P2-1: `src/ui/state/scene-copy-room.ts:8`. 13 itself cites `:1-9` next to the quote.
    - 17-P3-3: `electron/mcp/README.md:61`, in the ADR-585 row.

    These are wrong source, like M5-P3-2. The ADR wording M5 gives for each is right: ADR-409 L86,
    the ADR-454 title, ADR-307 Amd 1 item 7 (L84) and ADR-585 L12.
  - **The E4-P2-4 row is refuted.** E4's words are in the base Refusals text, but citing
    Amendment 1 is defensible:
    - that text credits the policy to Amendment 1: "a policy refusal the maintainer kept
      (Amendment 1)" (ADR-630 L21 at `71ff820ce`);
    - Amendment 1 item 4 says "The `$` command refusal is kept and recorded as policy";
    - the code comment at `normalize-external-program.ts:16-17` reads "belong in the Console
      (ADR-630 Amendment 1)".
  - No verdict changes.
- **Fix direction:** No ledger change needed. Future reports should quote verbatim or drop the
  quotation marks, and cite the amendment that holds the text.

### M5-P3-6 — Method gap (METHOD §4): SOURCE citations are often unpinned or have no URL, and three already fail to re-fetch as cited

- **Corrects:** METHOD §4 practice across the rounds.
- **Kind:** Bad citation (unreproducible).
- **Cases:**
  - D5-P2-2's ground truth is LightBurn "Moves are burned", given with no URL. Its refuter wrote "The
    LightBurn page was not re-fetched (404)". The page exists at
    `docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/MovesAreBurned/` and says what D5
    claims (verified here). A refuter therefore confirmed a P2 without its ground-truth source.
  - 01-P2-5 quotes Cloudflare's Rate Limiting page ("permissive, eventually consistent"). The live
    page was rewritten "Last updated Oct 21, 2026", the day of the audit. The quote now survives only
    in the 2026-10-05 Wayback copy. The substance ("Counts are eventually consistent") is still on
    the live page.
  - Firmware sources cited as "master" or "main" without a SHA: E1's GitHub `blob/master` and
    `blob/main` URLs, D3's `raw…/gnea/grbl/master/…`, C8's grblHAL "master", D4's "bdring/FluidNC
    main", D2's Marlin "2.1.x"/"bugfix". These resolve today because the repos are quiet or the
    lines are stable, but nothing makes them reproducible. Marlin's `probe.cpp` lines already
    differ by 2 between 2.1.2.5 and 2.1.2.8.
  - F2-P2-2 quotes the Vectric pocket form and F2-P1-1 quotes the Fusion Adaptive reference, both
    with no URL. Both were found and verified here.
  - Two citations could not be reached at all (see "Not verified").
- **Verdict impact:** none found. The pages exist and say what was claimed.
- **Severity:** P3.
- **Refuter:** CONFIRMED, amended.
  - **Re-fetched.**
    - The live Cloudflare Rate Limiting page reads "Last updated Oct 21, 2026" and "Counts are
      eventually consistent". "permissive, eventually consistent" survives only in the Wayback copy
      (that page is dated "Last updated Apr 23, 2026").
    - D5 L166 does say "The LightBurn page was not re-fetched (404)". The page is live at
      `/2.0/Troubleshooting/JobQuality/MovesAreBurned/`. It is now titled "Laser Keeps Firing
      During Travel Moves", and its `$32=1` fix is verbatim.
    - E1 L113-114 cite `blob/main`. D3 cites `raw…/gnea/grbl/master/…`.
    - F2 gives no URL for Fusion. The page now sits at a GUID URL, titled "3D Adaptive Roughing
      (previously known as Adaptive Clearing)". That shows why a name alone is not enough.
  - **Overstatement.** D5's refuter did fetch gnea `gcode.c`, one of D5-P2-2's three ground-truth
    anchors. It confirmed without one of its sources, not without "its ground-truth source".
  - **Gap in the fix.** The recommendation is right but incomplete. Seven of the 9 ADR-quote faults
    above come from quoting an ADR-tagged code comment or README as ADR text: M5-P3-2, M5-P3-3, the
    four M5-P3-5 rows, and E4's source. METHOD should also say where an ADR quote comes from.
  - **Refuter's proposed METHOD §4 rule:**
    - Each SOURCE citation gives a fetchable URL pinned to one of:
      - a commit SHA (`blob/<sha>/path#Lx-Ly`);
      - a versioned docs path;
      - for unversioned pages, the live URL plus an archive link and the fetch date.
    - Text in quotation marks is copied verbatim from that exact source.
    - An ADR quote comes from `DECISIONS.md` or `docs/decisions` at the audited SHA and names the
      ADR, amendment and item. A code comment or README that mentions an ADR is cited as
      `file:line`.
    - A refuter that cannot fetch a source marks that anchor UNVERIFIED.
- **Fix direction:** Add to METHOD §4 for SOURCE evidence:
  - a commit SHA for code;
  - a versioned docs URL (`/2.1/`, `V12.0`), never `latest`, for docs;
  - a Wayback snapshot for pages that are not versioned.

  A refuter that cannot re-fetch a ground-truth source should mark the anchor unverified, not
  CONFIRMED.

## Refuted (own candidates, dropped)

- **The D7 telnetd date.** D7 dates telnetd.c @ `e0131fb2` "v2.6, 2026-03-30", but the commit is
  dated 2026-09-17. Dropped: the date is the file's own version header, and it says exactly that.
- **ADR-630 "belong in the Console" (E4).** Kept only as a section nit inside M5-P3-5, because the
  quote exists in ADR-630.
- **The F1 ADR-286 quote.** The scan matched the text to ADR-029. Dropped: F1 cites "ADR-286 §2,
  the 2026-09-13 Convert-to-Bitmap amendment §2", which is ADR-029's amendment, so the attribution
  is explicit.
- **ADR-341 Amd 2 for the C1 ADR-236 quote.** Dropped: C1 itself attributes "with the source's own
  travel style" to ADR-341 Amendment 2.
- **Scan non-matches that are not ADR quotes.** Dropped as matcher false positives: UI copy, code
  comments, METHOD L6, AGENTS.md, README, website copy and check-script output that sit next to an
  ADR mention. Examples are 03 "facts from the exact compiled Job", 05 "restarts there too", 23
  "only while the same project image still owns the id", C5 "never operate hardware" and 24
  "Next free number".

## Verified clean

- **Firmware (50 groups, table rows 1–49 and 123).** All hold:
  - every cited SHA and tag resolves, and each `file:line` holds the cited code;
  - the largest drift is 4 lines (grblHAL `settings.h` `force_set_origin` at L719 for "714-718");
  - the behaviour each finding draws from the code matches it, including the less obvious claims:
    - grblHAL `read_uint` turns `25.0` into 250 at `d7aaee3d`;
    - GRBL fires max PWM on S0 when `$31 ≥ $30`;
    - Marlin wraps S above 255 through `uint8_t cutter_power_t`;
    - FluidNC `spinup_ms` defaults to 0;
    - grblHAL greets every Telnet client and every DTR rise.
- **LightBurn docs (15) and forum (5).** All exist and say what is claimed, apart from the two
  paraphrases in M5-P3-5. The forum quotes match their posters. 03-P2-9's "LightBurn staff" post is
  by the forum's LightBurn account (Oz). D3's "LightBurn staff relay" in t/47652 was not checked.
- **Vendor and CAM sources (17).** Creality, xTool (Zendesk API), the Ortur manual (PDF), Sculpfun,
  Neotronics, Carbide 3D, Vectric (VCarve Desktop/Pro, Inlay, Aspire), Amana, Fusion, Glowforge and
  OpenCAMLib all match, including all six Amana chipload cells that F4's table quotes.
- **Platform and spec sources (11).** Cloudflare (×3), Microsoft, GitHub (×2), Chromium (×2),
  FFmpeg, W3C and WICG all match. The one exception is the NEL paraphrase in M5-P3-5.
- **ADR and WORKFLOW quotes.**
  - The 16 manual ADR/WORKFLOW rows marked clean hold (rows 98–109, 111, 120–122). They include
    the anchors of F3-P1-1, F6-P1-1, 09-P1-1, C4-P2-1, C3-P2-1/P2-2, D7-P2-1 and D2-P3-3.
  - The scripted scan matched 242 of 319 quotes verbatim and 6 more inside the same ADR's inline
    amendment.
- **Overlap with M4.** M4 spot-checked gnea `gcode.c` L251, FluidNC v4.0.3 `SpindleDatatypes.h`
  and `GCode.cpp`, and grblHAL `gcode.c` L1670-1690 and L5023-5026. That overlaps rows 36, 37 and
  123 here, and the two checks agree.

## Not verified

- **Unreachable (2):**
  - 26-K-1's "Carbide3D forum thread quotes Fusion-posted `G19 G3 Y5.76 Z-6.829 J-8.765 K-29.517`".
    The report gives no URL, and a search found no page with that line. It supports reach only;
    K-1's ground truth (gnea `gcode.c` G18/G19, row 17) is verified.
  - C3's dropped candidate cites "Chromium CL 2716063002". `codereview.chromium.org` no longer
    answers (TLS failure), and the Wayback API returned 429. It supports a refuted candidate, not a
    finding.
- **Not sampled.** These citations were not checked:
  - the WHATWG image-data steps (12);
  - Selinger 2003 and the Potrace defaults (07);
  - Wikipedia Code 128 (25);
  - W3C Filter Effects and GIMP's feather σ (23);
  - LinuxCNC G10/G38 tables (C2);
  - the smoothieware zprobe page (D2);
  - ortur.net support pages (C7, Shopify 429 earlier);
  - the Onsrud and Whiteside charts (F4 itself did not fetch them);
  - the GRBL interface wiki (C2).
- **Handed to M6 (contradiction, not a citation fault).** ADR-497 D3 says hatch spacing runs
  "widest" first. The LightBurn Material Test page that E5 cites says "lowest Interval" runs first.
  E5 quotes both without noting the conflict.
- **Not re-fetched.** `origin/main` was not re-fetched, so any ADR edits after `87ecb4f24` are not
  checked.

```json
[
  {"id":"M5-P3-1","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-21-rolling-v2/23-image-editor.md","line":152,"anchor":"DECISIONS.md@70c01e11f L19379 (ADR-311 decision 2) vs ADR-313 decision 2 (SVG units)","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED: quote at DECISIONS.md@70c01e11f L19378-19379 under ADR-311 (L19323) d2; ADR-313 d2 is SVG units/compatibility; fix landed as ADR-311 Amd 2; WORKFLOW F-L1 step 4 and ImageEditorTopBar.tsx:145 re-read, verdict unchanged","known":false,"corrects":"23-P2-3","kind":"Bad citation","summary":"'same-document reopen remains resumable' is ADR-311 s2, not ADR-313 s2; 23-P2-3 still stands on WORKFLOW F-L1 step 4, the Close title copy and the refuter REPRO"},
  {"id":"M5-P3-2","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-21-rolling-v2/14-vector-importers.md","line":113,"anchor":"ADR-358 Amd 2 item 4 @70c01e11f vs src/io/svg/svg-clip-presentation.ts:4","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED: phrase only in svg-clip-presentation.ts:4 on 70c01e11f and 87ecb4f24, not in any ADR-358 file; that comment cites ADR-358 Amd 2, so an ADR-tagged comment was quoted as ADR text; item 4 CSS refusal verified, verdict unchanged","known":false,"corrects":"14-P3-1","kind":"Bad citation","summary":"'clip geometry decides what is cut' is a code comment, not ADR-358 Amd 2 text; the CSS-clip refusal itself is in item 4, verdict unchanged"},
  {"id":"M5-P3-3","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-22-controller-v2/C1-ctl-native-resume.md","line":288,"anchor":"ADR-257 (DECISIONS.md@99a2e64b7); GRBL v1.1 Laser Mode wiki","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED, amended: not in ADR-257, but not invented: verbatim in the ADR-257-tagged comment src/core/devices/gcode-dialects.ts:88-89 @99a2e64b7 (wrong source, as M5-P3-2); ADR-257 carries the mechanism in meaning (GRBL lead-in quote; 'M4 reduces delivered power in acceleration zones'); GRBL wiki L33 and gnea gcode.c:944 re-fetched verbatim, verdict unchanged","known":false,"corrects":"C1-P3-4","kind":"Bad citation","summary":"ADR-257 does not contain 'burns at full programmed S while accelerating'; the mechanism is supported by the verbatim GRBL wiki quote C1 also gives"},
  {"id":"M5-P3-4","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-22-controller-v4/E2-ctl-machine-setup-flow.md","line":158,"anchor":"ADR-637 Amendment 1 item 1 (ADR-637 file L108 @71ff820ce)","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED: L108 reads '$32 is a setting of the controller'; L87-88 consequence quoted verbatim; ADR-420 rule 8 is weak support (E2 refuter: catalog-pick rule) but the P2 holds on both REPROs, the twin preset note, GRBL wiki $130 (re-fetched L267) and forum t/88769 (re-fetched)","known":false,"corrects":"E2-P2-1 (refuter anchor correction)","kind":"Bad citation","summary":"Refuter quotes ADR-637 Amd 1 #1 as '$$ is a setting of its controller'; the ADR says '$32 is a setting of the controller' and leaves $$ identity to ADR-240 #2; E2-P2-1 stands on REPRO, ADR-420 rule 8, ADR-240 #2, GRBL wiki and forum t/88769"},
  {"id":"M5-P3-5","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-21-rolling-v2/07-trace.md","line":90,"anchor":"ADR-409 d4, ADR-454 title, ADR-307 Amd 1 d7, ADR-585, ADR-630 base Refusals, LightBurn 2.1 RotaryModeGCode, LightBurn SettingsPreferences (1.7/2.0/2.1/latest), Cloudflare NEL","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED, amended: 7 of 8 rows stand. LightBurn rotary, LightBurn DXF (2.1, latest) and Cloudflare NEL are paraphrases (re-fetched). 07-P2-2, 07-P2-3, 13-P2-1, 17-P3-3 are verbatim ADR-tagged comments/README (trace-decode-cap.ts:26, trace-presets.ts:109, scene-copy-room.ts:8, electron/mcp/README.md:61), i.e. wrong source not paraphrase. E4-P2-4 row refuted: ADR-630 L21 credits the policy to Amendment 1, Amd 1 item 4 keeps the $ refusal, and normalize-external-program.ts:16-17 says '(ADR-630 Amendment 1)'","known":false,"corrects":"07-P2-2, 07-P2-3, 13-P2-1, 17-P3-3, E4-P2-4, D3-P2-2, 14-P3-4, 22-P3-4","kind":"Bad citation","summary":"Eight quotations are paraphrases or credited to the wrong ADR section; each source supports the meaning, no verdict changes"},
  {"id":"M5-P3-6","severity":"P3","area":"meta-citations","file":"docs/audits/2026-10-21-rolling-v2/METHOD.md","line":60,"anchor":"METHOD s4 SOURCE = URL + short quote; D5-P2-2 refuter 404; Cloudflare rate-limit page reworded 2026-10-21; unpinned master/main/latest refs","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED, amended: Cloudflare page re-fetched (Last updated Oct 21, 2026; quote only in Wayback); D5 L166 404 note and live MovesAreBurned page verified; E1/D3 unpinned refs verified; Fusion page now '3D Adaptive Roughing' at a GUID URL. Overstated: D5's refuter did fetch gnea gcode.c, one of three ground-truth anchors. Incomplete: 7 of 9 ADR-quote faults are ADR-tagged comments/README quoted as ADR text, so METHOD should also say ADR quotes come from DECISIONS.md/docs/decisions at the audited SHA","known":false,"corrects":"METHOD s4 practice (D5-P2-2, 01-P2-5, E1, D3, C8, D4, D2, F2)","kind":"Bad citation","summary":"SOURCE evidence is often unpinned or URL-less; D5-P2-2 was confirmed although its refuter could not fetch the LightBurn ground-truth page (it exists at /2.0/Troubleshooting/JobQuality/MovesAreBurned/); propose SHA / versioned-docs / Wayback pinning"}
]
```
