# Controller audit v2 — C7 Device profiles (`ctl-device-profiles`)

- **When:** 2026-10-22 10:05–10:45   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD
  `e6a3fd4ce`; `git diff 99a2e64b7 HEAD -- src` is empty; `git fetch` at 10:40 showed origin/main
  unchanged)
- **Scope:** `src/core/devices/**` (catalog, `device-profile.ts`, `falcon-profiles.ts`,
  `brand-laser-profiles.ts`, `laser-modules.ts`, `preset-corrections.ts`, `preset-air-assist.ts`,
  `preset-command-set.ts`, `profile-suggestions.ts`, `profile-application.ts`), the Machine stage
  picker (`src/ui/laser/device-setup/machine-picker-entries.ts`, `DeviceSetupMachinePicker.tsx`,
  `DeviceSetupMachineDetails.tsx`), `src/core/cnc/cnc-machine-catalog.ts` (spot check), and
  `src/io/machine-profile/**` with its UI (`MachineSetupImportExport.tsx`).
  Governing: ADR-637 (+ Amd 1), ADR-322 (+ Amd 1, Amd 2), ADR-347, ADR-370, ADR-503, ADR-567,
  ADR-615, PROJECT.md "Users and roles", AGENTS.md ("Never invent controller settings").
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes. L5 folded into L4 (the only untrusted
  input in scope is an imported `.lfmachine.json`; `.lbdev` import is KNOWN area 21). L6 skipped:
  profiles hold data, not failure paths.
- **Primary sources fetched this session** (saved to the session scratchpad, read by field):
  - Creality LightBurn bundle `falcon_a1_pro_(lightburn_2.0.00+).lbzip`, SHA-256
    `11b13328…988405b` (identical to the hash recorded in
    `docs/audits/2026-09-19-machine-compatibility-fixes/falcon-vendor-configuration.json`).
  - xTool `xTool-D1ProV3.lbdev` from the attachment URL the code cites and from the URL xTool's
    support article 509 links today; both SHA-256 `d03e3021…8fad73f4`.
  - xTool Help Center articles 14109952045463 (D1 Pro Product Introduction) and 17020224257559
    (Differences between D1 and D1 Pro) through the public Zendesk API (the HTML page returns 403).
  - Ortur `OLM3 User Manual - English.PDF` from Ortur's own repository
    `github.com/Ortur-Tech/Ortur_Laser_Master_3` (2022, V1.1).
  - grblHAL core `settings.h` @ `d7aaee3d`.
  - creality.com product pages for the Falcon A1 Pro 20W and Falcon A1.
  - sculpfun.com S30 product page and blog pages "Setting Up The Software", "Sculpfun S30 Series"
    (fetched once the Shopify rate limit cleared).
  - neotronics.co.za 4040 Max product page.
  - Several Shopify vendor pages (ortur.net, uk.xtool.com, xtool.eu, lasertree.com) answered 429 or
    404 all session; where a value rests only on a search-index snippet of the vendor's page, the
    table says so.
- **Counts:** 7 raised → 0 refuted (7 CONFIRMED) → P1 0 / P2 2 / P3 5 (+ 3 KNOWN re-observed).
  Refuter severity change: P2-1 lowered to P3 (its id is kept for the ledger).

## Headline

The values that decide a first job are right for the four researched brands: origin corner,
`$30` scale, M4 dynamic power, air command, Auto-focus and baud all match the vendor's own
LightBurn device file or manual, no preset turns homing on, and at Start a GRBL-family
controller's own `$30` overrides the profile's S max (ADR-567). The defects sit beside the
catalog rather than in it:

- **Saved copies made before the 2026-09-19 model split keep a work area larger than the machine.**
  The Falcon A1 Pro preset was 400 × 400 mm from 2026-07-07 until 2026-09-19 (the machine is
  358 × 268 mm); the single Ortur LM3 and xTool D1 Pro presets covered heads whose travel is now
  known to be smaller. None of these is in `preset-corrections.ts`, so no correction is offered,
  and the Falcon copy is named only for its missing command set. (Refuter: P3. The Falcon copy is
  already told to re-apply its preset, which restores the bed. The copies come only from
  2026-07-07 to 2026-09-19 preview and web builds.)
- **The Ortur Laser Master 3 presets declare stock GRBL, but the LM3 runs Ortur's grblHAL-based
  firmware.** With an LM3 connected, the picker marks the three Ortur rows "Other firmware" and the
  Falcon A1 Pro row "Same firmware". The refuter found a bigger effect: the stock GRBL driver
  never clears grblHAL's latched line error. After one refused line, the LM3 refuses the
  following G-code lines with a stale error.
- **The 400 × 400 mm "Falcon-compatible" fallback is listed as a Creality machine** with no Falcon
  A1 row beside it. A Falcon A1 is 381 × 305 mm, so an A1 owner who picks it gets a bounds check
  that accepts work up to 95 mm past the travel. The note that says the size identifies no model
  is in the profile's evidence, which Machine Setup never shows.

## Profile → value → source

Values are as shipped on `99a2e64b7` (printed from `GRBL_MACHINE_PROFILE_CATALOG` by a focused
test). "Inh." = inherited from `DEFAULT_DEVICE_PROFILE`. All brand presets use dialect
`grbl-dynamic` (M4 dynamic for cut, fill and raster), `laserModeEnabled: true`, homing disabled,
`S 0–1000`, `maxFeed` 6000 mm/min and `accelMmPerSec2` 500 unless stated.

| Profile | Value | Vendor value | Source | Verdict |
|---|---|---|---|---|
| Falcon A1 Pro (`creality-falcon-a1-pro-grblhal`) | 358 × 268 mm | Width 358, Height 268 | Creality LightBurn bundle (above); https://www.creality.com/products/falcon-a1-pro-20w ("268*358mm") | match |
| | origin front-left (inh.) | `MirrorX: false`, `MirrorY: false` | Creality bundle | match |
| | S max 1000 | `S_Scale: 1000` | Creality bundle | match |
| | baud 115200 | `BaudRate: 115200` | Creality bundle | match |
| | air `M8` | `AirAssistM7: false` (M8) | Creality bundle | match |
| | Auto-focus `$HZ1` | macro "Aotu Focus" `$HZ1` | Creality bundle | match |
| | Home `$HX` then `$HY`, no `$J`, no `$$` (command set) | macro `$HX\n$HY`, `EnableGrblJCommand: false`, `AllowSettingsFetch: false` | Creality bundle | match |
| | firmware `grblhal` + vendor command set | device `Name: "GRBL-LPC"` | Creality bundle | disclosed in evidence (ADR-322 §4); not re-raised |
| | maxFeed 36000 mm/min | "600mm/s" | creality.com A1 Pro page | match |
| | homing off | `HomeOnStartup: false` | Creality bundle | consistent |
| Falcon-compatible (`creality-falcon-a1-pro-compatible`) | 400 × 400 mm, `grbl-v1.1`, maxFeed 10000, air none | no Creality machine is 400 × 400; Falcon A1 "305 mm × 381 mm" | https://www.creality.com/products/creality-falcon-a1-laser-engraver | **no source; see P2-3** |
| xTool D1 Pro 5 W / 10 W / 20 W / 40 W | 430 × 400 / 430 × 400 / 430 × 390 / 430 × 348 mm | table: 430 * 400 (5 W, 10 W), 430 * 390 (20 W); lbdev `Width 430`, `Height 400` | xTool article 14109952045463; lbdev | match (5–20 W). 40 W 430 × 348: matches xTool's comparison table per search index only; the cited `uk.xtool.com/products/40w-laser-module-for-d1-pro` now returns 404 (P3-1). Refuter: per the search index, an xTool UK 40 W page gives 430 × 390, so xTool's own pages disagree on the 40 W depth |
| | origin rear-left | `MirrorY: true` | lbdev | match |
| | baud 230400 | `BaudRate: 230400` | lbdev | match |
| | S max 1000 (inh.) | `S_Scale: 1000` | lbdev | match |
| | air none | `AirAssistM7: false` (M8 if enabled) | lbdev | conservative (no command sent) |
| | `$J=` jog/Frame | `EnableGrblJCommand: false` | lbdev | KNOWN (controller audit OR-4), disclosed in evidence |
| | maxFeed 6000 (inh.) | "maximum processing speed for D1 Pro is 400mm/s" | xTool article 17020224257559 | **below vendor, unsourced; P3-3** |
| | scanningOffsets empty | lbdev ships `ReverseIntervals` 0.06–0.10 mm at 50–400 mm/s | lbdev | design choice (operator calibrates); not raised |
| Ortur LM3 LU2-10A / LU3-20A / LU3-40A | 400 × 400 / 400 × 380 / 400 × 380 mm | manual: "X Axis Length" and "Y Axis Length" 400 mm (LU2-10A); LU3-20A 400*380 | Ortur manual p. 25; ortur.net support page (search index only, 429; refuter fetched it directly on 2026-10-22: LU3-20A and LU3-40A "400*380 mm") | match |
| | origin front-left (inh.) | 'Select the origin "Front Left", turn off auto-homing' | Ortur manual p. 25 | match |
| | S max 1000 (inh.) | "S-MAX 1000" | Ortur manual p. 20 | match |
| | M4 | 'Select "M4-Dynamic Power"' | Ortur manual p. 20 | match |
| | firmware `grbl-v1.1` | manual: `$74=WiFi name`, `$75=WiFi password` (grblHAL settings 74/75); firmware reports `[FIRMWARE:grblHAL]` | Ortur manual p. 12; grblHAL `settings.h` L130-131; https://forum.lightburnsoftware.com/t/ortur-lm3-not-connecting-with-either-wifi-or-usb/76960 | **mismatch; see P2-2** |
| | maxFeed 6000 (inh.) | "Engraving Speed … 20000mm/min" | Ortur manual p. 20 | below vendor; disclosed in the evidence note (P3-3) |
| Sculpfun S30 (M8) / S30 manual air | 380 × 385 mm | "the standard version is 380*385mm" | sculpfun.com S30 product page | match (the Sculpfun S30 Series blog still says 410×400; the preset takes the smaller value) |
| | air `M8` / none | "mainboard-controlled air pump", "Lightburn M8 Air Assist Switch" | sculpfun.com S30 product page | match |
| | origin front-left (inh.) | "Usually, front left is correct." | sculpfun.com "Setting Up The Software" | match |
| | S max 1000 (inh.) | "The S-Value must be set to 1000" | same blog | match |
| | homing off | "usually, the homing function is not enabled in the firmware" | same blog | value matches; the evidence note says the opposite (P3-2) |
| | baud (driver default 115200) | not published | — | not verified |
| Neotronics 4040 Max / LT-4LDS-V2 | 400 × 400, Z 75 | "Working Area : 400x400x75mm" | https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct | match |
| | spindle 12000 RPM (500 W) | "By Default we provide the 500w spindle motor" | same | match (RPM from the spindle page, not re-fetched) |
| | S max 1000, origin front-left, firmware `grbl-v1.1` | not published ("offline controller") | same | no vendor source; evidence says to confirm |
| Generic grblHAL / FluidNC / Marlin / Smoothieware / Ruida | firmware starters, not in the picker (ADR-637 rule 2) | — | — | out of the vendor question |

## Findings

### P2-1 (refuter: lowered to P3) — Saved copies of the pre-2026-09-19 Falcon A1 Pro, Ortur LM3 and xTool D1 Pro presets keep a work area larger than the machine, and no correction names it

- **Where:**
  - `src/core/devices/preset-corrections.ts:27-44` — `PRESET_CORRECTIONS` lists only the xTool
    origin and the S30 bed.
  - `src/ui/laser/controller-identity-warnings.ts:130-143` — the only advisory a stale Falcon copy
    gets names the command set and its Frame/jog consequences, not the bed.
  - `src/ui/laser/device-setup/machine-picker-entries.ts:175-183` — `profilePresetIsActive` marks an
    old Ortur or xTool copy as the current preset row by `profileId` alone.
  - History: `git show f16e0fead^:src/core/devices/falcon-profiles.ts` (A1 Pro preset spreads the
    400 × 400 default, shipped 2026-07-07 `9701f701e` to 2026-09-19);
    `git show f16e0fead^:src/core/devices/profile-catalog.ts` (one `ortur-laser-master-3` at
    400 × 400 for every LM3 head; one `xtool-d1-pro` at 430 × 390 for every D1 Pro head).
- **Anchor:** Contract — ADR-322 Amendment 1 §1: `preset-corrections.ts` "records each correction to a
  preset whose failure is silent"; Amendment 2 §3: "A change that fails silently on saved copies
  also belongs in `preset-corrections.ts`." Ground truth — Creality bundle Width 358 / Height 268;
  Ortur LU3-20A 400 × 380; xTool 40 W 430 × 348.
- **Scenario:**
  - A Falcon A1 Pro profile saved before 2026-09-19 still has 400 × 400 mm. A job placed at Y 300 mm
    passes KerfDesk's bounds check although the machine has 268 mm of Y. Job Review says only that
    the copy lacks the vendor command set (Frame M9, `$J=`); nothing says its bed is 42 mm too wide
    and 132 mm too deep. Re-applying the preset fixes it, but the operator is not told the bed is
    one of the reasons.
  - An LM3 with an LU3-20A head saved as the old "Ortur Laser Master 3" keeps 400 × 400 (machine
    400 × 380). The picker shows its row as the chosen **Laser Master 3 (LU2-10A, 10 W)** preset,
    and nothing offers the LU3 variant.
  - A D1 Pro with the 40 W head saved as the old "xTool D1 Pro" keeps 430 × 390 (machine 430 × 348).
    Its only correction offer is `{ origin: 'rear-left' }`; the bed stays 42 mm too deep.
  - In each case the bounds check accepts work past the real travel; the mandatory Frame is then
    the first thing that shows the operator, by running the head into the end of the axis.
- **Evidence:** REPRO — focused Vitest `src/core/devices/zz-c7-profiles.test.ts` (deleted after the
  run) built the three pre-split shapes from the `f16e0fead^` sources:
  `stalePresetCorrections(oldFalcon)` → `[]`; `presetCommandSetUpdate(oldFalcon)` →
  `{"presetName":"Creality Falcon A1 Pro (vendor command set)","commandSet":"creality-falcon-a1-pro"}`;
  `presetAirAssistUpdate(oldFalcon)` → `{…"patch":{"airAssistCommand":"M8","airAssistRestartUnreliable":true}}`
  (air only); `stalePresetCorrections(oldOrtur)` → `[]`; `stalePresetCorrections(oldXtool)` →
  one entry, `"patch":{"origin":"rear-left"}`. SOURCE — vendor values in the table above.
- **Refuter:** CONFIRMED, but narrower than raised. Severity lowered from P2 to P3.
  - **The old shapes shipped.** `git show f16e0fead^` confirms all three: the A1 Pro spread
    the 400 × 400 default, one `ortur-laser-master-3` was 400 × 400, and one `xtool-d1-pro`
    was 430 × 390. Commit `9701f701e` is in the GitHub pre-releases v0.2.0-preview.9, .10 and
    .13 (2026-07-23), and main deployed to Cloudflare Pages until the split. v1.0.0
    (2026-09-30) already has the split.
  - **REPRO.** A focused Vitest, `src/ui/laser/device-setup/zz-c7r-profiles.test.ts` (deleted
    after the run), gave:
    - `stalePresetCorrections`: `[]` for the old Falcon and the old Ortur; an origin-only
      patch for the old xTool.
    - The old Falcon's Job Review advisory never mentions the bed: `/bed|work area|358|268/`
      matches nothing.
    - The picker selects **Ortur Laser Master 3 (LU2-10A, 10 W)** for the old Ortur copy and
      **xTool D1 Pro (20 W)** for the old xTool copy. It leaves the old Falcon copy unselected.
  - **No other path fixes the bed.**
    - `normalizeDevice` (`deserialize-project.ts:299`) never touches the bed, and nothing
      migrates by `catalogVersion`.
    - Job Review's `Travel $130 × $131` row (`job-review-live-rows.ts:425`) only warns. It
      appears only when `$$` was read and differs, and it does not check the job's bounds.
    - Frame does not compare the job with the controller's travel.
  - **Why narrower than raised.**
    - The Falcon copy is not silent. Every Job Review tells the operator to "Re-apply … preset in
      Machine Setup". Its picker row says to choose it again, which replaces the draft and
      restores 358 × 268. Only the bed is not named.
    - The old Ortur and xTool shapes equal the current LU2-10A and 20 W presets. Only owners of
      the other heads are affected, and the chosen row already names its head.
    - Ortur LU3 400 × 380 is confirmed directly (ortur.net/pages/support-olm3, fetched
      2026-10-22).
    - The xTool 40 W leg is not established. Per the search index, xTool's global pages say
      430 × 348 and an xTool UK page says 430 × 390. The cited UK URL is 404.
  - **Consequence.** Start needs a completed Frame (ADR-322 item 7), and Frame runs with the
    laser off. An overrun therefore shows at Frame: either a soft-limit `error:15`, or the head
    stalls at the end of the axis and loses position. It does not burn a part.
  - **Population.** Only copies saved from preview or web builds between 2026-07-07 and
    2026-09-19.
- **Fix direction:** Record these bed corrections in `preset-corrections.ts`. A pre-split copy is
  recognisable by its old `name` or by having no `laserSubProfile` (every current brand preset has
  one). For the Falcon, name the bed in the stale-command-set advisory too.

### P2-2 — The Ortur Laser Master 3 presets declare stock GRBL; the LM3 runs Ortur's grblHAL-based firmware, so the picker marks the owner's own rows "Other firmware"

- **Where:** `src/core/devices/brand-laser-profiles.ts:42` (`controllerKind: 'grbl-v1.1'` in
  `diodeProfile`, used by `orturProfile` at :152-167); `src/core/devices/profile-suggestions.ts:41-50`;
  `src/ui/laser/device-setup/DeviceSetupMachinePicker.tsx:218-227` (`FirmwareTag`);
  `src/core/controllers/console-setting-writes.ts:38-40`.
- **Anchor:** Ground truth — Ortur's own LM3 manual tells users to send `$74=WiFi name` and
  `$75=WiFi password`, which are grblHAL settings (`Setting_WiFi_STA_SSID = 74`,
  `Setting_WiFi_STA_Password = 75`, grblHAL `settings.h` @ `d7aaee3d` L130-131) and do not exist in
  stock GRBL 1.1. An LM3's startup reply posted to the LightBurn forum reads `GrblHAL 1.1f`,
  `[FIRMWARE:grblHAL]`, `[DRIVER:ESP32-S2]`, `[BOARD:Ortur Laser Master 3]`. Twin — ADR-637 rule 7's
  firmware hint against the firmware the machine reports.
- **Scenario:** An LM3 owner clicks **Connect** on the Machine stage. `detect-controller.ts` reads
  `GrblHAL 1.1f` as `grblhal`. `suggestMachineProfiles` then gives all three Ortur rows
  `manual-only` and "Profile controller is grbl-v1.1, but detected grblhal.", so they show
  **Other firmware**, while the Creality Falcon A1 Pro row shows **Same firmware**. After the Ortur
  preset is chosen, every connect shows "The firmware banner differs from this setup". If the
  operator keeps the preset, the Console checks `$N=` writes with stock-GRBL rules: `$22=5`, a valid
  grblHAL homing bitfield, is refused with "$22 is an on/off setting: enter 0 or 1. GRBL would store
  5 as 1."
- **Evidence:** REPRO — the same focused test called `suggestMachineProfiles({ detectedControllerKind: 'grblhal', … })`:
  `creality-falcon-a1-pro-grblhal possible []`, and each of `ortur-laser-master-3`,
  `ortur-laser-master-3-20w` and `ortur-laser-master-3-40w` returned
  `manual-only ["Profile controller is grbl-v1.1, but detected grblhal."]`. READ —
  `FirmwareTag` maps `possible` to "Same firmware" and any warning to "Other firmware".
  SOURCE — Ortur manual p. 12 (`$75=WiFi password`); grblHAL `settings.h`; forum `$I` capture.
- **Refuter:** CONFIRMED, and stronger than raised. P2 stands.
  - **Ground truth: three independent lines.**
    - Ortur's manual V1.1 (Ortur's own repository, SHA-256 `5c793d73…`). It sends "$74=WiFi name"
      and "$75=WiFi password", and the port diagram shows a WiFi aerial and a TF card.
    - Two LightBurn forum `$I` captures from different owners:
      - 2022-09-21, OLF 205_RC16 (the auditor's thread).
      - 2024-04-20, an LU3-20A (https://forum.lightburnsoftware.com/t/lu3-20a-firmware/136461):
        `GrblHAL 1.1f`, `[FIRMWARE:grblHAL]`, `[OLF:211]`, `[OLH:OLM_ESP_PRO_V2.4B]`,
        `[DRIVER:ESP32-S2]`.
    - ortur.net/pages/support-olm3 lists "OLF-V2.0 Firmware" and the mainboard
      "OLM-ESP-PRO-V2.4". It names no STM32 or OLF 1.x board, and no LM3 capture shows one.
  - **Runtime: the profile chooses the driver, not the banner.** Connect binds the driver from
    the profile (`connect-options.ts:19-29`, `laser-connect-action.ts:72,140`), and the banner
    never switches it (`controller-identity-warnings.ts:58-60`).
  - **REPRO** (the same deleted test):
    - `detectControllerFromBanner("GrblHAL 1.1f …", 'grbl-v1.1')` returns `grblhal`.
    - The suggestions match the auditor's.
    - `$22=5` on the GRBL v1.1 driver is refused: "$22 is an on/off setting: enter 0 or 1. GRBL
      would store 5 as 1." On the grblHAL driver it returns `null`.
    - Every Job Review shows "Controller identity mismatch: … the firmware banner identifies
      grblHAL".
  - **Not cosmetic: a consequence the auditor missed.**
    - The GRBL v1.1 driver does not set `stickyLineError`; only the grblHAL driver does
      (`grblhal/driver.ts:79`). So `noteRefusedLine` (`laser-parser-rearm.ts`) never sends
      the empty line that clears a latched error.
    - Ortur's own grblHAL source (`Ortur_Laser_Firmware_17X-18X`, `main/grbl/protocol.c`, the
      `COMPATIBILITY_LEVEL == 0` branch at L258-264) keeps `gc_state.last_error`. It refuses
      every later G-code line with that error until an empty line or a `$` line. The LM3's
      `GrblHAL` banner means its build runs at level 0. That older public build sets level 1, but
      its latch code is the same.
    - So with an Ortur preset, one refused line, such as a Console typo or a `$J=` past soft
      limits, makes the next G-code actions fail with a stale error code. That includes the
      jog release `G4 P0.01`, Frame's `M5` and Set origin. This is the controller audit's HF-7
      failure, which the grblHAL driver already fixes.
    - Evidence: READ and SOURCE only. No hardware was run.
- **Fix direction:** Declare the LM3 presets `grblhal`, as the Falcon A1 Pro preset is, keeping
  S1000 and the starter receive window. The evidence note can then say the firmware is Ortur OLF 2.x.

### P2-3 — The unsourced 400 × 400 "Falcon-compatible" fallback is listed as a Creality machine; a Falcon A1 owner who picks it gets a work area 19 × 95 mm larger than the machine

- **Where:** `src/core/devices/falcon-profiles.ts:74-103`; listed by
  `src/ui/laser/device-setup/machine-picker-entries.ts:55-64` (only `vendor === 'Generic'` is kept
  out); the evidence that discloses the size is never rendered (`DeviceSetupMachineDetails.tsx:78-105`
  shows `reviewNotes` only; see P3-1).
- **Anchor:** Contract — ADR-322 §5 ("Named laser presets declare … head-specific travel"); AGENTS.md
  "Never invent controller settings". Ground truth — Creality lists the Falcon A1 at
  "305 mm × 381 mm" (https://www.creality.com/products/creality-falcon-a1-laser-engraver) and the A1
  Pro at 268 × 358 mm; the original Falcon and Falcon2 are 400 × 415 mm (comment at
  `device-profile.ts:234-235`). No Creality machine is 400 × 400 mm.
- **Scenario:** A Falcon A1 (10 W) owner searches "falcon". The Creality group has two rows:
  **Falcon A1 Pro (vendor command set)** (358 × 268 mm · 20 W) and **Falcon-compatible GRBL diode**
  (400 × 400 mm). Not owning the Pro, they choose the second. Its Profile details say only "Broad
  Falcon-compatible GRBL fallback. Choose the A1 Pro profile only for that model…". The bounds check
  now accepts artwork up to 400 mm on both axes; on a 381 × 305 mm machine, Frame runs into the end
  of the axis. The profile's id (`creality-falcon-a1-pro-compatible`) and its `maxFeed: 10000` have
  no vendor source either.
- **Evidence:** READ (picker inclusion, Profile details content) + SOURCE (Creality A1 page). The
  2026-09-21 coordinates audit (`docs/audits/2026-09-21-coordinates-origin/machine-settings.md:54`)
  accepted this fallback because its evidence note says the size identifies no model. Since
  ADR-637 (2026-10-19) the fallback is a row in the main list, and that evidence note is not
  shown there.
- **Refuter:** CONFIRMED. P2 stands.
  - **SOURCE.** creality.com/products/creality-falcon-a1-laser-engraver, fetched 2026-10-22, lists
    "Engraving Area 305 mm × 381 mm". The catalog has no A1 row.
  - **REPRO** (the same deleted test):
    - The picker lists the fallback under **Creality** as "Falcon-compatible GRBL diode",
      400 × 400 mm.
    - Its badge reads **Simulator tested**: `profileConfidenceLabel` maps the evidence status
      `simulator-tested` to that text. This sounds stronger than the A1 Pro row's
      "Public-spec starter".
    - Its Profile details show only "Broad Falcon-compatible GRBL fallback…". That note never
      says 400 × 400 is not a Falcon size.
  - **The note was never shown.** `evidence[].note` is rendered by no Machine Setup screen, and
    none rendered it before ADR-637 either: `git grep` at `30b3d10e6^1` finds only the export.
    The 2026-09-21 audit's acceptance therefore rested on a note no screen showed.
  - **Nothing else catches the overrun.**
    - Preflight's `out-of-bed` uses the profile bed (`machineBoundsForDevice`), so work up to
      400 mm passes.
    - Job Review's `Travel $130 × $131` row warns, without blocking, only if the A1 answers
      `$$`, which is not established.
    - The first physical check is the mandatory Frame, which runs with the laser off.
- **Fix direction:** Remove the fallback from the brand list, as ADR-637 rule 2 does for the other
  firmware starters, or give it a sourced work area. Add an A1 preset only from Creality's own A1
  device file.

### P3-1 — Built-in profiles' evidence notes (vendor caveats and source URLs) are never shown in Machine Setup; one cited source is now 404

- **Where:** `src/ui/laser/device-setup/DeviceSetupMachineDetails.tsx:78-105` renders
  `profileConfidenceLabel` plus `reasons` and `entry.reviewNotes`. `profile.evidence[].note` is read
  only by `MachineSetupImportExport.tsx:192` (export) and by no screen.
- **Anchor:** Contract — ADR-637 rule 3 ("the evidence label … and **Profile details**"); ADR-347 §4
  ("opening the evidence never selects the machine"). Ground truth — the xTool 40 W evidence cites
  `https://uk.xtool.com/products/40w-laser-module-for-d1-pro`, which returned HTTP 404 on
  2026-10-22, as did `https://www.xtool.com/products/40w-laser-module-for-d1-pro`, the URL in the
  2026-09-19 correction record.
- **Scenario:** The operator never sees the caveats written for them, for example: the xTool note
  ("if Jog or Frame fails with an error … not compatible with $J= jogging"); the Falcon-compatible
  note ("does not identify a Falcon model"); the Neotronics note ("Confirm GRBL build, … S scale,
  homing"); the Ortur note ("feed ceiling is a conservative starter"). No source link is shown
  either, while CNC presets show theirs (`CncPresetNotes`).
- **Evidence:** READ; SOURCE (404 via WebFetch and curl).
- **Refuter:** CONFIRMED.
  - A grep of `src/ui` finds `evidence` notes read only by the export
    (`MachineSetupImportExport.tsx:192`).
  - One small correction: the import review card does list a file's `reviewNotes`, so
    re-importing an export shows them. Machine Setup still never does.
  - The cited `uk.xtool.com/products/40w-laser-module-for-d1-pro` returned 404 to curl on
    2026-10-22.
- **Fix direction:** Render `evidence[].note` (with its URLs as links) under Profile details, as the
  CNC preset notes already do; refresh the 40 W source.

### P3-2 — The Sculpfun S30 evidence note claims the firmware ships with homing and hard limits on and that M9 only lowers the air; Sculpfun says homing is usually off, and the M9 claim has no source. The manual-air variant's head says "stock automatic air"

- **Where:** `src/core/devices/brand-laser-profiles.ts:119` (note), `:110-113` (comment: `$130=400`,
  `$131=410`, soft limits off), `:134-142` (`SCULPFUN_S30_MANUAL_AIR_PROFILE` spreads the base
  `laserSubProfile`, so `model` stays `'S30 (5 W, stock automatic air)'` while `airAssist: 'manual'`).
- **Anchor:** Ground truth — Sculpfun, "Setting Up The Software": "usually, the homing function is not
  enabled in the firmware"; the S30 product page describes the pump only as switched by M8
  ("Lightburn M8 Air Assist Switch"), with no low-air state. AGENTS.md: never invent controller
  behaviour. Twin — `laserSubProfile.model` against `airAssist`.
- **Scenario:** The note (exported in every `.lfmachine.json` as a review note) tells the operator
  that `$22=1` and `$21=1` are stock and that M9 leaves the pump on low. Neither is in a Sculpfun
  source, and the first contradicts Sculpfun's guide. The profile's values are right: homing is
  disabled and the air command is M8.
- **Evidence:** SOURCE (sculpfun.com blog and product page, fetched 2026-10-22); REPRO — the catalog
  printout shows `sculpfun-s30-manual-air … head=S30 (5 W, stock automatic air)`.
- **Refuter:** CONFIRMED.
  - Sculpfun's "Setting Up The Software" (fetched 2026-10-22) says homing is not enabled in the
    S30-series firmware, and tells users to send "$22=1" to turn it on. It says nothing about
    `$21` or M9 leaving the pump on low air.
  - `SCULPFUN_S30_MANUAL_AIR_PROFILE` spreads the base `laserSubProfile`, so its `model` stays
    "S30 (5 W, stock automatic air)" (`brand-laser-profiles.ts:134-142`).
- **Fix direction:** Remove the unsourced firmware claims from the note and comment, or cite them,
  and give the manual-air variant its own head model text.

### P3-3 — Brand presets inherit the generic 6000 mm/min ceiling and 500 mm/s² acceleration; xTool rates the D1 Pro at 400 mm/s and Ortur engraves the LM3 at 20000 mm/min

- **Where:** `src/core/devices/device-profile.ts:396,412` (default `maxFeed`, `accelMmPerSec2`),
  inherited by `diodeProfile` (`brand-laser-profiles.ts:23-62`) and the 4040.
- **Anchor:** Ground truth — xTool: "The maximum processing speed for D1 Pro is 400mm/s" (article
  17020224257559); Ortur manual p. 20 "Engraving Speed … 20000mm/min"; xTool's lbdev simulation
  accelerations are `Sim_MaxAccelX 3000` and `Sim_MaxAccelY 300`. Twin — the Falcon preset was
  raised to its rated 36000 mm/min for this very reason (controller audit 2026-09-23 speed-1,
  `falcon-profiles.ts:36-42`); the other brands were not.
- **Scenario:** An xTool D1 Pro 40 W user enters 200 mm/s from xTool's settings; compile caps it to
  100 mm/s. The feed-ceiling notice says so and offers to raise the ceiling
  (`feed-ceiling.tsx`), so this is disclosed, but the 6000 mm/min starter presented as part of a
  "Public-spec starter" has no vendor source. Estimates also use the generic 500 mm/s².
- **Evidence:** SOURCE + READ.
- **Refuter:** CONFIRMED.
  - The defaults are `maxFeed: 6000` (`device-profile.ts:396`) and `accelMmPerSec2: 500`
    (`:412`). `diodeProfile` spreads them.
  - xTool article 17020224257559 (Zendesk API, fetched 2026-10-22) says "The maximum processing
    speed for D1 Pro is 400mm/s".
  - Ortur's manual (fetched) says "The Engraving Speed is modified to 20000mm/min".
  - The feed-ceiling notice discloses the capping, so P3 stands.
- **Fix direction:** Set a sourced ceiling per brand preset (or say "starter, not vendor" in each
  brand's note, as the Ortur note already does).

### P3-4 — An imported `.lfmachine.json` keeps the built-in identity it claims, and accepts values Machine Setup's own fields refuse

- **Where:** `src/io/machine-profile/machine-profile-io.ts:198-227` and `:380-392`
  (`profileSource`, `profileId`, `catalogVersion` and `evidence` copied as given);
  `src/ui/laser/MachineSetupImportExport.tsx:188` (export writes `source.kind` from
  `profileSource`, so every saved built-in copy exports as `built-in`); field limits in
  `DeviceProfilePowerFields.tsx:21` (`MAX_POWER_S = 100000`) and `feed-ceiling.tsx:18` (100000 mm/min).
- **Anchor:** Twin — import validation against the Machine Setup fields; G-code provenance
  (`gcode-metadata.ts:191-205` writes `profile-source` and `profile-catalog`).
- **Scenario:** A shared file claiming `profileSource: 'built-in'`, `profileId: 'xtool-d1-pro'` and
  `catalogVersion: '2026-09-24'`, with `bedHeight: 600` and `maxPowerS: 255`, imports cleanly. In the
  picker the draft becomes the chosen **D1 Pro (20 W)** row (only the front-left origin would be
  flagged), and its G-code says `; profile-source: built-in` and `; profile-catalog: 2026-09-24`.
  Import also accepts `maxPowerS: 1e9` and `framingFeedMmPerMin: 1e9`, which the fields cap at
  100000. On GRBL-family controllers the live `$30` overrides S max at Start (ADR-567). On the
  Falcon command set, which never reads `$$`, the imported S max stands, and Job Review shows
  `S max $30` as Unknown.
- **Evidence:** REPRO — focused Vitest `src/io/machine-profile/zz-c7-import.test.ts` (deleted):
  `built-in claim with changed values: ok profileId=xtool-d1-pro source=built-in cat=2026-09-24 origin=front-left bed=430x600 S=255`;
  `maxPowerS 1e9: ok … S=1000000000`; `framing feed above max feed: ok … frame=1000000000`.
  Rejected as expected: `maxPowerS 0`, `negative bed`, `marlin dialect on grbl`.
- **Refuter:** CONFIRMED.
  - **REPRO** (the same deleted test): `deserializeMachineProfileDocument` reads a document that
    claims `profileSource: 'built-in'` and `profileId: 'xtool-d1-pro'`, with `bedHeight: 600`,
    `maxPowerS: 1e9` and `framingFeedMmPerMin: 1e9`. It returns ok with every value kept:
    `xtool-d1-pro built-in 2026-09-24 600 1000000000 1000000000`.
  - The review card applies `document.profile` unchanged (`MachineSetupImportExport.tsx:134`).
  - P3 stands. Machine Setup's own field already allows S max up to 100000, which already
    saturates a machine on the Falcon command set, so accepting 1e9 adds no new physical
    failure.
- **Fix direction:** On import, set `profileSource` to `imported` (keep the claimed id as a hint
  only), and apply the Machine Setup field ranges to the numeric fields.

## Known (re-encountered, not re-raised)

- **Rolling-v2 03-P3-6.** The laser finish position is not range-checked. Import also accepts
  `laserFinishPosition: { kind: 'bed', xMm: 5000, yMm: 5000 }` on a 430 × 390 mm bed, while Machine
  Setup's field stops at the bed size (`DeviceSetupLaserFinishRows.tsx:48,54`).
- **Rolling-v2 13-P1-1 (fixed).** Import now runs `profileAutofocusIssue` through
  `validateMachineProfile` (`profile-catalog.ts:251`).
- **Controller audit OR-4.** The xTool presets use `$J=` although xTool's lbdev sets
  `EnableGrblJCommand: false`; the evidence note discloses this.

## Refuted

None. The refuter (2026-10-22) could not refute any of the seven findings and lowered one
(P2-1, to P3). See each finding's **Refuter** line.

The auditor checked and did not raise:

- **xTool 20 W 430 × 390 against the lbdev's `Height: 400`.** xTool's own table gives 430 × 390 for
  20 W; the lbdev is one file for all heads. The smaller value is the safe one.
- **Sculpfun 380 × 385 against the S30 Series blog's 410 × 400.** The product page gives 380 × 385;
  the preset takes the smaller value.
- **xTool `scanningOffsets: []` while xTool's lbdev ships `ReverseIntervals`.** This is policy:
  offsets need calibration on the operator's machine (catalog review note), and the default output
  is unchanged.
- **Brand presets' `homing.enabled: false` on machines with switches.** This is conservative. It
  matches Sculpfun's "not enabled in the firmware", Ortur's "turn off auto-homing" and both LightBurn
  files' `HomeOnStartup: false`. Home is offered only after the operator confirms the switches
  (`DeviceSetupConfirmStep.tsx:48`).
- **Imported `rxBufferBytes: 4096` overflowing a stock 128-byte ring.** It does not: Start bounds the
  window by `$I`/`Bf:` evidence, falling back to 120 bytes (`laser-job-effective-stream-options.ts:68-118`).
- **Smoothieware profile with S max ≥ 2.** Import accepts it, but Job Review warns
  (`smoothie-power-scale.ts`).

## Verified clean

- **Falcon A1 Pro.** Every vendor-file value matches: Width 358, Height 268, front-left (no mirror),
  `S_Scale` 1000, 115200 baud, M8, `$HZ1`, `$HX`/`$HY`, no `$J`, no settings fetch. The bundle hash
  is unchanged since 2026-09-19. Creality's product page confirms 268 × 358 mm, 600 mm/s and both
  modules' power and wavelength.
- **xTool D1 Pro.** The lbdev (still the file xTool links) matches origin, baud and S scale, and the
  5/10/20 W work areas match xTool's table. The `preset-corrections.ts` origin correction still
  offers `{origin: 'rear-left'}` (REPRO).
- **Ortur LM3 LU2-10A.** 400 × 400 mm, front-left, S1000, M4 and auto-homing off, all from Ortur's
  own manual.
- **Sculpfun S30.** 380 × 385 mm, M8 pump, front-left and S1000, from Sculpfun's pages.
- **Neotronics 4040 Max.** 400 × 400 × 75 mm and the 500 W default spindle.
- **Safety defaults across all 18 catalog profiles.** No preset enables homing. All GRBL brand
  presets emit M4 dynamic (the 4040's safe dialect uses M3 constant cuts by design). S max is 1000
  wherever a vendor publishes it. At Start, a connected GRBL-family controller's `$30` replaces the
  profile S max (`connected-laser-power-scale.ts`, ADR-567), and Job Review flags a `$30` that
  differs from the profile.
- **Picker twin.** Row facts are the catalog values (`machineFacts`). The chosen-machine facts are
  the draft (`draftFacts`). The generic firmware starters are excluded (ADR-637 rule 2). Choosing a
  row replaces the draft verbatim (`applyPreset`), so no stale controller value is mixed in silently.
- **Import shape.** Import rejects `maxPowerS ≤ 0`, non-positive beds and feeds, unknown controller
  kinds, a dialect that does not fit the controller, invalid origins and air commands, malformed
  rotary, positioning-light, fire-control (capped at 5 %) and Auto-focus commands. It marks imported
  scan offsets pending.
- **Version pinning.** `profile-catalog-content.test.ts` pins every preset's content hash to its
  `catalogVersion` (ADR-322 Amd 2 §3).
- **CNC presets (spot check).** The LongMill MK2 30 × 30 entry is a conservative 810 × 810 mm inside
  its cited 818 × 866 mm. Sienci's spec page says the router runs at 15000–25000 RPM; the preset
  caps at 24000.

## Not verified

- **Shopify-hosted vendor pages.** ortur.net, uk.xtool.com, xtool.eu and lasertree.com answered 429
  or 404 for the whole session. So these values rest only on search-index snippets of the vendor's
  page: Ortur LU3-40A 400 × 380 mm, Ortur's "default baud 115200", the xTool 40 W 430 × 348 mm, and
  LASER TREE LT-4LDS-V2 optical data.
  - The refuter later fetched ortur.net/pages/support-olm3 directly. It confirms LU3-20A and
    LU3-40A at 400 × 380 mm, a default baud of 115200, "OLF-V2.0 Firmware" and the
    "OLM-ESP-PRO-V2.4" mainboard.
  - The xTool 40 W depth is still open, and contested. Per the search index, an xTool UK page
    gives 430 × 390. xtool.com answered 404 or 429.
- **Firmware family of the xTool D1 Pro and Sculpfun S30.** Neither vendor publishes the banner.
  Forum reports describe the D1 Pro as a GRBL compatibility layer over proprietary firmware. The
  Neotronics controller board, `$30` and homing corner are not published.
- **Falcon A1 Pro firmware build.** The vendor labels it GRBL-LPC; the 2026-07 profile recorded a
  `GrblHAL 1.1f` banner. This is disclosed and KNOWN (ADR-322 §4); not re-examined.
- **Machines named in PROJECT.md or the brief with no preset.** Atomstack (A5, X20), NEJE, xTool
  D1/F1/S1, Sculpfun S9/S10, Ortur LM2 and Falcon A1 have no preset, so there was nothing to check.
  They go to **My machine isn't listed**.
- **Stale copies of the Falcon A1 Pro.** Whether the A1 Pro answers `$$` when a stale copy connects
  with the generic grblHAL driver (so that Job Review's travel row would show the 400 × 400 bed
  against `$130`/`$131`) needs a machine. No hardware was operated.
- **CNC presets other than LongMill.** Genmitsu, Shapeoko, X-Carve and Onefinity were not
  re-fetched; each carries its own dated sources from 2026-09-19.

```json
[
  {"id":"C7-P2-1","severity":"P3","area":"ctl-device-profiles","file":"src/core/devices/preset-corrections.ts","line":27,"anchor":"Contract: ADR-322 Amd 1 §1 / Amd 2 §3 (silent corrections recorded)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Refuter lowered P2 to P3. Saved copies of the pre-2026-09-19 Falcon A1 Pro (400x400 vs 358x268) and single-head Ortur LM3 (400x400 vs LU3 400x380) presets keep a work area larger than the machine, and no correction names the bed. The xTool 40 W leg is contested (xTool UK says 430x390). The Falcon copy is already told to re-apply its preset, which fixes the bed. Copies exist only from 2026-07-07..09-19 preview/web builds, and the laser-off Frame shows an overrun first"},
  {"id":"C7-P2-2","severity":"P2","area":"ctl-device-profiles","file":"src/core/devices/brand-laser-profiles.ts","line":42,"anchor":"Ground truth: Ortur LM3 manual ($74/$75 grblHAL settings), grblHAL settings.h, LM3 [FIRMWARE:grblHAL] (two forum $I captures, OLF 205 and 211), ortur.net OLF-V2.0 on OLM-ESP-PRO-V2.4; Twin: ADR-637 rule 7 firmware hint","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Ortur LM3 presets declare grbl-v1.1 but the LM3 runs grblHAL-based OLF 2.x. The picker tags the owner's own rows Other firmware and the Falcon A1 Pro Same firmware, and every Job Review shows an identity mismatch. The Console refuses valid grblHAL $22 bitfields. The stock driver lacks stickyLineError, so after one refused line grblHAL's latched error fails the next G-code actions (HF-7)"},
  {"id":"C7-P2-3","severity":"P2","area":"ctl-device-profiles","file":"src/core/devices/falcon-profiles.ts","line":74,"anchor":"Contract: ADR-322 §5, AGENTS.md never invent; Ground truth: Creality Falcon A1 305x381 mm","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The unsourced 400x400 Falcon-compatible fallback is a Creality row, badged Simulator tested, with no Falcon A1 row beside it. An A1 owner who picks it gets a bounds check 19 x 95 mm larger than the machine. The evidence note that discloses this is never shown, and no screen showed it before ADR-637 either"},
  {"id":"C7-P3-1","severity":"P3","area":"ctl-device-profiles","file":"src/ui/laser/device-setup/DeviceSetupMachineDetails.tsx","line":78,"anchor":"Contract: ADR-637 rule 3, ADR-347 §4; Ground truth: cited xTool 40 W URL 404","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Built-in profile evidence notes (vendor caveats, sources) are never rendered in Machine Setup; the xTool 40 W source URL is dead"},
  {"id":"C7-P3-2","severity":"P3","area":"ctl-device-profiles","file":"src/core/devices/brand-laser-profiles.ts","line":119,"anchor":"Ground truth: Sculpfun setup guide and S30 product page; Twin: manual-air head model","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Sculpfun S30 note claims stock $22=1/$21=1 and M9 low air without a source (Sculpfun says homing is usually off); the manual-air variant's head model says stock automatic air"},
  {"id":"C7-P3-3","severity":"P3","area":"ctl-device-profiles","file":"src/core/devices/device-profile.ts","line":396,"anchor":"Ground truth: xTool D1 Pro 400 mm/s, Ortur LM3 20000 mm/min; Twin: Falcon rated-ceiling fix","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Brand presets inherit the generic 6000 mm/min ceiling and 500 mm/s2 acceleration with no vendor source; capped speeds are disclosed by the feed-ceiling notice"},
  {"id":"C7-P3-4","severity":"P3","area":"ctl-device-profiles","file":"src/io/machine-profile/machine-profile-io.ts","line":198,"anchor":"Twin: import validation vs Machine Setup field limits and G-code provenance","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An imported .lfmachine.json keeps a claimed built-in profileSource/profileId/catalogVersion (picker row chosen, G-code says built-in) and accepts maxPowerS and framing feed beyond the fields' 100000 caps"}
]
```
