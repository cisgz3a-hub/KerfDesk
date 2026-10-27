# Rolling audit v5 — Catalogue ground truth

- **When:** 2026-10-28, early morning +0800   **Tree:** origin/main @ `93334429e`
  (`93334429e63e1bcf1c6a0a80c03bc60d5fb44865`, committed 2026-10-27 17:03 UTC).
  - The worktree's `src` equals main for every file in scope. `git diff --stat origin/main --`
    over `src/core/devices`, `src/core/cnc`, `src/core/material-library`, `cnc-tool-starters.ts`,
    `machine.ts`, `layer.ts`, `falcon-command-contract.ts` and `machine-picker-entries.ts` lists
    only `autofocus-command.ts` (2 lines, no catalogue value). Code was read with
    `git show origin/main:<path>`.
- **Scope:**
  - **Machine catalogue:** `profile-catalog.ts`, `device-profile.ts` (default and Neotronics),
    `falcon-profiles.ts`, `brand-laser-profiles.ts`, `laser-modules.ts`, `preset-corrections.ts`,
    `positioning-light.ts`, `rotary-presets.ts`, `working-speed-range.ts`,
    `falcon-command-contract.ts`, `cnc-machine-catalog.ts`; the Machine Setup list
    (`machine-picker-entries.ts`, ADR-637); ADR-660 and ADR-664.
  - **Libraries:** the laser starter catalogue (`starter-catalog.ts`,
    `neotronics-4040-presets.ts`), the CNC tool starters and bit catalogue
    (`cnc-tool-starters.ts`, `src/ui/machine/cnc-bit-*.ts`, spot checks), the chipload calculator
    (`feeds-calculator.ts`), the CNC machine starter (`cnc-machine-starter-catalog.ts`), and the
    per-operation defaults (`LAYER_DEFAULTS`, `DEFAULT_CNC_LAYER_SETTINGS`, `DEFAULT_CNC_MACHINE_PARAMS`,
    Fire and laser-dot power).
  - **Consistency and promises:** README.md, PROJECT.md Phase I, `website/pages/*-data.mjs` and
    `cnc.mjs`, the Starter Presets button, Machine Setup's evidence label.
- **Lenses run:** L2 ground truth (main pass: every value against a pinned vendor or primary
  source), L1 contract (AGENTS.md "Never invent controller settings", the J8 rule "never invent
  machining data", ADR-637/660/664/370, WORKFLOW "Default values for a new Layer"), L3 for the
  catalogue twins (picker, starter catalogue, CNC starter, website, README).
  - Not run: L4–L6 (catalogues hold data, not paths) and L7 (beyond noting what is pinned).
- **Sources:** each vendor page was fetched from the Wayback Machine (snapshot URLs below) and read
  as text in the scratchpad; vendor device files were downloaded and pinned by SHA-256. Where no
  snapshot exists, the live URL and the fetch date (2026-10-28) are given.
- **Repro:** one temporary Vitest file, `src/core/devices/zz-j8-catalog.test.ts`, printed every
  shipped field the table uses (2 passed). Run from the worktree root with
  `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node ../../../node_modules/vitest/vitest.mjs run src/core/devices/zz-j8-catalog.test.ts --silent=false --reporter=verbose --disableConsoleIntercept`.
  It is deleted from the worktree; a copy is in
  `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j8-repros\`.
- **Counts:** 6 raised → 0 refuted → P1 1 / P2 0 / P3 5 (+ 11 KNOWN re-observed). The refuter
  confirmed all 6. It raised J8-P3-2 to P1 (§3): on an A1 Pro running grblHAL with the Trinamic
  plugin, `$150`–`$152` are the X/Y/Z microstep settings, so an "airflow level" that is a power of
  two silently rescales motion. It also refuted the X-Carve half of J8-P3-3.
  - Catalogue table: 58 rows (one field, or one field group, per row; the generic templates are
    not counted).
    - Verified against a pinned source, or by C7 where the row says so: 41 (refuter: the X-Carve
      area moved here). One of them (the A1 Pro infrared module) has correct values but a wrong
      note (J8-P3-6).
    - Wrong: 1 (refuter: the A1 Pro `$150`–`$152` air map, J8-P3-2).
    - Unsourced, below the vendor figure, or a disclosed deviation: 12. Of these, 8 are KNOWN, 2
      are in J8-P3-4, and 2 are disclosed RPM caps (Genmitsu 3018, Onefinity).
    - Contested between the vendor's own pages: 1 (xTool 40 W depth, KNOWN).
    - Above the vendor's conservative figure: 1 (Shapeoko 3, J8-P3-3).
    - Not re-fetchable this session: 2 (Creality rotary, LongMill).
  - Libraries: 6 laser starter presets (3 sourced and verified, 3 unsourced: J8-P3-1); CNC chart,
    starter and defaults all KNOWN; 6 bit-catalogue spot checks verified; 0 wrong.
- **Refuter:** fresh context, 2026-10-28, on origin/main `93334429e`. The refuter fetched every
  source it cites itself; none was taken from the auditor's downloads.
  - Repro: `src/core/controllers/zz-j8r-falcon-writes.test.ts` (1 passed), run alone and then
    deleted. It drives the real Falcon driver (`selectControllerDriver('grblhal',
    'creality-falcon-a1-pro')`) through `prepareConsoleCommand` and `consoleSettingWriteIssue`.
  - Firmware sources: grblHAL core `settings.h`/`settings.c`/`errors.h` @ `d7aaee3d`; grblHAL
    `Plugins_motor/trinamic.c` @ `11c937c8` (the plugin's v0.12) and @ `9229617c`; Trinamic
    library `common.c` @ `9b304175`.
  - A1 Pro firmware: the `$I`/`$$` transcript in barebaric/rayforge PR #461 (merged 2026-09-26,
    head `2675a36a`, merge `2ed50476`), fetched with `gh pr view` on 2026-10-28; body SHA-256
    `49f2cf09…1db90d0`. No Wayback snapshot could be checked (archive.org answered 429).
  - Wayback started refusing the refuter's fetches part-way through ("suspected abusive bot
    traffic"). The rows checked after that point were read from the live vendor pages on
    2026-10-28, with no snapshot.

## Headline

**Refuter: J8-P3-2 is P1.** One Falcon A1 Pro's own `$I`/`$$` report shows grblHAL with
`[PLUGIN:Trinamic v0.12]`, CoreXY kinematics, and `$150=16 $151=16 $152=16 $153=16`. On that build,
the settings KerfDesk's Falcon contract admits as "engraving airflow level", "cutting airflow level"
and "air pump standby wait" are the X, Y and Z microsteps. The plugin accepts any power of two and
leaves `$100`–`$102` alone. So `$150=32` makes that motor move half the commanded distance, which
on CoreXY distorts both X and Y. The change persists, and nothing says so. The exact advice
`$152=100` is not a power of two, so the firmware refuses it with `error:3`. That remedy cannot work
on this build, but it does not move the machine wrongly.

Every value that decides where and how hard a first job burns is right for the listed lasers:
work area, origin corner, `$30`/S scale, baud, air command, Auto-focus and the Falcon's Home all
match the vendor's own LightBurn file, product page or manual, re-read from pinned copies. The
Creality and xTool device files still hash to the values recorded in September and October. The
three controller-v2 fixes for this catalogue (#1385: Ortur on grblHAL, the Falcon fallback
withdrawn, the A1 Pro bed correction) hold, and Machine Setup's one list is the only machine list
in the app, so there is nothing for a phone or MCP list to disagree with.

The auditor found no P1 or P2; the refuter raised J8-P3-2 to P1, as above. The other five P3s are
about provenance:

- **J8-P3-1.** Three of the Neotronics 4040's six laser starter presets carry no source. Their
  numbers are Creality's Falcon A1 Pro 20 W table (another machine, with a smaller spot), while the
  starter catalogue says each machine gets its own researched numbers and the button calls them
  researched for the Neotronics.
- **J8-P3-2 (refuter: P1).** The Falcon A1 Pro's `$150`–`$152` air-setting map, and the Job Review
  advice "send `$152=100`", come from Creality's page for the Falcon **A1**. The A1 Pro's own
  settings page lists none of them, and under grblHAL numbering (the family the A1 Pro preset
  declares) they are the per-axis microstep settings. The refuter found an A1 Pro `$$` that shows
  exactly that.
- **J8-P3-3 / P3-4.** The Shapeoko 3 size preset takes the vendor's larger nominal area where the
  vendor also gives a smaller one (the X-Carve half was refuted). The two Onefinity presets keep
  unsourced legacy sizes.
- **J8-P3-5.** README says the CNC side has had informal cuts on a Neotronics 4040; the website
  copy says no CNC feature has cut material on a real machine.
- **J8-P3-6.** The A1 Pro infrared module's note says Creality does not name the source type;
  Creality's page says "Solid-state laser".

## Catalogue: preset → field → source

Values are as shipped on `93334429e` (printed by the repro). "Inh." means inherited from
`DEFAULT_DEVICE_PROFILE`. Every brand preset has homing off, `laserModeEnabled: true`, dialect
`grbl-dynamic` (Neotronics: `neotronics-4040-safe`), `accelMmPerSec2` 500, and no `camera`
capability.

| Preset | Field | KerfDesk | Source value | Source (pinned) | Verdict |
|---|---|---|---|---|---|
| Falcon A1 Pro | work area | 358 × 268 mm | Width 358, Height 268; page "Engraving Area: 268*358mm" | Creality bundle `falcon_a1_pro_(lightburn_2.0.00+).lbzip`, SHA-256 `11b13328…f988405b`, fetched 2026-10-28 from wiki.creality.com (same hash as the 2026-09-19 record); [product page, archived 2026-09-12](https://web.archive.org/web/20260912014814/https://www.creality.com/products/falcon-a1-pro-20w) | verified |
| | origin | front-left (inh.) | `MirrorX: false`, `MirrorY: false` | bundle | verified |
| | S max | 1000 | `S_Scale: 1000` | bundle | verified |
| | baud | 115200 | `BaudRate: 115200` | bundle | verified |
| | air | `M8` | `AirAssistM7: false` | bundle | verified |
| | Auto-focus | `$HZ1` | macro "Aotu Focus" `$HZ1` | bundle | verified |
| | Home / jog / `$$` | `$HX` then `$HY`; no `$J=`; no `$$` | macro `$HX\n$HY`; `EnableGrblJCommand: false`; `AllowSettingsFetch: false` | bundle | verified |
| | firmware | `grblhal` + vendor command set | device `Name: "GRBL-LPC"`; refuter: one A1 Pro's `$I` reads `[FIRMWARE:grblHAL]`, `[BOARD:A1 Pro Laser Master]`, `[PLUGIN:Trinamic v0.12]`, `[KINEMATICS:CoreXY v2.02]` | bundle; rayforge PR #461 transcript (fetched 2026-10-28) | disclosed (ADR-322 §4, PROJECT.md Phase I); KNOWN. Refuter: the family choice is supported |
| | max feed | 36000 mm/min | "600mm/s" | product page | verified |
| | 20 W module | 20 W, 455 nm, diode | "Optical Power: 20W", "455±5nm", "Semiconductor laser" | product page | verified |
| | 2 W module | 2 W, 1064 nm, 0.03 mm, technology `unknown` | "1064±1nm", "0.03mm ultra-fine laser spot", "Laser Source: Solid-state laser" | product page | values verified; note wrong (**J8-P3-6**) |
| | `$150`/`$151`/`$152` writes and `$152=100` advice | air levels and standby, 0–100 | A1 page: air settings; A1 Pro page: not listed | [A1 page, archived 2026-04-20](https://web.archive.org/web/20260420210839/https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/description-for-GRBL-configuration-parameters); [A1 Pro GRBL page, archived 2026-05-16](https://web.archive.org/web/20260516212835/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/grbl) | other model's source (**J8-P3-2**). Refuter: **wrong** on the one A1 Pro build with a published `$$` (firmware v1.0.4, build 20260706): `$150=16 $151=16 $152=16 $153=16` are the X/Y/Z/A microsteps (grblHAL `settings.h` @ `d7aaee3d` L558; rayforge PR #461). **J8-P3-2, refuter: P1** |
| | working-speed slider top | 10000 mm/min | basswood engrave 30/5000, walnut 10/6000; brushed steel 90/10000 | [consumable guide, archived 2026-05-22](https://web.archive.org/web/20260522121137/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/consumable-parameter-guide) | verified |
| | laser dot | 1 % default, 5 % cap, 30 s off | Falcon Design Space "Laser on": power 1–10, 30 s countdown | ADR-664 Context (`docs/decisions/ADR-664-falcon-led-is-the-laser-at-low-power.md`) | sourced (ADR; binary not re-read) |
| | rotary | chuck, 40 mm/rotation | Creality Rotary Kit Pro manual | manuals.plus/asin/B0CMXCFNB2 (403, no snapshot) | not re-fetchable |
| | accel | 500 mm/s² (inh.) | not published | — | unsourced, KNOWN C7-P3-3 |
| Falcon-compatible (withdrawn) | work area | 400 × 400 mm | A1 "305 mm × 381 mm" | [A1 page, archived 2026-10-14](https://web.archive.org/web/20261014111822/https://www.creality.com/products/creality-falcon-a1-laser-engraver) | withdrawn from the list (ADR-660); verified fixed |
| xTool D1 Pro 5 / 10 / 20 W | work area | 430 × 400 / 430 × 400 / 430 × 390 | "430 * 400 mm", "430 * 390 mm" columns | [xTool article 14109952045463, archived 2025-05-12](https://web.archive.org/web/20250512113023/https://xtool.zendesk.com/hc/en-us/articles/14109952045463-D1-Pro-Product-Introduction) | verified |
| xTool D1 Pro 40 W | work area | 430 × 348 mm | 430 × 348 (xTool spec, 9to5Toys) vs 430 × 390 (xTool UK) | web search 2026-10-28; [UK page, archived 2024-06-19](https://web.archive.org/web/20240619082148/https://uk.xtool.com/products/40w-laser-module-for-d1-pro) (archive copy truncated) | contested; KerfDesk takes the smaller; KNOWN C7 |
| xTool D1 Pro (all) | origin | rear-left | `MirrorY: true`, `MirrorX: false` | `xTool-D1ProV3.lbdev`, SHA-256 `d03e3021…7fad73f4`, fetched 2026-10-28 from the attachment URL the code cites (same hash as C7) | verified |
| | baud | 230400 | `BaudRate: 230400` | lbdev | verified |
| | S max | 1000 (inh.) | `S_Scale: 1000` | lbdev | verified |
| | air | none | `AirAssistM7: false` | lbdev | conservative (no command sent) |
| | jog | `$J=` | `EnableGrblJCommand: false` | lbdev | disclosed in evidence; KNOWN OR-4 |
| | power | 5 / 10 / 20 / 40 W | head names | article | verified |
| | firmware | `grbl-v1.1` | not published | — | unsourced, KNOWN C7 "Not verified" |
| | max feed | 6000 (inh.) | "400mm/s" | article | below vendor, KNOWN C7-P3-3 |
| Sculpfun S30 (M8 / manual air) | work area | 380 × 385 mm | "the standard version is 380*385mm" | [S30 page, archived 2025-09-11](https://web.archive.org/web/20250911115158/https://www.sculpfun.com/products/sculpfun-s30-5w-laser-engraver-rotary-roller-40-40cm-honeycomb-panel) | verified |
| | air | `M8` / none | "Lightburn M8 Air Assist Switch" | S30 page | verified |
| | power | 5 W | "S30 5W" | S30 page | verified |
| | origin, S max | front-left, 1000 | "front left is correct", "S-Value must be set to 1000" | Sculpfun "Setting Up The Software" (per C7; not re-fetched) | verified by C7 |
| | evidence note | "$22=1, $21=1", "M9 … low air" | homing usually off | — | KNOWN C7-P3-2 (open) |
| Ortur LM3 LU2-10A / LU3-20A / LU3-40A | work area | 400 × 400 / 400 × 380 / 400 × 380 | "LU2-10A: 400*400 mm", "LU3-20A: 400*380 mm", "LU3-40A: 400*380 mm" | [ortur.net support page, archived 2026-02-04](https://web.archive.org/web/20260204135625/https://ortur.net/pages/support-olm3) | verified |
| | S max | 1000 (inh.) | "Power Rate S0-S1,000" | support page | verified |
| | baud | driver default 115200 | "(Default: 115200)" | support page | verified |
| | firmware | `grblhal` | "OLF-V2.0 Firmware", "OLM-ESP-PRO-V2.4" | support page; manual at [Ortur repo @ `e11b8fc0`](https://github.com/Ortur-Tech/Ortur_Laser_Master_3/tree/e11b8fc09834320ff26971b554b6305ec9c3e22a) (PDF not re-read; C7 read pp. 12, 20, 25) | verified (C7-P2-2 fixed by #1385) |
| | origin | front-left (inh.) | 'Select the origin "Front Left"' | manual p. 25 (per C7) | verified by C7 |
| | power | 10 / 20 / 40 W | ">9,500 - 10500mw", ">19,500 - 20500mw", ">39,500 - 40500mw" | support page | verified |
| | max feed | 6000 (inh.) | "Engraving Speed 0-20,000mm/min" | support page | below vendor, KNOWN C7-P3-3 |
| Neotronics 4040 Max / LT-4LDS-V2 | work area, Z | 400 × 400, Z 75 | "Working Area : 400x400x75mm(LxW)" | [4040 Max page, archived 2026-06-17](https://web.archive.org/web/20260617193849/https://neotronics.co.za/index.php?route=product/product&product_id=1018) | verified |
| | spindle | 12000 RPM (500 W) | "Operating Speed: 3000-12000RPM"; "By Default we provide the 500w spindle" | [spindle page, archived 2022-07-03](https://web.archive.org/web/20220703044304/https://neotronics.co.za/index.php?route=product/product&product_id=297); 4040 page | verified |
| | probe | `zProbePresent: true` | "1 x Z-probe" | 4040 page | verified |
| | laser head | 20 W, 455 nm, 0.16 × 0.18 mm, focus 40 mm | "20W(19-21W)", "455nm", "0.16*0.18mm", "40mm" | [LASER TREE page, archived 2026-03-28](https://web.archive.org/web/20260328063203/https://lasertree.com/products/20w-optical-power-laser-cutting-module) | verified |
| | S max, origin, firmware, homing | 1000, front-left, `grbl-v1.1`, off | "offline controller", limit switches, no firmware or corner named | 4040 page | unsourced, disclosed in evidence; KNOWN C7 |
| Generic FluidNC | S max | 255 | "linear from 0=0% to 255=100%" | [FluidNC v4.0.3 `LaserSpindle.cpp` @ `25ae119b`, L27-28](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Spindles/LaserSpindle.cpp#L27-L28) | verified |
| Generic GRBL / grblHAL / Marlin / Smoothie / Ruida | all | firmware templates | — | — | not machines (ADR-637 rule 2); C6 owns the drivers |
| CNC Genmitsu 3018-PRO | work area | 300 × 180 mm | "(300 x 180 x 45mm)" | [SainSmart page, archived 2026-05-22](https://web.archive.org/web/20260522181632/https://www.sainsmart.com/products/sainsmart-genmitsu-cnc-router-3018-pro-diy-kit) | verified |
| | RPM | 10000 | not on the page | — | unsourced, disclosed ("nominal sender starter, not measured") |
| CNC Genmitsu 4040-PRO | work area, RPM | 400 × 400, 9000 | 4040-PRO column: "400 x 400 x 78mm", Max RPM 9000 | [SainSmart page, archived 2026-05-13](https://web.archive.org/web/20260513002625/https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting) | verified |
| CNC Neotronics 4040 Max | work area, RPM | 400 × 400, 12000 | as above | as above | verified |
| CNC Shapeoko 3 | work area | 425 × 425 mm | "425mm x 425mm"; "Carbide Create limits this to 406.4 x 406.4mm"; one machine "16⁷⁄₁₆″ total travel; 16½″ side-to-side" | Carbide 3D staff post: [topic, archived 2023-02-04](https://web.archive.org/web/20230204021025/https://community.carbide3d.com/t/complete-footprint-of-the-shapeoko-3/4190); post #7 JSON fetched 2026-10-28 (`https://community.carbide3d.com/t/4190/7.json`) | above the conservative figures (**J8-P3-3**) |
| | RPM | 30000 | "RPM Range 12,000 - 30,000" | [Carbide Compact Router, archived 2026-09-25](https://web.archive.org/web/20260925064005/https://shop.carbide3d.com/products/carbide-compact-router) | verified |
| CNC Shapeoko 3 XXL | work area, RPM | 838 × 838, 30000 | "~33″ (X-axis) x ~33″ (Y-axis)" (838.2 mm) | same post; router page | verified |
| CNC X-Carve 1000 mm (Nov 2021) | work area | 750 × 750 mm | "Cuttable Area 29.5 x 29.5 x 4.5 in" (749.3 mm) | easel.inventables.com/partners/machines/inventables-x-carve-nov2021, fetched 2026-10-28 (no snapshot); refuter: voelkner.de listing 9819346 "Arbeitsbereich: 750mm x 750mm x 114 mm" (4.5″ Z, fetched 2026-10-28, no snapshot); MyBotShop X-Carve 1000 mm datasheet PDF "750 x 750 x 65 mm" (SHA-256 `4002f0c7…46eaa2`) | refuter: **verified**. 750 mm is the metric figure for this machine family; 29.5″ is 750 mm rounded to the half inch (750 mm = 29.53″). The J8-P3-3 X-Carve half is refuted |
| | RPM | 24000 cap | Makita "rated 10,000 to 30,000 RPM" | same | verified (conservative) |
| CNC Onefinity Woodworker | work area | 807 × 765 mm | 32 1/8″ × 32 1/8″ (816 × 816 mm) | [Onefinity Woodworker page, archived 2024-07-22](https://web.archive.org/web/20240722231317/https://www.onefinitycnc.com/product-page/woodworkeroriginal) | unsourced legacy, smaller (**J8-P3-4**) |
| CNC Onefinity Journeyman | work area | 1214 × 765 mm | 48 1/8″ × 32 1/8″ (1222 × 816 mm) | MatterHackers listing via web search 2026-10-28 (retailer, no vendor snapshot) | unsourced legacy, smaller (**J8-P3-4**) |
| CNC Onefinity (both) | RPM | 24000 cap | — | — | unsourced, disclosed ("app cap") |
| CNC LongMill MK2 30×30 | work area, RPM | 810 × 810, 24000 | 818 × 866 travel; 15000–25000 RPM (per C7) | resources.sienci.com (Cloudflare challenge, no snapshot) | verified by C7; not re-fetchable |

## Libraries: source status

| Library | Entries | Sourced (verified here) | Sourced elsewhere / KNOWN | Unsourced | Wrong |
|---|---|---|---|---|---|
| Laser starter presets (Neotronics only; every other preset has none, by design: `starter-catalog.ts:19-24`) | 6 | 3: MDF 3 mm 100 % / 480 / 2 passes (xTool 20 W MDF guide); paper, card and felt 90 % / 4000 M4 (Creality table); clear acrylic unsupported (xTool article 555) | — | 3: engrave 30 % / 5000, plywood 3 mm 100 % / 500, black acrylic 3 mm 100 % / 360 (**J8-P3-1**; the numbers equal Creality's A1 Pro table) | 0 |
| CNC chipload chart (`feeds-calculator.ts:44-71`) | 5 materials × 4 bands, depth and plunge factors | depth and plunge factors sit in the Shapeoko A-to-Z ranges (F4) | KNOWN F4 K-1: a "PROVISIONAL conservative" between-sources starter; hard wood above the hobby maximum; K-2 band edges | chart itself (disclosed) | 0 |
| CNC machine starter (Neotronics) | 1 | spindle 12000 RPM | KNOWN F4 K-5 / FS-2: labelled `unverified-starter`, 0.0125 mm/tooth | feed 300, plunge 250, 0.75 mm/pass (disclosed, ADR-256 maintainer direction) | 0 |
| CNC tool starters (`DEFAULT_CNC_TOOLS`) | 22 | 4 with a `catalogId` resolve to sourced catalogue rows | — | 18 generic nominal sizes (diameters by name; the operator matches the bit in hand; no feeds) | 0 |
| CNC bit catalogue (`src/ui/machine/cnc-bit-*.ts`) | families + exact rows | spot-checked 6: Amana 46280/46282/46284/46286 (tip, per-side angle, length and shank all in the source URLs), Whiteside 1564 (120°, 3/4″ cut, 1/2″ shank, fetched 2026-10-28), Inventables 60°/90° V-bits (by URL) | 2026-08-01 research; F4 "flute counts appear only where a listing supports them"; #894 O-flute flute fix | — | 0 |
| Per-operation defaults | laser layer, CNC layer, CNC machine, Fire | `LAYER_DEFAULTS` 30 % / 1500 = WORKFLOW "Default values for a new Layer"; Fire and laser dot 1 % / 5 % = ADR-664 and ADR-162 | `DEFAULT_CNC_LAYER_SETTINGS` 1000 / 300 / 12000 / 1.5 mm: KNOWN July 2026 audits, warned by `cnc-default-feed-warnings.ts:13-36`; safe Z 3.81 (Easel 0.150″, code comment) | spin-up 3 s (operator setting, ADR-209) | 0 |
| Probe defaults (plate 15 mm, seek 150, probe 25) | 1 | — | owned by controller-v2 C2 | not checked here | — |

No library value is a feed, depth or power that would break a bit or start a fire without a
warning: the riskiest (thin stock at 90 %) runs in M4, carries "can ignite" warnings and matches the
vendor table; the CNC defaults are warned.

## Findings

### J8-P3-1 — Three Neotronics laser starter presets carry no source; their numbers are Creality's Falcon A1 Pro 20 W table, while the catalogue promises numbers researched for the Neotronics

- **Where:**
  - `src/core/material-library/neotronics-4040-presets.ts:45-60` (Engrave 254 DPI: 30 %, 5000),
    `:61-68` (3 mm plywood cut: 100 %, 500), `:85-96` (3 mm black acrylic: 100 %, 360). None has a
    source comment. Their revision is `neotronics-lt4lds-v2-20w-research-2026-06-16` (`:39`); the
    values are unchanged since `d0ced49b8` (2026-06-16).
  - `:102-105`: the paper preset alone says its numbers "follow Creality's Falcon material table".
  - `src/core/material-library/starter-catalog.ts:1-6`: "researched starter material presets
    validated FOR THAT MACHINE … do not reuse another machine's numbers."
  - `src/ui/layers/MaterialLibraryPanel.tsx:83`: the button reads "Create a starter library for
    Neotronics 4040 Max / LT-4LDS-V2 20W. Researched starting points, not guaranteed burn settings."
- **Anchor:**
  - **Contract.** AGENTS.md:21 "Never invent controller settings, G-code behavior, safety
    behavior …"; the J8 rule "never invent machining data".
  - **Twin.** `starter-catalog.ts:1-6` (each machine its own numbers) against the presets (another
    machine's numbers).
  - **Ground truth.** Creality's Falcon A1 Pro consumable parameter guide
    ([archived 2026-05-22](https://web.archive.org/web/20260522121137/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/consumable-parameter-guide)),
    20 W blue engraving / cutting columns, power % / speed mm/min / passes:
    - Basswood board 3 mm and Basswood plywood 3 mm: `30/5000/1` and `100/500/1`;
    - Black frosted acrylic 3 mm: `10/5000/1` and `100/360/1`;
    - Kraft paper and Cardboard 0.2 mm: `90/4000/1`.
  - **Ground truth.** The two heads differ: LASER TREE gives the LT-4LDS-V2 "Spot Size
    0.16*0.18mm" ([archived 2026-03-28](https://web.archive.org/web/20260328063203/https://lasertree.com/products/20w-optical-power-laser-cutting-module));
    KerfDesk's own A1 Pro module is 0.08 × 0.1 mm (`laser-modules.ts:16`). At the same 20 W, the
    Neotronics spot has about 3.6 times the area.
- **Scenario:** An operator with the Neotronics profile presses **Starter Presets** and applies
  "Basswood / plywood 3 mm" (100 %, 500 mm/min, 1 pass) or the black acrylic cut. The button says
  these are researched starting points for their machine. They are the Falcon A1 Pro's basswood
  and black frosted acrylic settings, and nothing in the app or the code says so. With the larger
  spot the cut may not go through; on hardwood plywoods Creality's own table is slower (oak plywood
  `100/400/1`). Auto-recipe (ADR-496) can apply the same starter to a new operation.
- **Evidence:** SOURCE (above) + REPRO (`zz-j8-catalog.test.ts` `STARTER` rows: the six presets'
  mode, power, speed, passes, power mode and revision as listed; `STARTER-COVERAGE`: only
  `neotronics-4040-max-lt4lds-v2-20w` has starters).
- **Severity:** P3. The values are plausible for a 20 W blue diode and err toward under-burning
  (lower irradiance), every preset says "starting point" and to run Material Test first, and
  the hazardous one (thin stock) is the sourced one. A refuter may weigh P2 for the "for this
  machine" promise.
- **Novelty:** #894 (2026-09-25) sourced and changed only the MDF and paper presets
  (`git show -s 6e89fd6d9`). The July burn-quality audit checked only the "starting point" wording.
  Not elsewhere in `docs/audits/`.
- **Refuter:** CONFIRMED, **P3 kept**.
  - *What would make it false:* a source cited for the three presets elsewhere (an ADR, a research
    note, the 2026-06-16 commit), or a Neotronics or LASER TREE table with the same numbers.
  - *Checked:*
    - Creality's A1 Pro consumable guide, re-fetched from the same snapshot (SHA-256
      `68e8b2d9…8ef09b08`): Basswood plywood 3 mm `30/5000/1` and `100/500/1`, Black frosted
      acrylic 3 mm `100/360/1`, Kraft paper and Cardboard 0.2 mm `90/4000/1`. These match the
      presets exactly.
    - No source exists for them: `d0ced49b8` adds the presets with no research file, no ADR covers
      them (ADR-231's references are the machine, LASER TREE and GRBL pages only), and #894's body
      names only the paper, MDF and clear-acrylic changes.
    - The research label is stronger than the report says. `buildStarterLibrary` writes the revision
      `neotronics-lt4lds-v2-20w-research-2026-06-16` into each entry's `calibrationProvenance`,
      together with the LT-4LDS-V2 head metadata (`material-library-builders.ts:83-85, 89-99`).
  - *Severity:* the bar for P2 is not met.
    - LASER TREE's own page for the head (snapshot re-fetched, decompressed SHA-256
      `3dd092d8…cbe96ff0`) claims "10mm bass plywood and 8mm black acrylics in one pass" and "Cut 10mm
      of plywood at 3mm/sec". So 3 mm at 500 or 360 mm/min is inside what the head's maker claims.
    - The energy per millimetre equals Creality's tested figure for a 20 W blue diode. The larger
      0.16 × 0.18 mm spot lowers irradiance, so the likely failure is a cut that does not go through.
      The operator can see that, and it is not a new fire risk.
    - Every preset says "Starting point" and points to a test.
    - What remains is provenance and a broken internal comment contract, which is P3.
- **Fix direction:** Cite the Creality table on the three presets and say in the description that
  the numbers come from another 20 W head with a smaller spot, or replace them with an LT-4LDS-V2
  source, and reword `starter-catalog.ts:1-6` to match what the catalogue does.

### J8-P3-2 (refuter: P1) — The Falcon A1 Pro allows `$150`–`$152` writes and advises `$152=100` from Creality's Falcon A1 page; the A1 Pro's own settings page lists none of them, and under grblHAL numbering they are axis microstep settings

- **Where:**
  - `src/core/controllers/falcon-command-contract.ts:51-59`: `FALCON_AIR_SETTING_WRITES`, with the
    meanings "engraving airflow level", "cutting airflow level", "air pump standby wait in
    seconds, 100 = never", cited to the A1 page.
  - `src/ui/laser/job-review/air-assist-standby-warnings.ts:28-38`: `AIR_STANDBY_WARNING` tells the
    A1 Pro operator "send $152=100 from the Console" as fact.
  - `src/core/devices/falcon-profiles.ts:13`: the A1 Pro preset declares `controllerKind: 'grblhal'`.
- **Anchor:**
  - **Ground truth.** Creality's Falcon **A1** page
    ([archived 2026-04-20](https://web.archive.org/web/20260420210839/https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/description-for-GRBL-configuration-parameters)):
    for `$152`, "if set to 100, the air pump and laser module will not be turned off".
  - **Ground truth.** Creality's Falcon **A1 Pro** "GRBL" page
    ([archived 2026-05-16](https://web.archive.org/web/20260516212835/https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/grbl))
    lists `$24`, `$25`, `$33`–`$36`, `$43`, `$100`–`$103`, `$110`–`$113` and `$120`–`$123`, and no
    `$150`–`$152`. `$33`–`$36` (PWM) and `$43` (homing passes) are grblHAL core numbers.
  - **Ground truth.** grblHAL core
    [`settings.h` @ `d7aaee3d`, L36 and L553-L562](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L553-L562):
    `AXIS_SETTINGS_INCREMENT` is 10 and
    "Setting_AxisMicroSteps = Setting_AxisSettingsBase + 5 * AXIS_SETTINGS_INCREMENT", so `$150`,
    `$151` and `$152` are X, Y and Z microsteps.
  - **Contract.** AGENTS.md:21 "Never invent controller settings".
- **Scenario:** On an A1 Pro the air stops mid-job. Job Review has already told the operator to
  "send $152=100 from the Console", and the Falcon contract lets that write through (it is the only
  numeric write allowed). If the A1 Pro firmware kept the A1's air map, the advice works. If it
  follows grblHAL core numbering, as its published settings list does, the write targets Z
  microstepping (on a driver that exposes it), which is the Auto-focus axis. KerfDesk cannot read
  `$$` on this contract to tell which.
- **Evidence:** SOURCE (above) + REPRO (`FALCON-WRITES` row: ids 150, 151, 152 with the A1 meanings).
- **Severity:** P3. Unverified either way. Community reports (and the code comment at
  `air-assist-standby-warnings.ts:4-10`) describe the same air cut-off on both models, so the A1
  map may well hold. Raise to P2 if an A1 Pro `$$` (outside KerfDesk) shows `$150`–`$152` are not
  the air settings.
- **Novelty:** Partly KNOWN. ADR-370 Context 1 already says "The A1 Pro's GRBL page lists none of
  the three", and its Verification says whether the A1 Pro implements them "is unverified". New
  here: the grblHAL microstep collision, and that the operator-facing advice states the A1 meaning
  without that caveat. HF (2026-09-25) re-fetched the A1 page only.
- **Refuter:** CONFIRMED. **Raised to P1.**
  - *What would make it false:*
    - the A1 Pro firmware keeps the A1's air map at `$150`–`$152`;
    - grblHAL refuses the values KerfDesk lets through;
    - the write never reaches the wire;
    - a warning names the conflict before the write.
  - *grblHAL meaning, pinned:*
    - Core [`settings.h` @ `d7aaee3d` L553-L558](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L553-L558)
      gives `Setting_AxisMicroSteps = Setting_AxisSettingsBase + 5 * AXIS_SETTINGS_INCREMENT`
      ("Not used by the core"). An unregistered id is refused:
      [`settings.c` L3534-L3541](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3534-L3541)
      returns `Status_SettingDisabled`.
    - The Trinamic plugin registers the setting.
      [`Plugins_motor/trinamic.c` @ `11c937c8` (reports itself as v0.12)](https://github.com/grblHAL/Plugins_motor/blob/11c937c85f07f7f4a52be6dfdd0e49f4fcfe1886/trinamic.c#L121)
      names it "-axis microsteps", with no min or max. At
      [L245-L259](https://github.com/grblHAL/Plugins_motor/blob/11c937c85f07f7f4a52be6dfdd0e49f4fcfe1886/trinamic.c#L245-L259)
      it sets the driver when `microsteps_isvalid` passes and otherwise returns
      `Status_InvalidStatement` (`errors.h` L35: 3). It never touches `steps_per_mm`. Current
      [`9229617c` L598-L610](https://github.com/grblHAL/Plugins_motor/blob/9229617c1d8a3cc7a71fd584896500a779978b02/trinamic.c#L598-L610)
      behaves the same way.
    - The validity test is
      [Trinamic-library `common.c` @ `9b304175` L44-L55](https://github.com/terjeio/Trinamic-library/blob/9b304175318d93818c8967faadc89dd101b17e92/common.c#L44-L55):
      exactly one bit set, up to 256. Within KerfDesk's 0–100 range, 1, 2, 4, 8, 16, 32 and 64 are
      accepted; 0, 25, 30, 100 and every other value are refused.
  - *What the A1 Pro reports:*
    - An A1 Pro's `$I` in barebaric/rayforge PR #461 (merged 2026-09-26, merge `2ed50476`;
      fetched 2026-10-28; body SHA-256 `49f2cf09…1db90d0`) reads `[Firmware:Version v1.0.4]`,
      `[FIRMWARE:grblHAL]`, `[NEWOPT:…,TMC=15]`, `[BOARD:A1 Pro Laser Master]`,
      `[BUILD:20260706154934]`, `[PLUGIN:Trinamic v0.12]` and `[KINEMATICS:CoreXY v2.02]`.
    - Its `$$` reads `$140=1500 $141=1500 $142=1200 $143=1200` (motor currents) and
      `$150=16 $151=16 $152=16 $153=16`. There is a `$153`, and none of the A1 air defaults
      (25 / 100 / 30) appear, so these are microsteps, not air settings.
    - The same platform as the maintainer's: that dump's `[OPT:…,512,65536,…]` matches the
      maintainer A1 Pro's `Bf:512,65535` (`falcon-profiles.ts:20-23`). Creality's A1 Pro GRBL page
      (live 2026-10-28 and the 2026-05-16 snapshot, SHA-256 `62e0e6cb…5f4ee54`) uses grblHAL core's
      own setting names, for example "Homing passes, range: 1 - 128" (`settings.c` L2411), and
      still lists no `$150`–`$152`.
    - Contrast with the A1: an A1 `$$` (LightBurn forum topic 181704, post 19, 2026-01-25; topic
      JSON fetched 2026-10-28, SHA-256 `aacddec9…2591168fa`) reads `[VER:1.1f.20220810:]`,
      `CV40-MASTER … V1.0.6`, stock-GRBL numbering, and `$150=25 $151=100 $152=30`. The air map is real on the A1's firmware and absent on the A1 Pro's.
  - *What KerfDesk sends:* refuter repro `zz-j8r-falcon-writes.test.ts` on the real Falcon
    driver.
    - Output: `$150=32`, `$150=64`, `$151=8`, `$152=8`, `$152=100` and `$150=25` all give
      `kind=setting-write confirm=true issue=null`, and `settingsQuery=null`.
    - The only gate is `runConsoleCommand`'s generic confirm, "Send persistent controller
      setting?" followed by the command (`run-console-command.ts:41-46`). No `$$` re-read follows,
      because the Falcon contract has none.
    - The one place KerfDesk states a meaning is its refusal text, which calls `$150` "engraving
      airflow level" (`console-setting-writes.ts:96`, `falcon-command-contract.ts:56-58`).
    - The `$152=100` advice appears in Job Review (`air-assist-standby-warnings.ts:35`,
      `air-assist-cycling-warnings.ts:45`), the Air restart tooltip (`DeviceProfilePowerFields.tsx:174`)
      and the live hold message (`laser-stream-hold.ts:283`).
  - *Outcome on that build:*
    - The literal advice `$152=100` gets `error:3` and changes nothing. The remedy fails, which is
      P2-class misleading advice on its own. The auditor's "the write targets Z microstepping" does
      not happen for 100.
    - An operator who uses the Console's air settings as KerfDesk labels them, with a power-of-two
      level (`$150=32`, `$151=64`, `$152=8`), changes that axis's microstepping. `$100`–`$102`
      stay as they were, so the motor moves 16/n of the commanded distance from then on. That is
      both axes on CoreXY, and Z, the focus axis, for `$152`.
    - The new value is stored in the controller, so every later job and Frame comes out scaled.
  - *Severity (§3):*
    - The output is silently wrong (position, scale, focus height), reachable today on a listed
      preset through the only numeric write KerfDesk allows, and KerfDesk's own label for it is
      false.
    - The generic confirm does not name the conflict, and Frame is not a warning.
    - Reach (a power-of-two value) cannot lower a reachable P1.
    - Not hardware-tested: the firmware side rests on one third-party transcript, corroborated
      by Creality's A1 Pro page and the matching `Bf:512`. The coordinator should re-verify.
  - *Novelty:* no `docs/audits/` or DECISIONS.md text mentions microsteps. ADR-370 (2026-09-24)
    predates the transcript. The one open PR (#1478) touches none of these files.
  - *Fix direction (refuter):* take `$150`–`$152` off the A1 Pro contract, or allow them only after
    the controller has shown the A1's map, and replace the A1 Pro's `$152=100` advice with the
    firmware-update advice.
- **Fix direction:** Find an A1 Pro source (Creality's A1 Pro air-assist manual, or the Falcon
  Design Space strings already read for ADR-664), or say in the advice and the Console row that
  the meaning comes from the A1 page and is unconfirmed on the A1 Pro.

### J8-P3-3 (refuter: Shapeoko 3 only; the X-Carve half refuted) — The Shapeoko 3 and X-Carve presets take the larger or rounded-up work area where the vendor also gives a smaller one; the catalogue takes the smaller figure everywhere else

- **Where:** `src/core/cnc/cnc-machine-catalog.ts:114-115` (Shapeoko 3: 425 × 425 mm, with the note
  at `:117` naming Carbide Create's 406.4) and `:175-176` (X-Carve: 750 × 750 mm). A preset sets
  the draft's `bedWidth`/`bedHeight` (`machine-picker-entries.ts:265-268`).
- **Anchor:**
  - **Ground truth.** The cited Carbide 3D staff post (topic
    [archived 2023-02-04](https://web.archive.org/web/20230204021025/https://community.carbide3d.com/t/complete-footprint-of-the-shapeoko-3/4190);
    post #7 JSON fetched 2026-10-28) gives "425mm x 425mm (note that Carbide Create limits this to
    406.4 x 406.4mm)". For one machine constrained by its limit switches it gives
    "16⁷⁄₁₆″ total travel; 16½″ side-to-side", which is 417.5 × 419.1 mm.
  - **Ground truth.** Inventables gives the X-Carve "Cuttable Area 29.5 x 29.5 x 4.5 in"
    (749.3 mm; easel.inventables.com, fetched 2026-10-28).
  - **Twin.** Everywhere else the catalogue takes the smaller vendor figure: xTool 20 W 430 × 390
    against the lbdev's 400, the S30's 380 × 385 against Sculpfun's 410 × 400 blog, xTool 40 W
    430 × 348 against 430 × 390, LongMill 810 × 810 inside 818 × 866 (C7 Refuted and Verified clean).
- **Scenario:** A Shapeoko 3 owner picks the preset and places work in the last 6–8 mm of X or Y.
  KerfDesk's bed check accepts it; the measured machine in the vendor's own post cannot reach it,
  so the job ends on a limit switch (or skips steps without one). The X-Carve difference is 0.7 mm.
- **Evidence:** SOURCE + REPRO (`CNC` rows: `shapeoko-3` 425x425, `xcarve-1000` 750x750).
- **Severity:** P3. 425 is the vendor's own published figure, so the value is not invented, and a
  CNC job is placed from a work origin the operator sets; the overshoot is a few millimetres at the
  bed edge. A refuter may argue P1 under "a bed size larger than the machine", but the vendor's
  nominal is 425, and only one measured machine is smaller.
- **Novelty:** C7 re-checked only the LongMill; its "Not verified" left Shapeoko and X-Carve
  un-fetched. Not elsewhere in `docs/audits/`.
- **Refuter:** CONFIRMED for the Shapeoko 3 and **P3 kept**; the X-Carve half is REFUTED.
  - *What would make it false:* the vendor's metric figure is the larger one, or the smaller figure
    is disclosed where the operator picks the preset.
  - *Shapeoko 3:* the Carbide 3D topic JSON was re-fetched (`/t/4190.json`, SHA-256
    `a864ecd6…d89c58a5`).
    - Post 7 (WillAdams, 2017-02-23) reads "Metric: 425mm x 425mm (note that Carbide Create limits
      this to 406.4 x 406.4mm)". The cutting area includes a 2 3/16″ front overhang.
    - For one machine constrained by limit switches it gives "16⁷⁄₁₆″ total travel; 16½″
      side-to-side". The auditor's figures hold.
    - The preset's note already says "Published 425 x 425 mm travel includes front overhang;
      Carbide Create uses 406.4 x 406.4 mm" (`cnc-machine-catalog.ts:117`). Machine Setup shows
      that note with the preset (`DeviceSetupMachineDetails.tsx:117`).
    - So the larger figure is disclosed, and it is the vendor's own nominal. A CNC job is placed
      from the operator's work origin. P3.
  - *X-Carve:* 750 mm is the metric figure for this machine family, and 29.5″ is 750 mm (29.53″)
    rounded to the half inch.
    - voelkner.de listing 9819346, fetched 2026-10-28: "Arbeitsbereich: 750mm x 750mm x 114 mm".
      The 114 mm is the 4.5″ Z of the November 2021 generation.
    - MyBotShop's X-Carve 1000 mm datasheet PDF (SHA-256 `4002f0c7…46eaa2`): "750 x 750 x 65 mm".
    - The 0.7 mm "round-up" is unit rounding, not an invented value. Moved to Refuted.
- **Fix direction:** Use Carbide Create's 406.4 × 406.4 mm (or the measured 417 × 419 mm) for the
  Shapeoko 3 and 749 × 749 mm for the X-Carve, matching the catalogue's smaller-figure rule.

### J8-P3-4 — The Onefinity Woodworker and Journeyman presets ship unsourced legacy sizes where Onefinity publishes the cutting area

- **Where:** `src/core/cnc/cnc-machine-catalog.ts:196-220`: 807 × 765 mm and 1214 × 765 mm, with the
  comment "Retained legacy template; exact model-year travel is not verified" (`:199`) and the note
  "Legacy geometry is unverified for a specific model year". The only sources (`:28-40`) support
  the controller notes, not the sizes.
- **Anchor:**
  - **Contract.** The J8 rule "never invent machining data".
  - **Ground truth.** Onefinity's Woodworker page
    ([archived 2024-07-22](https://web.archive.org/web/20240722231317/https://www.onefinitycnc.com/product-page/woodworkeroriginal)):
    "Woodworker Cutting Area: 32 1/8"(X) x 32 1/8"(Y) x 5 1/4"(Z)", that is 816 × 816 mm. The
    Journeyman is 48 1/8″ × 32 1/8″ (1222 × 816 mm) in retailer listings (MatterHackers, web search
    2026-10-28; no vendor snapshot found).
- **Scenario:** A Onefinity owner picks the preset and gets a bed 9 × 51 mm (Woodworker) or
  8 × 51 mm (Journeyman) smaller than the machine. Work near the front is refused as off the bed.
  No unsafe output.
- **Evidence:** SOURCE + REPRO (`CNC` rows `onefinity-woodworker` 807x765, `onefinity-journeyman`
  1214x765).
- **Severity:** P3: unsourced but in the safe direction, and disclosed.
- **Novelty:** Not raised before; C7 and F4 did not fetch Onefinity.
- **Refuter:** CONFIRMED, **P3 kept**.
  - *What would make it false:* a Onefinity figure of 807 × 765 or 1214 × 765 mm.
  - *Checked:*
    - The Woodworker snapshot (2024-07-22, SHA-256 `b6393e47…ae8856c19`) reads "Woodworker
      Cutting Area: 32 1/8"(X) x 32 1/8"(Y) x 5 1/4"(Z)", that is 816 mm.
    - Neither 807 nor 765 appears in Onefinity's figures. The cited sources (`:28-40`) say they
      "do not verify the retained legacy dimensions".
    - The Journeyman figure was not re-fetched; it rests on the auditor's retailer search.
  - *Severity:* the presets are smaller than the machine (the safe direction), and the code says
    they are unverified.
- **Fix direction:** Use Onefinity's published 32 1/8″ figures (with the model generation named),
  or drop the size presets and keep the controller note.

### J8-P3-5 — README says the CNC side has had informal cuts on a Neotronics 4040; the website copy says no CNC feature has cut material on a real machine

- **Where:**
  - `README.md:29`: "**The entire CNC / router surface** | **Not qualified.** Code + tests, plus
    informal cuts on a Neotronics 4040."
  - `website/pages/cnc-data.mjs:205-207`: "Has KerfDesk cut on a real router?" — "Not yet. … none has
    cut material on a real machine".
  - `website/pages/cnc.mjs:48-49` and `:109`, `website/pages/machines-data.mjs:105`: "haven't run
    on a real router", "No router has run a KerfDesk CNC job".
  - `DECISIONS.md:13005` (ADR-256 Context): "The maintainer, from experience on the physical 4040,
    directed …" the starter feeds.
- **Anchor:** **Twin** (README and website describe the same evidence), against PROJECT.md:285-288
  ("No controller or machine gains physical qualification from software tests").
- **Scenario:** A reader of the README is told the router side has cut real material informally;
  a reader of the CNC page is told it never has. One of the two is wrong. The website's GRBL 1.1 row
  is also "simulator-only" while README:166 says GRBL v1.1 was "Used informally on a Neotronics
  4040".
- **Evidence:** READ.
- **Severity:** P3 doc drift. Neither text claims qualification, and the website errs toward caution.
  The CNC and machines pages are not deployed (rolling v2 22-website, 2026-10-21).
- **Novelty:** Not in 22-website or 24-docs-drift. Website PRs #1280 and #1355 did not touch it.
- **Refuter:** CONFIRMED, **P3 kept**.
  - *What would make it false:* the two texts describe different things, or one has already been
    corrected.
  - *Checked on main:* `README.md:29` and `:166`, `cnc-data.mjs:205-207`, `cnc.mjs:48-49` and
    `:109-111`, and `machines-data.mjs:105`, all as quoted.
  - *Which side is wrong:*
    - ADR-111's Status (DECISIONS.md:5660) records a maintainer directive "after a real 4040 cut
      wandered".
    - `docs/architecture/08-invariants-and-verification.md:123` repeats "informal cuts on a
      Neotronics 4040 (ADR-111)".
    - So the README side has a record. The website copy, and its source `docs/site/machines.md:48`
      ("haven't run on a real router"), understates what happened.
  - *Severity:* neither text claims qualification. P3 doc drift.
- **Fix direction:** Ask the maintainer whether KerfDesk ran CNC cuts on the 4040, then make README,
  the website and PROJECT.md say the same thing.

### J8-P3-6 — The Falcon A1 Pro infrared module note says Creality does not name the source type; Creality's page says "Solid-state laser"

- **Where:** `src/core/devices/laser-modules.ts:23-34`: `technology: 'unknown'` and the note
  "Creality does not say what kind of source it is or whether the air nozzle serves it."
- **Anchor:** **Ground truth.** The A1 Pro product page
  ([archived 2026-09-12](https://web.archive.org/web/20260912014814/https://www.creality.com/products/falcon-a1-pro-20w)),
  2 W section: "Laser Source: Solid-state laser".
- **Scenario:** The note shown with the module is wrong about the vendor's own page. The
  `technology` field has no solid-state value; `unknown` makes the speed slider fall back to the
  CO₂ range only for a machine without the Falcon's profile override (`working-speed-range.ts:33-38`;
  repro `sliderIfNoProfileOverride: 30000`), which the A1 Pro has.
- **Evidence:** SOURCE + REPRO (`IR-MODULE` row).
- **Severity:** P3 (note drift; no output change).
- **Novelty:** C7 "Verified clean" confirmed the modules' power and wavelength, not the note.
- **Refuter:** CONFIRMED, **P3 kept**, with one correction to the scenario.
  - *What would make it false:* the note is right about the source it cites, or Creality's page does
    not say "solid-state".
  - *Checked:*
    - The product snapshot (2026-09-12, SHA-256 `3768fbfb…6e556dc`) reads "2W Infrared Laser
      (optional) Laser Source: Solid-state laser Optical Power: 2W Laser Wavelength: 1064±1nm".
    - The note cites crealityfalcon.com, but "Creality does not say" is a claim about the vendor,
      and creality.com does say it.
  - *Correction:* no UI reader of `laserSubProfile.notes` was found. `LaserModuleRow.tsx` and
    `DeviceSetupMachineDetails.tsx` do not show it. The note travels in saved machine profiles and
    material-library device hints (`material-library-device-hint.ts:170`), so "shown with the module"
    overstates its reach. No output change either way.
- **Fix direction:** Say "Creality lists a solid-state source"; keep `unknown` unless a
  solid-state value is added.

## KNOWN re-observed

- **C7-P3-2 (open).** The S30 evidence note still claims "$22=1, $21=1" and M9 low air
  (`brand-laser-profiles.ts:121`).
- **C7-P3-3 (open).** Brand presets still inherit `maxFeed` 6000 and 500 mm/s²
  (`device-profile.ts:396,412`). The Ortur page still gives "0-20,000mm/min", xTool "400mm/s".
- **C7 Not verified: xTool 40 W depth.** Still contested: 430 × 348 (xTool spec sheet, MatterHackers,
  9to5Toys) against 430 × 390 (xTool UK), per a 2026-10-28 search. KerfDesk takes the smaller.
- **C7: Neotronics S max, origin, firmware and homing unpublished.** The 4040 page (archived
  2026-06-17) names an "offline controller" and limit switches, and no firmware or corner.
- **C7-P2-1, C7-P2-2, C7-P2-3 (fixed by #1385, ADR-660).** The A1 Pro bed correction is in
  `preset-corrections.ts:44-54`; the Ortur rows are `grblhal` (Ortur: "OLF-V2.0 Firmware" on
  "OLM-ESP-PRO-V2.4"); the 400 × 400 fallback is withdrawn (repro `withdrawn: true`).
- **OR-4 (controller audit).** xTool's lbdev sets `EnableGrblJCommand: false`; the profiles keep
  `$J=` and say so in their evidence.
- **F4 K-1.** The chipload chart is a provisional between-sources starter (`feeds-calculator.ts:5-8`).
- **F4 K-2.** 1.588 mm bits take the 1/8″ band.
- **F4 K-5 / FS-2.** The Neotronics CNC starter (300 / 250 / 0.75 mm, 12000 RPM) is labelled
  `unverified-starter` and holds 0.0125 mm/tooth.
- **July 2026 CNC default feeds.** `DEFAULT_CNC_LAYER_SETTINGS` 1000 mm/min, 1.5 mm/pass, 12000 RPM;
  Job Review warns while a layer still has them (`cnc-default-feed-warnings.ts:13-36`).
- **ADR-322 §4.** The A1 Pro's firmware build is unknown (vendor label "GRBL-LPC"). Refuter: one
  third-party A1 Pro `$I` now names it (grblHAL core 20231005, firmware v1.0.4, build 20260706;
  see J8-P3-2). Whether the maintainer's unit runs the same build is still unknown.

## Refuted

Candidates checked and not raised:

- **"The Neotronics paper, card and felt preset is invented."** It equals Creality's A1 Pro table
  for kraft paper, cardboard and felt paper (`90/4000/1`) and cites it.
- **"The 3 mm MDF preset is invented."** xTool's 20 W guide
  ([archived 2025-09-15](https://web.archive.org/web/20250915031739/https://www.xtool.com/blogs/xtool-academy/laser-cut-mdf)):
  "set the power at 100 and speed at 8mm/s. Run two passes" (480 mm/min, 2 passes).
- **"The clear acrylic refusal is unsourced."** xTool article 555
  ([archived 2026-03-10](https://web.archive.org/web/20260310183313/https://support.xtool.com/article/555)):
  "you cannot cut clear acrylic, white acrylic, and blue acrylic".
- **"The A1 Pro bed is X/Y-swapped."** Creality's page gives "268*358mm" without axes; the bundle
  names Width 358, Height 268.
- **"The Genmitsu 4040 RPM should be 10000."** The 10000 column is "Other 4040"; the 4040-PRO column
  is 9000.
- **"The website promises evidence labels Machine Setup does not show."** The chosen-machine panel
  shows `profileConfidenceLabel` (`DeviceSetupMachineDetails.tsx:88`); C7-P3-1 is fixed.
- **"The laser dot's 1 % is invented."** ADR-664 cites Falcon Design Space's "Laser on" (power
  1–10, 30 s countdown).
- **"A new CNC layer's 1.5 mm/pass breaks a small bit silently."** Job Review warns on the untouched
  defaults (KNOWN, above), and the default depth is 1 mm.
- **"The 30 % / 1500 mm/min new-layer default is invented machining data."** It is WORKFLOW's
  contract ("Default values for a new Layer"), the same on every machine, not a material
  recommendation.
- **"Phone or MCP lists machines differently."** No remote, MCP or wizard list exists; Machine
  Setup's list (`machine-picker-entries.ts:57-68`) is built from the two catalogues only.
- **"The Shapeoko 3 XXL is oversized."** "~33″" is 838.2 mm; KerfDesk has 838.
- **Refuter: the X-Carve half of J8-P3-3 ("750 rounds up 29.5 in").** 750 mm is the metric figure
  retailers give for this machine (voelkner.de: "Arbeitsbereich: 750mm x 750mm x 114 mm"; MyBotShop
  datasheet: "750 x 750 x 65 mm"). 29.5″ is 750 mm rounded to the half inch, so the 0.7 mm is unit
  rounding, not an invented or oversized value.
- **Refuter: "J8-P3-2's advice `$152=100` itself rescales Z on the A1 Pro."** Not on the build with
  a published `$$`. The Trinamic plugin accepts only a power of two up to 256, and 100 gets
  `error:3` with no change. The P1 comes from the labelled power-of-two writes, not from the literal
  advice.

## Verified clean

- **Falcon A1 Pro**, every field the vendor bundle carries (work area, mirror, S scale, baud, M8,
  `$HZ1`, `$HX`/`$HY`, no `$J`, no settings fetch), its 600 mm/s, both modules' power and
  wavelength, and the 10000 mm/min slider top (Creality's table tops out at 10000). The bundle
  SHA-256 is unchanged since 2026-09-19.
- **xTool D1 Pro**: the lbdev SHA-256 is unchanged; origin, baud and S scale match; 5/10/20 W areas
  match xTool's table.
- **Sculpfun S30**: 380 × 385 mm, M8 pump, 5 W.
- **Ortur LM3**: all three heads' areas, S0–S1000, default baud 115200, OLF 2.0 on the ESP mainboard,
  head powers.
- **Neotronics 4040**: 400 × 400 × 75 mm, the 500 W spindle's 12000 RPM, the Z-probe, and the
  LT-4LDS-V2's 20 W, 455 nm, 0.16 × 0.18 mm and 40 mm focus.
- **FluidNC template**: S 255 matches v4.0.3's default laser speed map.
- **CNC presets**: Genmitsu 3018-PRO and 4040-PRO areas, 4040-PRO 9000 RPM, Shapeoko XXL 838 mm,
  Carbide Compact Router 30000 RPM, X-Carve Makita 30000 (KerfDesk caps at 24000).
- **Bit catalogue spot checks**: Amana 46280/46282/46284/46286 (tip, angle, length, shank encoded
  in the source URL), Whiteside 1564, Inventables 60°/90° hobby V-bits.
- **Starter coverage**: only the Neotronics profile has laser starters, so no machine is offered
  another machine's presets through the picker (repro `STARTER-COVERAGE`).
- **One list**: ADR-637's picker is the only machine list. It drops generic and withdrawn presets
  (`machine-picker-entries.ts:64-67`), and a CNC preset on top of a listed laser profile restarts
  from the generic starter (`:248-276`), so no brand's values leak under a CNC name.
- **Promises**: in-app text claims no machine "supported" or "tested"; the only such words are
  hedges (".rd … has NOT been verified", "Pause and lift is not qualified"). The website's laser
  and machines copy matches the catalogue's list of presets and says none is qualified.
- **Refuter spot-check: 33 of the auditor's "verified" rows, from 10 vendors and projects, were
  re-checked against sources the refuter fetched itself on 2026-10-28. All 33 hold.**
  - Falcon: 11 rows. xTool: 3. Sculpfun: 3. Ortur: 5. Neotronics and LASER TREE: 5. FluidNC: 1.
    SainSmart: 2. Carbide 3D: 2. Inventables: 1.
  - The verdicts that changed are rows the auditor had not marked verified. The `$150`–`$152` row
    is now wrong (J8-P3-2), and the X-Carve area is now verified.
  - *Creality A1 Pro bundle* (`falcon_a1_pro_(lightburn_2.0.00+).lbzip` from wiki.creality.com,
    SHA-256 `11b13328…f988405b`, the same as the auditor's). Width 358, Height 268, MirrorX/MirrorY
    false, `S_Scale` 1000, `BaudRate` 115200, `AirAssistM7` false, `AllowSettingsFetch` false,
    `EnableGrblJCommand` false, macros `$HX\n$HY\n` and `$HZ1\n`. That covers 7 rows.
  - *Creality A1 Pro product page* (snapshot 2026-09-12, SHA-256 `3768fbfb…6e556dc`). "Engraving
    Area: 268*358mm", "600mm/s", "Optical Power: 20W", "Semiconductor laser", "455±5nm",
    "1064±1nm", "0.03mm ultra-fine". That covers 4 rows.
  - *Creality A1 Pro consumable guide* (SHA-256 `68e8b2d9…8ef09b08`). The fastest entry is brushed
    stainless 90/10000, so the slider top of 10000 holds.
  - *xTool D1 Pro lbdev* (the code's attachment URL, SHA-256 `d03e3021…7fad73f4`, the same).
    MirrorY true, MirrorX false, 230400 baud, S_Scale 1000, `EnableGrblJCommand` false, Width 430,
    Height 400. That covers origin, baud and S, and the 5/10 W area cross-check. The xTool article
    itself answered 403, and Wayback was blocked by then.
  - *Sculpfun S30* (live, WebFetch). "the standard version is 380*385mm", 5 W, "Lightburn M8 Air
    Assist Switch". That covers 3 rows.
  - *Ortur LM3* (snapshot 2026-02-04). LU2-10A 400*400, LU3-20A and LU3-40A 400*380, "S0-S1,000",
    "(Default: 115200)", "OLF-V2.0 Firmware" on "OLM-ESP-PRO-V2.4", and the three power bands.
    That covers 5 rows.
  - *Neotronics 4040 Max* (live, WebFetch). "Working Area : 400x400x75mm", "1 x Z-probe", 500 W
    by default. The spindle snapshot (2022-07-03) gives "Operating Speed: 3000-12000RPM".
  - *LASER TREE LT-4LDS-V2* (snapshot 2026-03-28). 455nm, 40mm focus, 20W(19-21W), 0.16*0.18mm.
  - *FluidNC* `LaserSpindle.cpp` @ `25ae119b` L27-28: "linear from 0=0% to 255=100%".
  - *SainSmart* (live). 3018-PRO "300 x 180 x 45mm"; 4040-PRO "400 x 400 x 78mm" at 9000 RPM.
  - *Carbide 3D.* Post 7 "~33″" (XXL 838); Compact Router "RPM Range 12,000 - 30,000".
  - *Inventables.* "Makita router rated 10,000 to 30,000 RPM"; the X-Carve area is in Refuted.
- **Refuter spot-check, unsourced rows (3).** All still unsourced, and the verdicts hold.
  - *Genmitsu 3018-PRO 10000 RPM.* The live SainSmart page gives no stock spindle RPM, only a
    "drop in 20,000rpm Spindle" upgrade.
  - *Neotronics S max, origin, firmware, homing.* The live page names "Limit switches on X&Y&Z
    Axis" and says "It also stores the home on the controller". It names no firmware, corner or
    S scale.
  - *Onefinity sizes.* See J8-P3-4.

## Not verified

- **Hardware.** No machine was operated. The auditor's open question, whether the A1 Pro implements
  `$150`–`$152` as air settings, now has a third-party answer for one build: firmware v1.0.4,
  build 20260706, where they are microsteps (J8-P3-2). Older or newer A1 Pro builds were not seen.
  The same dump also shows:
  - `$130=363 $131=273`: the firmware's travel, larger than KerfDesk's 358 × 268, which is the safe
    direction;
  - `$22=43` (homing enabled) and `$120/$121=1000` (KerfDesk inherits 500, which is KNOWN C7-P3-3).
  The refuter did not assess what the preset's homing-off setting does against `$22=43`.
- **Sienci LongMill** (Cloudflare challenge, no snapshot) and **Creality Rotary Kit Pro**
  (manuals.plus 403, no snapshot): values rest on C7 and the code's citation.
- **Ortur LM3 manual PDF**: pinned to repo commit `e11b8fc0`, not re-read; the page values above
  come from ortur.net.
- **Sculpfun "Setting Up The Software" blog** (origin, S value): per C7, not re-fetched.
- **Firmware family of the xTool D1 Pro, Sculpfun S30 and Neotronics controller**: no vendor
  publishes it.
- **Tom's Hardware's 0.08 × 0.1 mm A1 Pro spot**: third-party, not re-fetched.
- **Falcon camera geometry** (`fisheye.ts`, `camera-frame-proxy.ts`): measured on the maintainer's
  machine; no vendor figure exists to check against.
- **The bit catalogue beyond six spot checks**, and probe defaults (controller-v2 C2's scope).
- **Generic Marlin, Smoothieware and Ruida templates**: driver semantics belong to C6.

```json
[
  {"id":"J8-P3-1","severity":"P3","area":"catalogue-ground-truth","file":"src/core/material-library/neotronics-4040-presets.ts","line":45,"anchor":"Contract AGENTS.md:21 never invent; Twin starter-catalog.ts:1-6 (each machine its own researched numbers); Ground truth Creality Falcon A1 Pro consumable parameter guide (web.archive.org/web/20260522121137) and LASER TREE LT-4LDS-V2 spot 0.16*0.18 mm (web.archive.org/web/20260328063203)","evidence":"SOURCE + REPRO zz-j8-catalog.test.ts STARTER rows","verdict":"CONFIRMED","known":false,"summary":"Engrave 30%/5000, 3 mm plywood 100%/500 and 3 mm black acrylic 100%/360 carry no source; they equal Creality's Falcon A1 Pro 20 W table (smaller spot) while the starter catalogue and the Starter Presets button present them as researched for the Neotronics 4040. Refuter: confirmed; P3 kept (same energy per mm as the sourced 20 W table; LASER TREE claims 10 mm plywood and 8 mm black acrylic; larger spot under-cuts visibly, no new fire risk)"},
  {"id":"J8-P3-2","severity":"P1","area":"catalogue-ground-truth","file":"src/core/controllers/falcon-command-contract.ts","line":55,"anchor":"Ground truth: Creality Falcon A1 parameter page (web.archive.org/web/20260420210839) vs Falcon A1 Pro GRBL page listing no $150-$152 (web.archive.org/web/20260516212835); grblHAL settings.h @ d7aaee3d L553-L562 ($150-$152 = axis microsteps); Contract AGENTS.md:21; refuter: barebaric/rayforge PR #461 A1 Pro $I/$$ (grblHAL, PLUGIN:Trinamic v0.12, CoreXY, $150-$153=16; fetched 2026-10-28, body sha256 49f2cf09...1db90d0); grblHAL Plugins_motor trinamic.c @ 11c937c8 L121, L245-L259 (power-of-two microsteps, steps_per_mm untouched); Trinamic-library common.c @ 9b304175 L44-L55","evidence":"SOURCE + REPRO (auditor FALCON-WRITES row; refuter zz-j8r-falcon-writes.test.ts)","verdict":"CONFIRMED","known":"partly: ADR-370 Context 1 and Verification (A1 Pro page lists none; unverified)","summary":"The A1 Pro contract admits $150-$152 as air levels 0-100 and Job Review advises $152=100, from the A1 page. An A1 Pro $$ (grblHAL + Trinamic v0.12, CoreXY) shows $150-$153=16: they are X/Y/Z/A microsteps. The literal $152=100 gets error:3 (the remedy fails), but any power-of-two level (1-64) KerfDesk passes after a generic confirm changes microstepping with steps/mm unchanged, so motion and focus scale silently and persistently. Refuter raised P3 to P1 under section 3"},
  {"id":"J8-P3-3","severity":"P3","area":"catalogue-ground-truth","file":"src/core/cnc/cnc-machine-catalog.ts","line":114,"anchor":"Ground truth: Carbide 3D staff post (web.archive.org/web/20230204021025 + post 7 JSON 2026-10-28: 425 nominal, Carbide Create 406.4, one machine 417.5 x 419.1 mm); Inventables 29.5 in (749.3 mm); Twin: catalogue takes the smaller vendor figure elsewhere (xTool, S30, LongMill)","evidence":"SOURCE + REPRO CNC rows","verdict":"CONFIRMED","known":false,"summary":"Shapeoko 3 preset uses 425 x 425 mm where the cited vendor post also gives Carbide Create 406.4 and a measured 417.5 x 419.1 mm machine (disclosed in the preset note). Refuter: X-Carve half refuted (750 mm is the metric listing; 29.5 in is its rounding)"},
  {"id":"J8-P3-4","severity":"P3","area":"catalogue-ground-truth","file":"src/core/cnc/cnc-machine-catalog.ts","line":199,"anchor":"Contract: never invent machining data; Ground truth: Onefinity Woodworker 32 1/8 x 32 1/8 in (web.archive.org/web/20240722231317), Journeyman 48 1/8 x 32 1/8 in (retailer)","evidence":"SOURCE + REPRO CNC rows","verdict":"CONFIRMED","known":false,"summary":"Onefinity Woodworker 807 x 765 and Journeyman 1214 x 765 mm are unsourced legacy values, 8-51 mm smaller than Onefinity's published cutting areas (safe direction, disclosed as unverified)"},
  {"id":"J8-P3-5","severity":"P3","area":"catalogue-ground-truth","file":"README.md","line":29,"anchor":"Twin: README.md:29/166 vs website/pages/cnc-data.mjs:205-207, cnc.mjs:48-49,109, machines-data.mjs:105; DECISIONS.md:13005 ADR-256 Context; PROJECT.md:285-288","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"README says the CNC surface had informal cuts on a Neotronics 4040 (and GRBL v1.1 informal use); the website copy says no CNC feature has cut material on a real machine and labels GRBL 1.1 simulator-only. Refuter: ADR-111 records a real 4040 cut, so the website side understates"},
  {"id":"J8-P3-6","severity":"P3","area":"catalogue-ground-truth","file":"src/core/devices/laser-modules.ts","line":33,"anchor":"Ground truth: Creality Falcon A1 Pro product page 2 W section 'Laser Source: Solid-state laser' (web.archive.org/web/20260912014814)","evidence":"SOURCE + REPRO IR-MODULE row","verdict":"CONFIRMED","known":false,"summary":"The A1 Pro infrared module note says Creality does not name the source type; Creality's page says solid-state; no output change. Refuter: the note is not shown in the UI; it travels in saved profiles and library device hints"}
]
```
