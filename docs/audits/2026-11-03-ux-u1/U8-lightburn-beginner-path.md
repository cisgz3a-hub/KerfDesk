# New-user experience audit U1 — U8 LightBurn beginner path

- **When:** 2026-11-03
- **Tree:** origin/main @ `930630c3c`. Code was read at `19faee6f1` (`git archive` into `zz-u8\tree`). `git diff --stat 19faee6f1 930630c3c` touches only the SVG white-fill import (#1556, U3-P2-2's fix) and none of the files cited here.
- **Scope:** LightBurn 2.0's documented beginner path (Get Started, pinned at `docs.lightburnsoftware.com/2.0/GetStarted/…`, plus 2.0/2.1 Reference and Troubleshooting pages). Each step is compared with KerfDesk's matching screen, its words and its Learn lesson (`src/ui/tutorials/`). Then the ten most common first-week problems from the LightBurn forum are checked against KerfDesk. Read only: no build, no app run, no LightBurn installed, no hardware. One node script checked the Speed box parser (`zz-u8\zz-u8-speed-entry.mts`, a copy of `src/core/numeric-expression.ts`).
- **Counts:** 5 raised → 0 refuted → **P1 0 / P2 1 / P3 4** (+ 14 KNOWN re-observed). 7 of my own candidates were refuted (see Refuted). **After the refuter:** 5 + 1 refuter-raised → 0 refuted, 0 severity changes → **P1 0 / P2 1 / P3 5** (+ 14 KNOWN). U8-P2-1 is confirmed with corrections, and path (a) is worse than reported; the coordinator should weigh P1.
- **Coordinator (2026-11-03):** U8-P2-1 raised to **P1**: saved as CNC, Start fires `M3 S12000` with a 3 s dwell and unblanked travel, and every warning on that path speaks of a spindle, so a laser beginner is led into an unsafe burn without a warning they would understand. Counts: P1 1 / P2 0 / P3 5.

`SCRATCH` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u8`. All web pages were fetched on 2026-11-03.

## Headline

KerfDesk covers every step of LightBurn's beginner path. At the machine it is safer than LightBurn:
- it reads `$$` at connect;
- output follows the controller's `$30`;
- every travel move carries `S0`;
- Start needs a Frame and goes through Job Review;
- the Speed box shows mm/s next to mm/min.

So three of the forum's classic first-week failures cannot happen the LightBurn way: quarter-power burns from an S-value mismatch, lines burned between letters, and auto-home on a machine without switches.

**Where LightBurn guides better is its written path.** One page walks a beginner from an empty canvas to a finished coaster. It covers safety, settings from the laser's manual, engraving before cutting, focus with the spacer, Start From and Job origin, Frame, and Start. KerfDesk's "Make your first project" stops at **Save**. The same advice is spread over separate lessons, or missing (focus, safety, cut last: U4-P2-1, U4-P2-2, U3-P2-4).

**The one P2, U8-P2-1:** a laser whose controller has laser mode off (`$32=0`, stock GRBL's default) is set up as a **CNC** by Connect's automatic fill. If the beginner switches back to Laser, Job Review says "Enable GRBL laser mode ($32=1) before starting from KerfDesk" with no way to do it. The CNC twin offers a one-click **Send $32=0**. LightBurn's docs tell the user exactly what to type.

**The LightBurn aid most worth copying:** its [First Project](https://docs.lightburnsoftware.com/2.0/GetStarted/FirstProject/) page, as one Learn lesson "Burn your first coaster" (U8-P3-1). It is also the cheapest home for the fixes of U4-P2-1 (safety), U4-P2-2 (focus), U3-P2-1 (starter values) and U3-P2-4 (cut last).

## LightBurn beginner path vs KerfDesk

LightBurn column: its 2.0 Get Started pages, paraphrased (short quotes only). KerfDesk column: the screen and lesson on main.

| # | Step | What LightBurn tells the beginner | What KerfDesk tells the beginner | KerfDesk is |
|---|---|---|---|---|
| 1 | Know your laser, install | [LaserID](https://docs.lightburnsoftware.com/2.0/GetStarted/LaserID/) explains controller families (GCode, DSP, Galvo); [InstallLightBurn](https://docs.lightburnsoftware.com/2.0/GetStarted/InstallLightBurn/) | The download page or the web welcome card (U1). Learn → "Words you'll see" explains G-code, GRBL, homing, origin, Frame and kerf (`project-tutorials.ts:53-121`) | same |
| 2 | Add the laser | [FindMyLaser](https://docs.lightburnsoftware.com/2.0/GetStarted/FindMyLaser/): the Devices window opens on first run, and Find My Laser scans USB. It warns to wait for power-on moves and to close other laser apps. It notes some lasers need drivers (CH340 for many diodes) | A non-blocking first-run card: "The bed, power and speeds are guesses until you…" (`MachineSetupBanner.tsx:46`). Machine Setup has a searchable machine list; **Connect** reads `$$` and fills firmware, baud, work area, power and laser mode, with Undo (`DeviceSetupFoundMachine.tsx:70-99`). The connection lesson says to close other software that owns the port (`machine-setup-tutorials.ts:76`) | **better** (reads the controller), except `$32=0` (U8-P2-1) |
| 3 | Origin and homing questions | GCode lasers are "usually Front Left". A wrong origin flips or mirrors the output. Enable auto-home only with homing switches, or "Error: 9" follows (FindMyLaser) | A bed diagram with +X/+Y arrows and the caption "Front left: +X to your right, +Y away from you" (`BedCornerPicker.tsx:272-279`). The default is front-left (`device-profile.ts:437`). Home is off by default (`:438`), with "Enable Home only after checking your switches" (`DeviceSetupConfirmStep.tsx:67-70`). Nothing says what a wrong corner does | better picture; **worse** on the consequence (U8-P3-3) |
| 4 | Connect | [ConnectingToLaser](https://docs.lightburnsoftware.com/2.0/GetStarted/ConnectingToLaser/): if no port shows, the laser is not plugged in, "isn't powered, or you're missing a driver". Links Drivers and Serial Port pages | Desktop: "No serial ports found", naming CH340/CP210x (`electron/serial-port-wait.ts:15`). Web: silent return to "Not connected" (KNOWN U2-K; open PR #1559 adds a driver hint) | desktop better; web worse (fix in flight) |
| 5 | UI tour, artwork, select and size | [UITour](https://docs.lightburnsoftware.com/2.0/GetStarted/UITour/), CreatingAndImportingArtwork, SelectingMovingSizing | "Find your way around", "Make your first project", "Import artwork" lessons, matching the UI (U1 verified) | same |
| 6 | Colors and layers | [ColorsAndLayers](https://docs.lightburnsoftware.com/2.0/GetStarted/ColorsAndLayers/): each colour is a layer with its own settings | Plain-ink canvas with coloured operations (ADR-620). The Alt peek is undocumented (U3-P3-3) | same (KNOWN) |
| 7 | Cut settings | [CutSettingsBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/CutSettingsBeginner/): the manufacturer is "the best place to begin looking for cut settings". It warns twice about mm/s versus mm/min, and says slower and stronger burns darker | Starter 30 % / 1500 mm/min (`layer.ts:142-146`). The Speed box shows mm/s beside mm/min (`LayerSpeedInput.tsx:18-21,41`). Job Review and Save G-code say "…still using the uncalibrated defaults … Run a material test on scrap" (`uncalibrated-job-warnings.ts:43-45`). No design-time "starter" wording (U3-P2-1→P3), and power/speed tooltips don't explain dose (U3-P3-1) | better on units; worse at design time (KNOWN) |
| 8 | Preview | [PreviewBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/PreviewBeginner/) and First Project: layers run top to bottom, so engrave before you cut | Preview is one click, with paths, fills, rasters and time (U3). Nothing advises cutting last (U3-P2-4) | worse on order (KNOWN) |
| 9 | First material test | [FirstMaterialTest](https://docs.lightburnsoftware.com/2.0/GetStarted/FirstMaterialTest/): built-in Engrave and Cut presets per laser type ("a good starting point"); focus first; centre it on the head; how to read the grid; what to do if nothing cuts; "Never leave a Material Test or any other job running unattended."; watch the slow, high-power cells on flammable stock | Tools → Material Test: Engrave/Cut, a 10 × 10 grid at 1000–3000 mm/min and 10–40 % whichever is chosen (`material-test-draft.ts:47-68`), plus a feed disclosure. The lesson "Compare laser settings on material" (`calibration-tutorials.ts:4-50`) has no safety line, no cut-through advice, and a stale tip | **worse** (U8-P3-2) |
| 10 | Focus | First Project, "Focusing the Laser": diodes use the spacer from the laser's guide | "Manual focus: adjust the laser head by hand." (`FocusJogControls.tsx:23`) | worse (KNOWN U4-P2-2→P3) |
| 11 | Start From and Job origin | [CoordinatesOriginBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/CoordinatesOriginBeginner/): three modes with screenshots and GIFs, a 9-dot Job origin, and Absolute needs a fixed (homed) origin. First Project uses Current Position, centre, with the head jogged to the coaster's centre | Four modes behind one combined tooltip (`JobPlacementControls.tsx:50-58`); a 9-point Job origin grid (`:125-145`); the lesson "Place the job using an origin" in words (`machine-setup-tutorials.ts:151-200`). Frame offers to set the origin when it is missing (U4) | same grid; worse explanation (KNOWN U2-P3-7) |
| 12 | Frame | [FramingBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/FramingBeginner/): bounding-box or rubber-band frame, Laser On When Framing at about 0.25 % for diodes (wear eye protection; never on CO2), and Frame Continuously | Frame is required before Start (ADR-228). Bounding box only (LBG-M03). Low-power framing is in Labs (LBG-M01). The "Artwork centre & LED" dot says "Wear laser safety glasses" (`CentreSelectionButton.tsx:112`) | better gate; fewer options (KNOWN) |
| 13 | Start, Pause, Stop | [JobControl](https://docs.lightburnsoftware.com/2.0/GetStarted/JobControl/): Start sends at once; heed any warning; an optional Job Checklist; Stop is not an E-stop; eye protection, ventilation, fire suppression, never unattended | Job Review before every Start, with warnings. The running bar says "Software controller stop — use the physical E-stop or power isolation for danger." (`LiveMotionBar.tsx:105`). No glasses, fire or stay-with-it words (U4-P2-1) | better review; worse safety words (KNOWN) |
| 14 | Help afterwards | [BeginnerNextSteps](https://docs.lightburnsoftware.com/2.0/GetStarted/BeginnerNextSteps/) links docs, YouTube and the forum. F1 over a control opens its doc page ([Tooltips](https://docs.lightburnsoftware.com/2.0/Reference/UI/Tooltips/)). [Beginner Mode](https://docs.lightburnsoftware.com/2.0/Reference/BeginnerMode) hides expert controls. A [Troubleshooting](https://docs.lightburnsoftware.com/2.0/Troubleshooting/) index is organised by symptom (Wrong Orientation, Wrong Start Location, GRBL Low or No Power…) | In-app Learn and tooltips on every icon (U6). No docs site (G-S18-2), no F1, no laser beginner mode (G-S18-1), no troubleshooting-by-symptom page | worse (KNOWN) |

**Where KerfDesk guides better** (LightBurn's own docs list each as a common failure):
- **Power scale.** The `$30` read at connect sets output, and Job Review says "Output power uses the connected controller's $30=…: 100% means S…" (`connected-laser-power-scale.ts:128`). A mismatch is a readiness warning (`controller-readiness-messages.ts:38-47`). LightBurn leaves S-value max to the user ([GRBLPowerOutput](https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/GRBLPowerOutput/)).
- **Travel moves can't burn.** Every G0 carries `S0` (`grbl-strategy.ts:4`), and the preamble arms `M3/M4 S0` (`:97`). LightBurn relies on `$32=1` for this.
- **Speed units.** The box is mm/min with a live mm/s reading. LightBurn lets either be chosen and warns about mixing them.
- **No surprise homing.** Home is off until ticked, and there is no auto-home on connect.
- **Frame before Start, then Job Review.** LightBurn's Start "will immediately send the project to your laser" (JobControl).
- **Wrong baud and busy port** get plain messages and **Try other speeds** (U2 verified).
- **Ready-made content.** The Design Library ships 67 designs (U1). LightBurn's [Art Library](https://docs.lightburnsoftware.com/2.0/Resources/) is the user's own store.
- **Photo engraving** has a guided window with material recipes and tone calibration (U3 verified), but the lesson doesn't lead there (U6-P3-5).
- **Jogs past the bed warn** (U4).

## Top ten first-week problems

Sources are LightBurn forum threads (read only; date of the first post) and LightBurn's own troubleshooting pages. Reddit could not be reached (see Not verified).

| # | Problem | Sources | KerfDesk status |
|---|---|---|---|
| 1 | **Won't connect:** no port appears (missing CH340 or Espressif driver) | [t/181185](https://forum.lightburnsoftware.com/t/machine-won-t-show-up-in-lightburn/181185) 2025-10-05; [t/173225](https://forum.lightburnsoftware.com/t/new-to-laser-and-light-burn-nothing-works/173225) 2025-06-09; [ConnectingToLaser](https://docs.lightburnsoftware.com/2.0/GetStarted/ConnectingToLaser/) | **Desktop warns:** "No serial ports found", naming CH340/CP210x (`electron/serial-port-wait.ts:15`). **Web: same failure,** silent "Not connected" (KNOWN U2-K, P2). Open PR #1559 adds "It may need its USB driver (CH340 or CP210x)" |
| 2 | **Laser moves but burns wrong:** lines between letters, or no burn in jobs while framing fires. Laser mode `$32=0` | [t/84787](https://forum.lightburnsoftware.com/t/i-can-not-get-my-laser-to-fire-during-the-burn-or-cut-process/84787) 2022-12-13 (fixed by `$32=1`); [t/62809](https://forum.lightburnsoftware.com/t/laser-burn-between-letters/62809) 2022-03-16; [2.1 CNCBasedLasers](https://docs.lightburnsoftware.com/2.1/Troubleshooting/CNCBasedLasers/) | **Prevents travel burns** (G0 `S0`, `grbl-strategy.ts:4`). **Warns in words a beginner can't act on:** with `$32=0` an unlisted laser is set up as CNC, and Job Review's "Enable GRBL laser mode ($32=1)" offers no way to do it → **U8-P2-1** |
| 3 | **Weak burn at 100 %:** S-value max ≠ `$30` (255 vs 1000) | [t/174213](https://forum.lightburnsoftware.com/t/i-installed-lightburn-for-my-sculpfun-c1-the-laser-is-weak-despite-being-on-100/174213) 2025-06-27; [t/57455](https://forum.lightburnsoftware.com/t/speed-and-power-in-light-burn/57455) 2022-01-16; [GRBLPowerOutput](https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/GRBLPowerOutput/) | **Prevents.** Output follows the connected `$30`, and Job Review states the scale (`connected-laser-power-scale.ts:128`). U2 refuted the wrong-power case on screen |
| 4 | **Mirrored or upside-down output:** wrong origin corner | [t/181629](https://forum.lightburnsoftware.com/t/lightburn-engraving-upside-down-and-mirrored/181629) 2025-10-11; [MirroredOrBackwards](https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/MirroredOrBackwards/) | **Mostly prevents.** The default is front-left (`device-profile.ts:437`), listed presets carry sourced origins (U2), and the diagram shows +X/+Y. Nothing says what a wrong corner does or how to check it → **U8-P3-3** |
| 5 | **Starts in the wrong place:** Start From / Job origin confusion | [t/67215](https://forum.lightburnsoftware.com/t/lightburn-will-not-start-burning-from-origin-point/67215) 2022-05-15; [WrongStartLocation](https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/WrongStartLocation/) | **Warns through the mandatory Frame** (not a warning by METHOD G6). Known gaps: Start-from modes explained only by one tooltip (U2-P3-7); the origin silently lost after Abort (U4-P2-3); the canvas cross at the top-left (L8-P2-6) |
| 6 | **"Out of bounds"** or a job past the bed | [t/160422](https://forum.lightburnsoftware.com/t/out-of-bounds-error/160422) 2024-12-23; t/67215 | **Same failure when never homed:** the Frame past the bed says "Frame complete" (KNOWN U4-P2-4). It warns on a jog, and Job Review warns when homed. LightBurn's bounds check also needs homing (U4 refuter) |
| 7 | **Homing alarm** on a machine without switches (ALARM:9, then error:15) | [t/176054](https://forum.lightburnsoftware.com/t/homing-fail-alarm-9/176054) 2025-07-21; FindMyLaser's auto-home warning | **Prevents auto-home:** Home is off by default (`device-profile.ts:438`) and nothing homes on connect. Home ticked with `$22=0` gives a raw `error:5` (KNOWN U2-P2-2, PR #1559). Homing-failure alarms don't ask about switches (U5-P3-3); `$22` is not consulted (E2-P3-1) |
| 8 | **Speed units:** a mm/s recipe typed as mm/min (or the reverse), so no mark, or charring and fire | [t/93884](https://forum.lightburnsoftware.com/t/im-new-and-having-problems-5w-d1-pro/93884) 2023-03-06; [CutSettingsBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/CutSettingsBeginner/) | **Warns** (better than LightBurn): mm/min with a live mm/s reading. But typing "100 mm/s" is refused with "Enter a value in mm…" instead of being converted → **U8-P3-4** |
| 9 | **Photo too dark or muddy** | [t/155606](https://forum.lightburnsoftware.com/t/engraving-way-too-dark-creality-5w-laser-module/155606) 2024-11-05; [t/54491](https://forum.lightburnsoftware.com/t/when-uploading-a-photo-the-preview-is-almost-completely-black-it-engraves-with-no-detail/54491) 2021-12-15 | **Guides, if found:** the Photo engraving window has material recipes, Auto tones and tone calibration (U3), and phone photos preview since #1555. The photo lesson never mentions it (KNOWN U6-P3-5) |
| 10 | **Faint or no mark:** unfocused head, or settings not chosen for the material | [t/40131](https://forum.lightburnsoftware.com/t/focusing-ortur-laser-master-2/40131) 2021-05-03; t/93884; First Project "Focusing the Laser" | **Warns about settings, not focus.** Job Review: "uncalibrated defaults … Run a material test on scrap" (U3-P2-1→P3). Focus is one grey line (KNOWN U4-P2-2→P3). No dose or fire advisory (U3-P3-1), and no glasses / stay-with-it line (U4-P2-1) |

Tally: **prevents** 3 (S-value, travel burns, auto-home); **warns** 4 (desktop connect, origin corner, units, settings); **same failure** 2 (web driver, with its fix open; never-homed off-bed Frame); **warns but can't be acted on** 1 (`$32=0`, U8-P2-1). Focus is guided by neither app on screen.

**Refuter (2026-11-03) on the table:** CONFIRMED except row 2.
- **Row 2's "Prevents travel burns" holds only for a laser profile.** Seen on screen: `G0 X0.000 Y60.000 S0` (`r17-after-start`).
  - When the `$32=0` fill has made the profile a CNC and the beginner saves it, the router post sends `M3 S12000`, `G4 P3.000` and `G0 …` with no `S0` (`r22-cnc-after-start`). With `$32=0`, the beam stays on through rapids, as in the forum thread.
  - Row 2 should read "prevents on the laser path; the CNC path burns travel" (see U8-P2-1's refuter note).
- **Row 2's "Job Review offers no way to act" is right, but the Console works.** `$32=1` typed there writes the setting after a confirm (`r27-console-32`). LightBurn's own page gives the same instruction.
- **Row 3 checked.** `connected-laser-power-scale.ts:128` matches.
- **Row 7 checked.** At connect the fake saw only `$$`, `$I` and `$G`; there was no `$H`.
- **Row 10 checked.** The uncalibrated-defaults row was seen in Job Review (`r15-job-review`).
- **Rows 1, 4, 5, 6, 8 and 9 checked by READ** at the cited lines on main (`electron/serial-port-wait.ts:15`, `device-profile.ts:437-438`, `LayerSpeedInput.tsx:18-21`).
- **Forum threads.** t/84787 was re-fetched; see the U8-P2-1 note: `$32=1` is not proven to be its fix. The other threads were not re-fetched.

## Findings

### U8-P2-1 — A laser whose controller has laser mode off (`$32=0`) is set up as a CNC; switched back to Laser, Job Review says "Enable GRBL laser mode ($32=1)" with no way to do it

- **Where:**
  - **The fill.** `src/ui/laser/device-setup/device-setup-auto-fill.ts:139` takes the type of an unlisted draft from `$32` (`machineKindFromLaserMode`, `:185-194`: `laserMode ? 'laser' : 'cnc'`). The first-run draft is the generic laser (`DEFAULT_DEVICE_PROFILE`), so the first Connect on a `$32=0` laser turns it into CNC. The unit test asserts it (`device-setup-auto-fill.test.ts:100-105`).
  - **The card** (`DeviceSetupFoundMachine.tsx:80-84`): "Machine type set to CNC: laser mode is off ($32=0)". It doesn't say what to do if the machine is a laser.
  - **Back on Laser,** the draft keeps `laserModeEnabled: false`. The checkbox that would make the firmware step offer `$32=1` says "Record that GRBL laser mode ($32=1) is expected. This checkbox does not change controller firmware settings." (`DeviceProfilePowerFields.tsx:84`). The firmware step offers `$32=1` only when that box is ticked (`device-setup-firmware-diff.ts:126`).
  - **Job Review.** The readiness error `laser-mode-disabled` (`controller-readiness.ts:272-274`) reads "Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk." (`controller-readiness-messages.ts:26`). It is shown as a warning, so Start still runs. Only the CNC twin row gets a button: `JobReviewWarnings.tsx:88` renders **Send $32=0** for `CNC_LASER_MODE_ENABLED_MESSAGE` (ADR-180 Amd 6, cited in `JobReviewWarnings.tsx:6`).
- **Scenario:** a generic diode kit flashed with stock GRBL (`$32=0`) → first-run card → **Set up machine** → **Connect**. The card says "Machine type set to CNC". The beginner either:
  - (a) saves, and gets a CNC workspace (Profile operations, bits, Z); or
  - (b) notices, picks **Laser only**, saves, designs, frames, and meets the Job Review line. It names a setting but not where to change it: the box to tick sits in setup, and its tooltip says it changes nothing.

  If they press **Start job** anyway, GRBL "will briefly pause upon any spindle speed or state change" ([gnea/grbl v1.1h laser_mode.md](https://github.com/gnea/grbl/blob/v1.1h.20190825/doc/markdown/laser_mode.md)). Every power change in a Fill or Image stops the head with the beam lit: dark dots at each stop and a much slower burn.
- **Anchor:**
  - **Ground truth.** Lasers ship or arrive with `$32=0`. Stock GRBL's generic default is `#define DEFAULT_LASER_MODE 0 // false` ([gnea/grbl v1.1h defaults.h](https://github.com/gnea/grbl/blob/v1.1h.20190825/grbl/defaults.h)). The forum's "fires while framing, not in the job" laser was fixed by `$32=1` ([t/84787](https://forum.lightburnsoftware.com/t/i-can-not-get-my-laser-to-fire-during-the-burn-or-cut-process/84787), 2022-12-13). LightBurn's page for GRBL lasers tells the user to type `$32=1` in the Console or set it in Machine Settings, so as to "Remove the pause when power output changes." ([2.1 CNCBasedLasers](https://docs.lightburnsoftware.com/2.1/Troubleshooting/CNCBasedLasers/)).
  - **Twin.** Job Review's CNC row offers **Send $32=0**; the laser row offers nothing.
  - **Contract tension.** ADR-637 Amendment 1 item 1 says "`$32` is a setting of the controller, not a measurement of the machine". It keeps that only for listed machines, and leaves an unlisted machine taking "its type from `$32`, with the type question in view" (ADR-637:105-112; ADR-420 decision 5, :65-69). The design is accepted. The finding is that neither screen tells a laser owner what to do.
  - **AREAS P2:** "a message whose words a beginner cannot act on".
- **Evidence:** READ (all lines above at `19faee6f1`), plus the unit test that encodes the CNC switch, plus SOURCE (gnea/grbl pinned to tag `v1.1h.20190825`; LightBurn 2.1 docs; forum thread dated). Not reproduced on screen: no build, by instruction.
- **Severity:** P2. P1 was weighed: the burn is wrong (dwell dots), but Job Review names the setting before Start, so it is warned, just not actionable. The refuter should reproduce the card and the Job Review row with a `$32=0` fake (U2's `zz-u2r-fake-serial.js`).
- **Fix direction** (copy LightBurn's plain instruction, reuse KerfDesk's own twin):
  - **The card,** when `$32=0`: "Your controller has laser mode off ($32=0), so KerfDesk set this up as a CNC. **Is it a laser?** Choose Laser, and KerfDesk will turn laser mode on ($32=1) when you save."
  - **On Laser,** tick the expected-laser-mode box and let the firmware step propose `$32=1`.
  - **In Job Review,** give the laser row a **Send $32=1** button, the twin of **Send $32=0** (ADR-180 Amd 6), with the text "Laser mode is off, so the laser pauses with the beam on at every power change. Send $32=1 to turn it on."

**Refuter (2026-11-03):** CONFIRMED P2, with corrections (one claim refuted, one path worse). Reproduced on screen: own production build of `930630c3c` on 127.0.0.1:4991, the U5 refuter's fake GRBL (`generic` with `$32` set to `0` before the port opens), a clean profile per run, 1366 × 768. Shots in `scratchpad\zz-u8r\shots\`.
- **The card (confirmed).** First-run card → **Set up machine** → **Connect**: "Machine type set to CNC: laser mode is off ($32=0)", and the window title becomes "CNC Machine Setup" (`r3-connected-card`). The card's **Undo** sits under it and restores the laser draft (ADR-420 rule 5, `DeviceSetupFoundMachine.tsx:97-101`), but nothing says to use it if the machine is a laser.
- **Back on Laser: refuted as written.** The draft does *not* keep `laserModeEnabled: false`. On a CNC draft the fill drops `laserModeEnabled` from the patch (`device-setup-accept-detected.ts:88-92`), so the starter's `true` (`device-profile.ts:429`) survives. After **Laser only**: Essentials shows Laser mode **Enabled** ticked (`r5-essentials`), and Review offers "$32 Laser mode — controller 0 → profile 1", **Confirm $32=1**, **Queue $32 for Save** (`r7-review-controller-settings`). But that row is inside a collapsed "Controller settings · Optional · No writes queued" section, behind "I exported and stored the current controller settings backup", while the page header says "Ready to save · Software configuration is internally consistent" (`r6-review`). A beginner who doesn't open "Optional" saves with `$32=0`, as the auditor described.
- **The dead end is on another path.** Choosing a listed laser *first* (Sculpfun S30, manual air) and then **Connect** keeps the type Laser (ADR-637 Amd 1 item 1), but the card says "Laser mode ($32): Enabled → Disabled", Essentials shows the box unticked, Review says "Laser mode Off", and no `$32` row is offered (`r24-s30-then-connect`). Here the setup has no `$32=1` at all; the auditor's description fits this path. Connecting first and then picking the S30 goes back to Laser with "Expected on" and the hidden `$32` row (`r25-connect-then-s30`). No preset sets `$32` off: all laser presets inherit `laserModeEnabled: true` (`device-profile.ts:429,461`; `profile-application.ts:78`), and only the fill copies the reported `$32` in.
- **Job Review (confirmed, slightly weaker than written).** "3 warnings · none block the start"; the row's headline is only "Controller reports $32=0", collapsed; expanded, "Enable GRBL laser mode ($32=1) before starting from KerfDesk." with no button (`r15-job-review`, `r16-row-open`). Missed by the auditor: an inline "Confirm laser settings" block (`laser-mode-start-acknowledgement.ts:10-13`) says "Cancel and re-read the controller information when possible" (re-reading cannot change `$32`) and "Pressing Start job confirms this". **Start job** ran: `M4 S0`, `G0 X0.000 Y60.000 S0`, `G1 X70.000 Y60.000 F1500 S300` (`r17-after-start`).
- **A way out a beginner can find.** Machine panel → **Console** → `$32=1` → **Send** asks "Send persistent controller setting? $32=1", writes it and re-reads `$$` (`r27-console-32`; guard `grbl-setting-write.ts:76-78` allows only `$32=1` on a laser). That is exactly what LightBurn's page tells users to type, so searching the warning text leads there. Machine Settings (`SuperConsoleSettingsPane.tsx:25`) is a second route.
- **Worse than reported: path (a).** Saved as CNC, the workspace says Router, Cut type, Bit, end mill and Spindle RPM (`r19-cnc-workspace`). After **Zero work Z** and **Set origin here**, Job Review says ROUTER with 9 warnings and "Confirm CNC setup … Before starting the CNC spindle" (`r21-cnc-job-review`). **Start job** sent `M3 S12000`, `G4 P3.000`, `G0 X0.000 Y60.000` (no `S0`), `G1 Z-1.000 F300`, then the rectangle. On a diode with `$30=1000`, that is full power (GRBL clamps S to `$30`) held still for 3 s, and the beam stays on through the rapid: laser mode alone makes G0 "always disable the laser" ([laser_mode.md @ v1.1h.20190825](https://github.com/gnea/grbl/blob/v1.1h.20190825/doc/markdown/laser_mode.md)). So the table's "prevents travel burns" (problem 2) holds only on the laser path.
- **What `$32=0` does on the laser path (SOURCE, pinned).** laser_mode.md: "With laser mode disabled, Grbl will briefly pause upon any spindle speed or state change". `gcode.c` @ `v1.1h.20190825` §[4]: with laser mode off, every S change calls `spindle_sync`, which empties the planner (`protocol_buffer_synchronize`, `spindle_control.c`) before setting the new power. Each power change in a Fill or Image therefore stops the head with the old power still on. Dynamic power (M4) is also a laser-mode behaviour, so corners and line ends get constant power. Not measured.
- **Citations.** gnea `defaults.h` @ `v1.1h.20190825`: all 13 default blocks have `#define DEFAULT_LASER_MODE 0 // false` (verified). LightBurn 2.1 CNCBasedLasers: "Type `$32=1` into the Console Window and press Enter" and "Remove the pause when power output changes" (verified). ADR-637 Amd 1 item 1 and ADR-420 rule 5 quotes match `docs/decisions` on main. **Forum t/84787 is weaker than cited.** The thread doesn't isolate `$32=1` as the fix: other settings changed too, and the helper said `$32` "would not have prevented your laser from working". Keep it as a symptom thread, not as proof.
- **Severity.** P1 weighed for both paths. Laser path: the burn is wrong (dwell at power changes), but a warning row and an acknowledgement block reach the beginner before Start, and the Console fix works. Path (a): the output is unsafe (a 3 s full-power stationary beam and burning rapids). But every screen on the way names the mismatch: "CNC Machine Setup", "Save CNC machine setup", the Router menu, "Touch the bit to the stock top", ROUTER, "Before starting the CNC spindle". A diode owner is told before output that the app treats the machine as a router (METHOD §3 lowering rule). Kept P2. **Coordinator:** weigh path (a) against AREAS P1 "a warning they would understand"; the mode labels are clear, but none says "this will fire your laser".
- **Fix direction, added:** the card's CNC line should offer **This is a laser** (Undo plus Laser type plus `$32=1` queued). Review should flag "controller `$32=0`, profile expects 1" in its header, not only under Optional. The laser path's "re-read the controller information" advice should be replaced by the Send `$32=1` action. A CNC profile reached only through `$32=0` from a laser starter could keep the Laser + CNC type question open until it is answered.

### U8-P3-1 — "Make your first project" stops at Save; no lesson takes a beginner from machine to a finished burn, as LightBurn's First Project does

- **Where:** `src/ui/tutorials/project-tutorials.ts:4-52`. The four steps are draw, size and operation, Preview, Save. It ends "Read Machine setup and Frame and Start before preparing a physical run." (`:43`). The run lesson (`run-tutorials.ts:4-55`) covers Frame → Job Review → Start job. The setup, origin, jog and material-test lessons are separate. No lesson mentions a focus gauge or spacer, safety glasses, staying with the laser, or engraving before cutting (`grep -i "spacer|glasses|unattended|first burn" src/ui/tutorials`: no hit).
- **What LightBurn gives:** one page, the [First Project](https://docs.lightburnsoftware.com/2.0/GetStarted/FirstProject/) "WiFi coaster". It has 13 steps in order:
  - safety;
  - text and a QR code;
  - align and group;
  - Fill with settings from the laser's guide ("Check your laser's user guide for recommended settings");
  - a score line;
  - a cut line on its own layer;
  - Preview, noting that engraving runs before cuts;
  - focus with the spacer;
  - Start From Current Position, Job origin centre, head over the coaster;
  - Frame, and what to do if the frame is off;
  - Start.
- **Why it matters:** the beginner who follows KerfDesk's "first project" has a saved file, not a burn. The things U4 found missing on the burn path (U4-P2-1 safety, U4-P2-2 focus), U3's cut order (U3-P2-4) and its "what numbers do I use" (U3-P2-1) are exactly the steps LightBurn's page puts in sequence. No screen is wrong, so this is P3, but it is the cheapest single carrier for those four fixes.
- **Anchor:** LightBurn parity (maintainer rule: "research what LightBurn does and copy"); AREAS question ("…burn it, safely, by following only what the app tells them").
- **Evidence:** READ (lesson files) + SOURCE (LightBurn 2.0 First Project, fetched 2026-11-03).
- **Fix direction:** add a Getting started lesson "Burn your first coaster" (laser only) after "Make your first project", using KerfDesk's names:
  1. **Before you start:** glasses for your laser's wavelength, stay with the laser, something non-flammable under the material, an extinguisher near.
  2. Text plus a circle; Fill for the text.
  3. A Line operation for the cut, then **Engrave first and cut last** (the All operations header).
  4. Power and speed from your laser's manual, or **Tools → Material Test** on scrap.
  5. Focus with the spacer or gauge that came with your laser.
  6. Jog the head to the coaster's front-left corner, **Set origin here**, Start from User Origin.
  7. **Frame job**: is the box on your material?
  8. **Start** → read Job Review → **Start job**.

  Link it from the end of "Make your first project".

**Refuter (2026-11-03):** CONFIRMED P3. On main, `project-tutorials.ts:40-47` ends at "Save your work", with "Read Machine setup and Frame and Start before preparing a physical run." at `:43`. `git grep -i -E "spacer|glasses|unattended|first burn|focus gauge|cut last|engrave first" origin/main -- src/ui/tutorials` finds nothing. LightBurn 2.0 First Project re-fetched. Its headings run Designing → Previewing → Engraving and Cutting (Focusing the Laser, Start From, Framing, Running the Job). "Check your laser's user guide for recommended settings" and "Never run your laser unsupervised." are both verbatim, and the Preview section says engravings are best done before cutting. No screen is wrong, and the separate run lesson exists, so this stays P3.

### U8-P3-2 — Material Test's Cut keeps the engraving ranges (10–40 %, 1000–3000 mm/min), and neither the dialog nor its lesson says how to read the grid, what to do if nothing cuts, or to stay with it

- **Where:**
  - `src/ui/calibration/material-test-draft.ts:47-68`: one default for both modes (`rows/columns 10`, `speedMin 1000`, `speedMax 3000`, `powerMin 10`, `powerMax 40`). `withMaterialTestChoice` (`:144-157`) changes only the axes when the mode switches to Cut.
  - `MaterialTestDialog.tsx:60-115`: no safety or reading text (grep "unattended|scrap|Never": none).
  - The lesson `calibration-tutorials.ts:4-50`. Its tip (`:47`) still says "This generator creates filled engraving swatches", though Cut exists (ADR-497).
- **What LightBurn gives** ([FirstMaterialTest](https://docs.lightburnsoftware.com/2.0/GetStarted/FirstMaterialTest/)):
  - built-in **Engrave** and **Cut** presets per laser type (Diode/CO2);
  - focus first;
  - centre the grid on the head;
  - pick the nicest cell, or the fastest clean cut;
  - if nothing cuts, vary Passes and raise Max Power to 100 %;
  - "Never leave a Material Test or any other job running unattended.";
  - watch the slow, high-power cells on cardboard.
- **Scenario:** a beginner told by Job Review to "Run a material test on scrap" chooses **Cut** to find a through-cut for 3 mm plywood. They get 100 cells at up to 40 % and at least 1000 mm/min. On a diode none cuts through (diode cuts run at a few mm/s: KerfDesk's own comment cites "2-6 mm/s", `working-speed-range.ts:17-18`). The beginner concludes the laser can't cut. Nothing says to raise power, slow down or add passes.
- **Why P3:** nothing burns wrongly; it is guidance on the path Job Review sends the beginner down.
- **Anchor:** LightBurn parity (as above); Twin: KerfDesk's own sourced cut speeds (`working-speed-range.ts:17-18`) against the Cut test's 1000 mm/min floor.
- **Evidence:** READ + SOURCE.
- **Fix direction:**
  - Give Cut its own starting ranges (e.g. 100 % max power, 60–600 mm/min, or passes 1–5), as LightBurn's Cut preset does.
  - Add two lines under the preview: "Engrave: pick the cell you like. Cut: pick the fastest cell that cut right through; if none did, vary Passes and raise Max power." and "Stay with the laser: the slow, strong cells can catch fire."
  - Fix the stale tip.

**Refuter (2026-11-03):** CONFIRMED P3. On main:
- One default serves both modes (`material-test-draft.ts:47-68`), and `withMaterialTestChoice` (`:144-154`) changes only the axes on a mode switch.
- The Cut option's tooltip promises "to find the settings that cut through" (`MaterialTestDialog.tsx:128`), with the same 10–40 % and 1000–3000 mm/min.
- The stale tip is at `calibration-tutorials.ts:47`.
- KerfDesk's own diode cut figure "at 2-6 mm/s" is at `src/core/devices/working-speed-range.ts:18`, not `src/core/job/…`. The path is corrected here.

A way out: the dialog lets **Passes** be an axis (`passesMin/Max` 1–5, `:57-58`), and the draft is remembered (`calibration-draft-storage.ts`). Nothing points a beginner to either. LightBurn 2.0 FirstMaterialTest was re-fetched and checked:
- "Never leave a Material Test or any other job running unattended." is verbatim.
- "two Built-In Presets each for Diode and CO2 lasers, one Cut test, and one Engrave test" is verbatim.
- Its advice to replace Power with Passes and set Max Power to 100.0 % is verbatim.
- It warns about the lowest-speed, highest-power boxes.

Nothing burns wrongly, so this stays P3.

### U8-P3-3 — The origin picker never says what a wrong corner does, or how to check it

- **Where:**
  - `src/ui/laser/BedCornerPicker.tsx:272-279`: the caption "Front left: +X to your right, +Y away from you".
  - `DeviceProfileFields.tsx:37`: the tooltip "Sets the canvas-to-machine coordinate orientation and jog directions. Match the controller's coordinate layout…".
  - `DeviceSetupConfirmStep.tsx:25-27`: "Check these values against your machine or its manual."
  - No text in `src/ui/laser`, `src/ui/machine` or `src/ui/help` mentions mirrored, flipped or upside-down output (grep).
- **What LightBurn gives:** FindMyLaser says GCode lasers' origin is usually front-left and a wrong one flips or mirrors the output. [MirroredOrBackwards](https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/MirroredOrBackwards/) maps each symptom to a corner change (upside down → swap front/back; mirrored → swap left/right).
- **Scenario:** an unlisted laser whose firmware puts 0,0 at the rear-left (xTool's LightBurn file does, `brand-laser-profiles.ts:94`), set up through **My machine isn't listed** with the default front-left. The bounding-box Frame looks right; the text burns upside down. This is the forum's most-repeated orientation thread ([t/181629](https://forum.lightburnsoftware.com/t/lightburn-engraving-upside-down-and-mirrored/181629), 2025-10-11).
- **Why P3:** the default and the listed presets are right (`device-profile.ts:437`; U2 verified), so this reaches only unlisted machines that differ. KerfDesk already has the cheap check: its jog arrows follow the origin.
- **Anchor:** LightBurn parity; Ground truth (forum).
- **Evidence:** READ + SOURCE.
- **Fix direction:** under the picker: "Most diode lasers: Front left. To check: press the right arrow on the jog pad — the head should move right, and the up arrow should move it away from you. If a test burn comes out upside down, choose the other front/back corner; if it is mirrored, the other left/right corner."

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code on main:**
  - The caption is built at `BedCornerPicker.tsx:272-278`; on screen it reads "Front left: +X to your right, +Y away from you" (`r5-essentials`).
  - The tooltip is at `DeviceProfileFields.tsx:37`.
  - The "Check these values…" line is at `DeviceSetupConfirmStep.tsx:25-27`.
  - The xTool preset's origin is `rear-left` at `brand-laser-profiles.ts:94`.
  - A grep for mirror|upside|flipped in `src/ui/laser`, `src/ui/machine`, `src/ui/help` and `src/ui/tutorials` finds only artwork-mirror and probe wording.
- **Ways out lower the reach, not the rating.** A wrong corner reverses the jog arrows, so a beginner who jogs before burning sees the head move the wrong way. A Current Position frame also traces away from the expected side. The finding already relies on this check, which is why it stays P3.
- **Citation.** LightBurn 2.0 MirroredOrBackwards was re-fetched. It reads: "If your engraving is flipped upside down, change whether the origin is in the front or back corners." The left/right advice is its twin.

### U8-P3-4 — The Speed box refuses "100 mm/s" with "Enter a value in mm…" instead of converting it

- **Where:**
  - `src/ui/layers/dimension-entry.ts:11` rewrites only a `/min` suffix.
  - `:21` builds the error "Enter a value in ${unit}: …", with unit `mm` for a speed.
  - `LayerSpeedInput.tsx:87` validates with it.
- **Evidence:** REPRO, `node SCRATCH\zz-u8-speed-entry.mts` (Node 25 type stripping, on a copy of `numeric-expression.ts` at `19faee6f1`):
  - `"100"` → ok 100;
  - `"100 mm/min"` → ok 100;
  - `"100 mm/s"` and `"100mm/s"` → invalid, `"s" isn't a unit or function this box knows`.

  The box would show "Enter a value in mm: "s" isn't a unit or function this box knows."
- **Why it matters:** settings shared on the LightBurn forum and in vendor guides are often in mm/s ("100mm/sec … power somewhere between 10% and 15%" is typical forum advice for a diode photo). KerfDesk's own comment says "Vendor material guides often give speed in mm/s" (`LayerSpeedInput.tsx:18`). The live mm/s reading already protects a beginner who types a bare number and looks. A beginner who types the unit is refused, and told the field takes "mm".
- **Severity:** P3. The value is refused, not mis-read.
- **Anchor:** Twin: the same box accepts `mm/min`, `in/min` and length units (`dimension-entry.ts:4-13`). LightBurn lets the user choose mm/s or mm/min and warns about mixing them ([CutSettingsBeginner](https://docs.lightburnsoftware.com/2.0/GetStarted/CutSettingsBeginner/)).
- **Fix direction:** accept `mm/s` (and `in/s`) in feed boxes and convert ×60 at the input boundary (PROJECT.md non-negotiable 6 allows explicit input conversion). Word the feed error "Enter a speed in mm/min (or type mm/s)".

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code on main.** `dimension-entry.ts:11` and `:21`, and `LayerSpeedInput.tsx:87`, are unchanged on main. The parser copy is identical to main's `numeric-expression.ts` (`diff -q`).
- **Re-run.** Own script `scratchpad\zz-u8r\speed\zz-u8r-speed.mts`:
  - `"100 mm/s"`, `"100mm/s"` and `"100 mm/sec"` are invalid ("s" / "sec" isn't a unit…);
  - `"100"` and `"100 mm/min"` give 100.
- **A way out, which the error doesn't name.** `"100*60"` and `"100 * 60"` give 6000. The Speed box's own tooltip (`LayerSpeedInput.tsx:109`) doesn't mention math; only the size boxes advertise "2*(3+4)". The value is refused, not mis-read, so this stays P3.

### U8-P3-5 (refuter, new) — The setup card keeps saying "Machine type set to CNC" after the beginner sets the type back to Laser

- **Where:** `DeviceSetupFoundMachine.tsx:80-85` renders the line from the fill's record (`summary.machineKind`), not from the draft. Its neighbour `KeptWorkArea` (`:108-141`) does read the draft.
- **Scenario (REPRO, refuter build):** a generic laser with `$32=0`, **Connect**, then either:
  - **Laser only** in "My machine isn't listed" (`r4-laser-only-picked`), or
  - the listed Sculpfun S30 (`r25-connect-then-s30`).

  The setup turns back to "Machine Setup", and the sidebar and Review say Laser. Yet the green "Filled in from your controller" card still says "Machine type set to CNC: laser mode is off ($32=0)", above the **Undo** that would now undo the beginner's own choice as well.
- **Why P3:** the type the beginner set is the one saved; the card is stale wording, not a wrong value.
- **Anchor:** Twin: the same card's work-area note follows the draft (`KeptWorkArea`).
- **Fix direction:** show the type line only while the draft still has the type the fill set, or reword it as "Your controller has laser mode off ($32=0)". This fits U8-P2-1's card fix.

**Refuter (2026-11-03):** raised by the refuter; not independently refuted.

## KNOWN re-observed

**Refuter (2026-11-03):** CONFIRMED as KNOWN. Each ID was checked against its source report or the U4/U2 ledgers; none is re-raised. Two were seen on screen in this run:
- **U4-P2-6:** "The controller-to-bed coordinate mapping is unverified" headed the first Job Review.
- **U4-P2-1:** no safety words in Job Review (`r15-job-review`).

None is re-raised; each is cited where it meets LightBurn's path.
- **U2-K** (web: no driver, silent) and **U2-P2-2** (raw `error:5`): both in open PR #1559.
- **U2-P3-7:** Start-from modes explained only by one tooltip. LightBurn's beginner page uses screenshots and GIFs per mode.
- **U3-P2-1→P3** (starter values) and **U3-P3-1** (no dose/fire advisory): LightBurn's CutSettingsBeginner says the same in words: manufacturer first, slower and stronger burns darker.
- **U3-P2-4:** cut first runs first. LightBurn's First Project says engravings should come before cuts.
- **U4-P2-1:** no safety words on the burn path. LightBurn has them in First Project, FirstMaterialTest, FramingBeginner and JobControl. Its app has only an optional Job Checklist.
- **U4-P2-2→P3:** focus is one grey line. LightBurn's First Project has a focusing step.
- **U4-P2-3:** the origin is lost after Abort. Forum problem 5.
- **U4-P2-4:** the never-homed Frame past the bed says "Frame complete". LightBurn needs homing for its check too.
- **U6-P3-5:** the photo lesson never mentions Photo engraving. Forum problem 9.
- **U6-P2-1→P3 / G-S18-2:** search, and no docs site. LightBurn's F1 opens the control's doc page; KerfDesk has no F1. A KerfDesk F1 could open the matching Learn lesson, but most controls have none, so it is not cheap and not raised.
- **G-S18-1:** no laser beginner mode. LightBurn's Beginner Mode hides Move/Rotate/Shear/Scale toggles, Optimization Settings, Show Laser Position, Cut Selected and Use Selection Origin.
- **LBG-M01 / M03 / M06** (`2026-09-26-lightburn-gap-audit.md:105-110`): Laser On When Framing (low-power), rubber-band frame and Frame Continuously. LightBurn's FramingBeginner teaches all three.
- **E2-P3-1:** `$22` not consulted. Forum problem 7.
- **L8-P2-6:** the canvas origin cross at the top-left for a front-left machine. Forum problem 5.

## Refuted

My own candidates, refuted by reading:
- **"KerfDesk burns lines between letters on a `$32=0` controller, like the forum's LightBurn users."** Every G0 carries `S0` (`grbl-strategy.ts:4`), so travel is beam-off whatever `$32` is. U8-P2-1 is about dwell at power changes and the setup path, not travel.
- **"A `$30`/S-value mismatch burns at a quarter power."** Output follows the connected `$30`, and Job Review says so (`connected-laser-power-scale.ts:128`). U2 refuted the same on screen.
- **"A mm/s recipe is silently read as mm/min, 60× too slow."** A bare number is mm/min, but the mm/s reading sits beside it (`LayerSpeedInput.tsx:18-21,41`). A typed `mm/s` is refused, not mis-read (REPRO above). Kept only as U8-P3-4.
- **"An unlisted diode gets a mirrored burn by default."** The default origin is front-left (`device-profile.ts:437`), LightBurn's own GCode default. Only unlisted machines that differ are exposed (U8-P3-3).
- **"KerfDesk auto-homes a machine without switches, as LightBurn's Auto 'home' can."** Homing is off by default (`device-profile.ts:438`), and there is no auto-home on connect (LBG-M11 not built).
- **"Material Test's Generate destroys the beginner's design."** It replaces the scene in one Undo step (`generated-scene-actions.ts:36-48`, `pushUndo`). The lesson says to save first (`calibration-tutorials.ts:13`).
- **"KerfDesk has no out-of-bounds check at Start where LightBurn has one."** LightBurn's check needs a homed machine (U4 refuter, BasicSettings). The never-homed gap is KNOWN U4-P2-4.

**Refuter (2026-11-03) on these refutations:** all 7 upheld, one with a caveat.
- **Lines between letters:** upheld for a laser profile. On screen, `G0 … S0`. On the `$32=0` CNC path the router post has no `S0` and the beam stays on through rapids. That is U8-P2-1's path (a), not a separate finding.
- **Quarter power:** upheld. `connected-laser-power-scale.ts:128` matches.
- **mm/s silently read as mm/min:** upheld by re-running the parse.
- **Mirrored burn by default:** upheld. The default is front-left (`device-profile.ts:437`).
- **Auto-home:** upheld. The fake saw only `$$`, `$I` and `$G` at connect.
- **Generate destroys the design:** upheld. `generated-scene-actions.ts:36-48` calls `pushUndo`, and the lesson says to save first (`calibration-tutorials.ts:13`).
- **Out-of-bounds at Start:** upheld as KNOWN U4-P2-4.

## Not verified

- **Reddit (r/lightburn, r/laserengraving).** Web search returned no Reddit results; the `site:` filter was ignored. The ten problems rest on LightBurn forum threads and LightBurn's own troubleshooting index, whose page titles match the same ten symptoms.
- **LightBurn itself** was not installed or run. Its Material Test preset values are not in the docs ("a good starting point" only). Its Job Checklist and out-of-bounds prompts are known only from docs.
- **U8-P2-1 on screen:** the CNC card, the switch back to Laser, the Job Review row and the dwell effect were not reproduced. That needs a `$32=0` fake port and a build, skipped to save memory (U7 running). The dwell effect is from GRBL's own document, not measured. *Refuter: now reproduced (all but the dwell, which a fake can't show); see the refuter note under U8-P2-1.*
- **The camera alignment wizard** (`src/ui/camera/calibrate/`) was not compared on screen. It is not a first-week step for most diode owners.
- **The desktop app** (its "No serial ports found" box) was read, not launched.
- **U7** had no report yet; nothing here was checked against it.

## Refuter summary

- **Refuter:** a fresh agent, 2026-11-03, on `origin/main` @ `930630c3c`. `git diff 19faee6f1 930630c3c` touches only the SVG white-fill import, so every cited line holds; each was re-read on main.
- **Build and driver:**
  - One production build: `git archive` of main into `zz-u8r\tree`, with `node_modules` junctioned to the main checkout's. The junction was removed afterwards with `rmdir`.
  - `vite build` (5 GB heap; 3 GB ran out of memory) into `zz-u8r\dist`, served by `zz-u8r-host.mjs` on 127.0.0.1:4991.
  - Playwright in installed Chrome via `zz-u8r-drive.mjs` on 4992, with a clean context per run. Both were stopped after the run.
- **Fake port:** the U5 refuter's `zz-u5r-fake-serial.js` (copied unchanged as `zz-u8r-fake-serial.js`), using the `generic` GRBL 1.1h machine with `$32` set to `0` in its config before the page loads.
- **Limits:** no hardware was operated, and nothing was downloaded or installed. The fake runs no stepper planner, so the `$32=0` dwell was not measured; it rests on gnea/grbl's pinned source.

**Verdicts:** 5 confirmed (1 P2 with corrections, 4 P3), 0 refuted, 0 severity changes, 1 new P3 (U8-P3-5). All 7 of the auditor's refutations were upheld (one caveat). The 14 KNOWN items were confirmed as KNOWN. Top-ten table: row 2 corrected.

| ID | Verdict | One line |
|---|---|---|
| U8-P2-1 | CONFIRMED P2 (P1 weighed; coordinator to weigh path (a)) | Card "Machine type set to CNC: laser mode is off ($32=0)" reproduced. **Refuted:** back on Laser, the draft does *not* keep `$32` off. Essentials shows Enabled, and Review offers **Queue $32 for Save**, but under a collapsed "Optional" with a backup attestation, beside "Ready to save". The true dead end is a **listed laser chosen before Connect**: "Laser mode Off", no `$32` row. Job Review row confirmed: collapsed, no button, plus a "re-read the controller information" acknowledgement that can't help. **Way out:** Console `$32=1` works after a confirm (LightBurn's own advice). **Worse:** saved as CNC, Start sends `M3 S12000`, `G4 P3.000` and rapids without `S0`, so a full-power, 3 s stationary beam and burning travel on a diode. But every screen says Router, spindle and bit. t/84787 doesn't prove `$32=1` was its fix. |
| U8-P3-1 | CONFIRMED | READ + LightBurn First Project re-fetched (quotes verbatim). |
| U8-P3-2 | CONFIRMED | READ + LightBurn FirstMaterialTest re-fetched. The `working-speed-range.ts` path is corrected to `src/core/devices/…:18`. Passes can be an axis, but nothing says so. |
| U8-P3-3 | CONFIRMED | READ + MirroredOrBackwards re-fetched. Reversed jog arrows reveal a wrong corner before a burn. |
| U8-P3-4 | CONFIRMED | Re-run: `mm/s` and `mm/sec` refused; `100*60` accepted, though unadvertised. |
| U8-P3-5 | NEW P3 | The setup card keeps "Machine type set to CNC" after the beginner sets Laser (two paths reproduced). |

**Unverified anchors:** the forum threads other than t/84787 (not re-fetched); the physical dwell under `$32=0` (source only); GRBL's clamping of `S12000` to `$30` (GRBL behaviour, not re-read in `spindle_control.c` this session).

**Refuter shots** (`scratchpad\zz-u8r\shots\`):
- **Laser path:** `r1-first-run`, `r2-setup-open`, `r3-connected-card`, `r4-laser-only-picked`, `r5-essentials`, `r6-review`, `r7-review-controller-settings`, `r8-saved`, `r9-rect`, `r14-framed`, `r15-job-review`, `r16-row-open`, `r17-after-start`.
- **CNC path:** `r18-cnc-step2`, `r19-cnc-workspace`, `r21-cnc-job-review`, `r22-cnc-after-start`.
- **Preset order:** `r24-s30-then-connect`, `r25-connect-then-s30`.
- **Console:** `r26-console`, `r27-console-32`.

The request bodies are `zz-u8r\b1.js`–`b27.js`, posted with `zz-u8r-d.sh`.

```json
[
  {"id":"U8-P2-1","severity":"P2","area":"U8","file":"src/ui/laser/device-setup/device-setup-auto-fill.ts","line":139,"anchor":"Ground truth (gnea/grbl v1.1h defaults.h DEFAULT_LASER_MODE 0; laser_mode.md pause on S change; LightBurn 2.1 CNCBasedLasers; forum t/84787 2022-12-13) + Twin (JobReviewWarnings.tsx:88 Send $32=0 for CNC only) + ADR-637 Amd 1 item 1","evidence":"READ+SOURCE","verdict":"raised","known":false,"summary":"A $32=0 laser is set up as CNC by Connect's fill; back on Laser, Job Review says 'Enable GRBL laser mode ($32=1)' with no action, while the CNC twin gets Send $32=0"},
  {"id":"U8-P3-1","severity":"P3","area":"U8","file":"src/ui/tutorials/project-tutorials.ts","line":43,"anchor":"LightBurn parity: docs 2.0 GetStarted/FirstProject","evidence":"READ+SOURCE","verdict":"raised","known":false,"summary":"'Make your first project' stops at Save; no lesson walks machine to finished burn with safety, settings, cut last, focus, origin, Frame, Start"},
  {"id":"U8-P3-2","severity":"P3","area":"U8","file":"src/ui/calibration/material-test-draft.ts","line":47,"anchor":"LightBurn parity: docs 2.0 GetStarted/FirstMaterialTest; Twin working-speed-range.ts:17-18","evidence":"READ+SOURCE","verdict":"raised","known":false,"summary":"Material Test Cut keeps 10-40 % / 1000-3000 mm/min; no reading, cut-through or stay-with-it guidance; stale lesson tip"},
  {"id":"U8-P3-3","severity":"P3","area":"U8","file":"src/ui/laser/BedCornerPicker.tsx","line":278,"anchor":"LightBurn parity: docs 2.0 FindMyLaser, Troubleshooting/JobQuality/MirroredOrBackwards; forum t/181629 2025-10-11","evidence":"READ+SOURCE","verdict":"raised","known":false,"summary":"Origin picker never says a wrong corner mirrors or flips the burn, or how to check it with the jog arrows"},
  {"id":"U8-P3-4","severity":"P3","area":"U8","file":"src/ui/layers/dimension-entry.ts","line":11,"anchor":"Twin: same box accepts mm/min, in/min; LightBurn 2.0 CutSettingsBeginner units","evidence":"REPRO","verdict":"raised","known":false,"summary":"Speed box refuses '100 mm/s' with 'Enter a value in mm' instead of converting x60"},
  {"id":"U8-P3-5","severity":"P3","area":"U8","file":"src/ui/laser/device-setup/DeviceSetupFoundMachine.tsx","line":80,"anchor":"Twin: KeptWorkArea in the same card reads the draft","evidence":"REPRO","verdict":"raised (refuter)","known":false,"summary":"Setup card keeps 'Machine type set to CNC: laser mode is off ($32=0)' after the beginner sets Laser or picks a listed laser"}
]
```
