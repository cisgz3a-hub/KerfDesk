# New-user experience audit U1 — U2 Machine setup and connect

- **When:** 2026-11-03 **Tree:** origin/main @ `22dca0a20`
- **Scope:** a beginner who has just unboxed a laser or CNC: finding Machine Setup, choosing the machine, USB drivers and the port, Connect, Home, origin and bed, the saved settings, and changing machines. Code: `src/ui/laser/device-setup/`, `src/ui/state/laser-connect-action.ts`, `src/ui/state/laser-controller-silence.ts`, `src/ui/state/laser-safety-notice.ts`, `src/ui/help/connection-help.ts`, `src/core/devices/*-profiles.ts`, `src/core/devices/profile-catalog.ts`. Governing: ADR-500 (and Amendments 1–2), ADR-637 (and Amendments 1–5), ADR-322 Amendment 3, ADR-375, ADR-228.
- **How:** a production web build of main (`vite build`, served with the repo's COOP/COEP/CSP headers on 127.0.0.1:4911), driven by Playwright in installed Chrome from a clean context per machine (no storage, no project). Each machine is a scripted fake Web Serial port (`zz-u2-fake-serial.js`) that answers as GRBL, grblHAL or Marlin would, with that machine's `$$`, baud, alarm and homing behaviour. The Falcon A1 Pro uses the repo's published dump (`src/__fixtures__/controllers/falcon-a1-pro-dump.ts`). The other dumps are stated assumptions (see `zz-u2-machines.mjs`). No hardware was operated.
- **Counts:** 12 raised → 2 refuted → P1 0 / P2 2 / P3 8 (+ 6 KNOWN re-observed). **After the refuter:** 12 + 1 refuter-raised → 2 refuted (the auditor's own, upheld) → P1 0 / P2 2 / P3 9 (+ 6 KNOWN; KNOWN connect-help recommended P2 for the web app). Refuter: 10 confirmed, 0 refuted, 0 severity changes, 1 new (U2-P3-9).

## Headline

Every machine in scope could be set up by following the app. Listed machines are found by search. For unlisted ones (Falcon 2, Atomstack, a generic diode, Marlin), **My machine isn't listed** and Connect's automatic fill gave a usable bed, firmware and power range. A wrong baud is recovered by **Try other speeds**. No preset was found that would burn at the wrong power or drive the head out of bounds, so there is no P1.

The two P2s are about what happens after setup:
- **U2-P2-1, the stale driver.** The common path is to press Connect first, then pick the machine in the Machine Setup window that opens, then Save. That path leaves the session on the driver it connected with. On a Falcon A1 Pro, **Home then sends `$H` instead of Creality's `$HX`/`$HY`**, and jogs use `$J=`. Review still says "Ready to save… internally consistent", and the toolbar reads "Creality Falcon A1 Pro (vendor command set) · Connected". An Ortur LM3 stays on the stock GRBL driver over grblHAL in the same way.
- **U2-P2-2, the undecoded Home error.** A refused Home shows only "error:5" and advises the operator to "home before continuing". The decoded meaning ("Homing cycle disabled … Set $22=1 first") already exists in the code and is not used.

The most common real-world blocker is a missing CH340 driver, which leaves the browser's port list empty. It is still silent: KerfDesk returns to "Not connected" with no pointer to its own driver help. That was recorded on 2026-07-10 and is listed as KNOWN.

## Beginner journey

Screenshots are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u2\shots\` (abbreviated `shots\` below).

### Creality Falcon A1 Pro (listed; grblHAL with the vendor command set)
1. First launch shows the workspace window, then the corner banner "Generic 400 × 400 mm machine. The bed, power and speeds are guesses until you set up your machine." with **Set up machine** (`shots\a1-01-first-launch.png`, `a1-02-workspace-banner.png`).
2. **Set up machine** opens step 1, "Which machine do you have?". It has a connection strip and a searchable list grouped by brand. The Falcon A1 Pro is first (`a1-03-setup-opened.png`).
3. Connect in the strip goes straight to the fake port. Real Chrome would show its serial chooser here, and nothing on screen explains that chooser beforehand (see Not verified). The strip reads "Found your grblHAL controller · Travel 363 × 273 mm, a 358 × 268 mm work area after the homing pull-off". The fill card lists bed, Z, acceleration and max feed. Two identical "Machine settings detected" toasts sit over the window's title (`a1-04-connected-in-setup.png`).
4. Searching "falcon" shows only the A1 Pro (`a1-21-search-falcon.png`). Picking it shows "Same firmware" and a card: "The connection does not match this setup. Connected as grblHAL; the controller reports grblHAL; this setup uses Falcon A1 Pro (GRBL-compatible commands)", with **Reconnect using selected profile** (`a1-05-picked.png`). A beginner reads three matching words and moves on.
5. Essentials: 358 × 268, origin front left ("+X to your right, +Y away from you"), **Enable Home ($HX then $HY)** ticked, S 1000, laser mode on, M8 air (`a1-06-essentials.png`). Review: "Ready to save. Software configuration is internally consistent." (`a1-07-review.png`). Save.
6. Machine tab: the toolbar reads "Creality Falcon A1 Pro (vendor com… Connected". **Home sends `$H`** (the Home button's title says "Run $H…"), and a jog sends `$J=G91 …` (`a1-22-after-home-jog.png`). After Disconnect and Connect, Home sends `$HX`, `$HY` and the connect sends no soft reset or `$I` (`a1-12-reconnected-home.png`). → **U2-P2-1**.
7. Origin and bed: the canvas marks 0,0 with a red cross at the top-left (rear-left) corner, and the Y ruler counts toward the operator. The machine's 0,0 is front-left (KNOWN L8-P2-6). No head marker is drawn while idle; it appears only during a run (`draw-canvas-motion.ts:69-75`).

### xTool D1 Pro 20 W (listed; 230400 baud, rear-left origin)
1. Toolbar **Connect** on a clean profile opens Machine Setup ("This machine isn't set up yet.") and opens the port at 115200 (`xt-01-connect-wrong-baud.png`).
2. After about 20 s: "Your machine didn't answer. Nothing came back at 115200 baud. The controller may use another speed, or this port belongs to another device." with **Try other speeds**. At the same time the toolbar and the window's sidebar both say **Connected**, and two "Machine stopped answering … Waiting for a fresh controller status…" toasts appear (`xt-02-wrong-baud-after-20s.png`) → U2-P3-3, U2-P3-4.
3. **Try other speeds** finds 230400 and fills the travel (`xt-03-try-other-speeds.png`). Picking **D1 Pro (20 W)** keeps 430 × 390 and explains why: "Work area kept at 430 × 390 mm, as listed … configured travel ($130 × $131) is 432 × 406 mm" (`xt-04-picked.png`). Essentials: rear left, "+Y toward you", Home ($H) off (`xt-05-essentials.png`).
4. After Save, Placement shows Start from **User Origin** with job origin FL (`xt-07-placement.png`). Frame without a set origin opens a native confirm: "User Origin needs a custom work origin. OK: set the work origin at the current head position — the job runs from here…". Accepting it sends `G54 G92 X0 Y0` and frames 0..50 × 0..−40 (`xt-10-frame-after-origin.png`). The status bar adds "Relative view — physical bed position unverified".

### Ortur Laser Master 3 (listed; grblHAL)
1. Toolbar Connect, then pick **Laser Master 3 (LU2-10A, 10 W)** ("Same firmware"). The card reads "Connected as GRBL v1.1; the controller reports grblHAL; this setup uses grblHAL." In `or-01-picked.png` the list stays scrolled to the row, so the card is out of view. In the scripted repro it was in view; it depends on the scroll position.
2. After Save the session stays on the stock GRBL driver over grblHAL (U2-P2-1). Homing is off in the preset, so the Home button is **Set up homing** (`or-02-home-button.png`). Origin tools explain: "Home is off in Machine Setup, so the app only knows a position you give it…" (`or-03-origin-tools.png`).

### Sculpfun S30 (listed)
1. Simulated with a homing lock (`$22=1`, Alarm at boot). Sculpfun's own guide says homing is usually off (C7-P3-2), so this is a worst case. The wizard does not mention the Alarm. After Save the Machine tab shows a clear red card: "Controller reports Alarm … Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe", with **Set up homing** and **$X — Unlock** (`sc-04-machine-tab-alarm.png`). The app read `$22=1` in this session but asks the beginner whether there are switches (KNOWN E2-P3-1).

### Creality Falcon 2 (not listed)
1. Searching "falcon 2" or "falcon2" gives "No machine matches … Choose My machine isn't listed…"; "creality" shows only the A1 Pro, marked "Other firmware" (`f2-01-search-creality.png`).
2. After Connect, **My machine isn't listed** is already chosen, with 400 × 415 from `$130/$131` (`f2-02-not-listed-after-connect.png`). The name field still reads **Default 400×400**. After Save, the toolbar and status bar say "Default 400×400" next to "Bed: 400 × 415 mm" (`f2-03-saved-name-default.png`) → U2-P3-1.

### Atomstack A5 Pro (not listed)
1. Searching "atomstack" gives the same clear "No machine matches" pointer (`at-01-search-atomstack.png`). The not-listed form asks for name, type, work area and firmware, with "Not sure? Most diode lasers and hobby CNC machines run GRBL. Connecting reads the firmware and work area for you." (`at-02-not-listed-form.png`). Essentials and Review are as expected (`at-03-essentials.png`, `at-04-review.png`).

### Generic GRBL diode (not listed)
1. Saved offline as S 0–1000, then connected to a controller reporting `$30=255`. The only notice at connect is "Info: Machine settings detected…" (`gen-01-connect-after-save-s255.png`). Job Review then says "Output power uses the connected controller's $30=255: 100% means S255" (`gen-02-job-review-s255.png`), so the burn power is right (see Refuted).
2. With nothing touched, Next → Next shows Review "Ready to save … internally consistent" on the generic 400 × 400 starter (`gen-03-untouched-review.png`) → U2-P3-2.

### Marlin laser (not listed; 115200 board)
1. Searching "marlin" gives "No machine matches" (`ma-01-not-listed-marlin.png`). Choosing Marlin in the form loads the Marlin starter, so the form's work area changes from 400 × 400 to 300 × 200, S 255, 250000 baud (`ma-06-form-after-marlin.png`).
2. Connect at 250000 shows "didn't answer". The toasts read "Timed out waiting for fresh Idle." and "Wait for the previous controller write and acknowledgement…" (`ma-02-connect.png`). **Try other speeds** finds 115200: "The controller answered but reported no settings KerfDesk maps. Enter the manufacturer values in the next step." (`ma-03-try-speeds.png`). Review: Marlin Inline (modern LASER_FEATURE), S 0–255, 300 × 200 (`ma-05-review.png`).

### Hobby CNC (Genmitsu 3018-PRO; listed CNC preset)
1. Toolbar Connect with `$32=0`: "Machine type set to CNC: laser mode is off ($32=0)". The window title becomes "CNC Machine Setup" (`cnc-01-connect.png`). Picking **3018-PRO** gives a geometry-only disclosure (`cnc-02-picked-3018.png`). Step 2 asks for Safe Z, spindle, coolant and park (`cnc-03-step2.png`).
2. Review shows "Output max / requested Frame feed 1000 / 6000 mm/min" and "Stock 400 × 400 × 6.35 mm" on a 300 × 180 machine. The canvas shows the stock chip "400 x 400 x 6.35 mm" (`cnc-04-review.png`, `cnc-05-saved.png`) → U2-P3-5.

### Failures and help
- **Busy port.** "Couldn't connect. The port is busy or unavailable. Close any other program using the machine…" in the strip and the toolbar (`fail-01-busy-port.png`). Clean.
- **No port chosen** (an empty chooser, e.g. no CH340 driver). The app returns silently to "Not connected", with no toast and no pointer to the driver help (`fail-02-no-port-chosen.png`). KNOWN.
- **No Web Serial** (Firefox/Safari). The toolbar says "Your browser doesn't support WebSerial. Use Chrome, Edge, Brave … or install the Windows desktop app." and Connect is disabled (`fail-04-no-webserial-connect.png`). Clean.
- **Homing off** (`$22=0`, Home ticked in Essentials). "Controller rejected a command (error:5). … home before continuing…" plus a paragraph about an "interrupted-job checkpoint", and three "Error: Home: error:5" toasts (`fail-05-home-error5.png`) → **U2-P2-2**.
- **Help.** Help → "Can't connect? (Troubleshooting)" is a native alert with good CH340/CP210x and port guidance. It ends "Full guide: docs/connection-troubleshooting.md", and it cannot be reached while Machine Setup is open, because the window is modal (`help-01-menu.png`) → U2-P3-6.

### Changing machines later
After Save and a reload, the machine is restored (`ch-01-after-reload.png`, ADR-500 Amendment 1). **Machine details** shows the name, bed and firmware only (`ch-02-machine-details.png`). To change machines, open Machine Setup and pick another row. An untuned profile is replaced at once (`ch-04-switch-to-ortur.png`). There is no list of the operator's own machines; only one last machine is remembered (ADR-500, accepted).

## Findings

### U2-P2-1 — After the first Connect, choosing a listed machine and saving keeps the old driver: the Falcon A1 Pro homes with `$H` and jogs with `$J=`, while Review says "internally consistent" and the toolbar names the Falcon

- **Where:**
  - `src/ui/laser/device-setup/DeviceSetupConnectStep.tsx:187-235`: the only prompt, a card in step 1.
  - `src/ui/laser/device-setup/DeviceSetupReviewStep.tsx:70-73`: "Ready to save / Software configuration is internally consistent".
  - `src/ui/laser/controller-identity-warnings.ts:110-126`: the mismatch is named only in Start's Job Review.
- **What a beginner sees:**
  - They press Connect, or the strip's Connect. Machine Setup opens connected on the starter's driver (GRBL v1.1 or grblHAL).
  - They pick their machine. Step 1 shows "The connection does not match this setup. Connected as grblHAL; the controller reports grblHAL; this setup uses Falcon A1 Pro (GRBL-compatible commands)". To a beginner, all three names agree. The card can also be scrolled out of view under the row they just clicked (`or-01-picked.png`).
  - Review says "Ready to save". After Save, the toolbar reads "Creality Falcon A1 Pro (vendor command set) · Connected".
- **Why it misleads:**
  - Home, jog and Frame follow the live driver, not the saved profile (`controller-identity-warnings.ts:106-109`). On the A1 Pro, Home sends `$H`. Creality's configuration homes with `$HX` then `$HY` (ADR-322 Amendment 3, decision 1). With the published `$44=4 $45=1 $46=2`, `$H` runs a Z cycle first.
  - Jogs send `$J=…`. The Falcon contract jogs with `G1` (`controller-identity-warnings.ts:27-32`, "Creality's A1 Pro configuration uses G1 jogs, no settings read, and $HX then $HY").
  - The first session also sent a soft reset (Ctrl-X), `$I`, `M5` and `M9` at connect. After a reconnect the Falcon contract sends only `$$` and `$G`.
  - On an Ortur LM3, the session stays on the stock GRBL driver over grblHAL, which does not clear grblHAL's error latch (`brand-laser-profiles.ts:181-184`).
  - The first place that names the mismatch is Job Review at Start. Home and jog have already been sent by then.
  - This is the path the repo's own e2e uses (`e2e/first-connect-machine-setup.e2e.ts:48-63`), and it never checks the driver.
- **Evidence:** REPRO, `zz-u2-repro.sh` block P2-1 (output in `zz-u2/repro-out.txt`):
  - A1 Pro: `sentOnHome: ["$H\n","G4 P0.01\n","$G\n"]`, `homeButtonTitle: "Run $H to establish the machine reference…"`, review "Ready to save … internally consistent". After Disconnect and Connect, Home sent `$HX`, `$HY`.
  - Ortur: "Connected as GRBL v1.1; the controller reports grblHAL; this setup uses grblHAL."
  - Screenshots: `a1-05-picked.png`, `a1-07-review.png`, `a1-22-after-home-jog.png`, `a1-12-reconnected-home.png`, `or-01-picked.png`.
- **Related:** controller systems audit 2026-07-26 CS-01 (cross-family profile/driver mismatch, Start permissive). That finding is about Start policy. This one is the first-connect setup path and the Home and jog sent before any Start.
- **Not P1 because:** no wrong burn was shown. Whether `$H`'s Z-first cycle is physically unsafe on an A1 Pro is not verified, because no hardware was used.
- **Fix direction:** on Save, when the live driver or command set differs from the saved profile and the machine is Idle, reconnect with the saved profile, or ask "Reconnect now to use the Falcon A1 Pro commands?" before closing the window. Until then:
  - Review should show the card's state as a warning row: "Connected with the generic grblHAL commands. Home, jog and Frame will use them until you reconnect."
  - The card should say what differs in plain words: "You're connected with the generic grblHAL commands. Your Falcon A1 Pro uses its own Home ($HX then $HY) and jog commands. Reconnect to use them."

**Refuter (2026-11-03):** CONFIRMED, P2 (not raised to P1) because the moves sent are the moves the operator asked for, the out-of-bed moves happen on the right driver too, and a working way out sits on screen at the moment of the mistake.
- **Re-checked on `c93fbb3bc`** (no `src`/`e2e`/`electron` change since `22dca0a20`):
  - The driver mismatch is computed only for the card (`use-find-machine.ts:54-57`), and Save does not reconnect.
  - Review's status uses validation issues only (`DeviceSetupReviewStep.tsx:62-74`).
  - Home sends the live driver's `commands.home` (`laser-home-action.ts:88-91`); the Falcon contract's `home: '$HX\n$HY'` and G1 jogs are `falcon-command-contract.ts:34,84-104`.
  - The vendor bed frame needs the live command set (`native-bed-frame.ts:118-133`).
- **Independent repro** (own driver `zz-u2r-drive.mjs`, production build of `c93fbb3bc` on 4921; shots in `scratchpad\zz-u2r\shots\`). Toolbar Connect on a clean profile, then pick the A1 Pro, Next, Next, Save:
  - The card read "Connected as **GRBL v1.1**; the controller reports grblHAL; this setup uses Falcon A1 Pro (GRBL-compatible commands)" (`r1-a1-picked.png`). On the toolbar path the live driver is stock GRBL, not grblHAL. The auditor's "Connected as grblHAL" comes from the strip's Connect, whose adopt-reconnect runs only on a connection Find opened (`use-find-machine.ts:196-215`). Both paths leave a mismatch.
  - Essentials read "Enable Home ($HX then $HY)". Review read "Ready to save … internally consistent". The toolbar read "Creality Falcon A1 Pro (vendor command set) · Connected".
  - Home sent `$H`, `G4 P0.01`, `$G`, and the Home title read "Run $H…". A jog sent `$J=G91 G21 X10.000 Y10.000 F3000`. So the screen promises `$HX`/`$HY` one step before Home sends `$H`.
  - Job Review at Start named it: "Controller identity mismatch … the active connection uses GRBL v1.1 … Reconnect using the selected profile…". It was one of 5 warnings, "none block the start", and was followed by "The controller-to-bed coordinate mapping is unverified" (`r4-stale-job-review.png`).
- **Worse than reported:**
  - **Out-of-bed warnings are lost.** With the stale driver, a design moved to X 345–395 on the 358 mm bed framed with `$J=G90 … X395.000` and a "Frame complete" toast only (`r3-offbed-stale-frame.png`). Four +X 100 mm jogs took the fake head to X 410 with no toast. On the Falcon contract, the same Frame and jogs are also sent (bounds are advisory, ADR-228), but each comes with a warning: "The Frame reaches X 395 on the bed, past the controller's homed area…" and "Jog target X400.000 … is outside the configured machine bounds…" (`r3-offbed-falcon-frame.png`, `r2-a1-falcon-jog-limit.png`). The stale driver drops them because no vendor frame applies.
  - **Auto-focus gives the wrong advice.** It is refused with "Stock GRBL starts homing on $HZ1 … Choose the Falcon A1 Pro machine profile if this is a Falcon." The beginner has just chosen exactly that profile (`r4-stale-autofocus.png`).
- **Why not P1:**
  1. **Home.** `$H` runs the firmware's own configured cycle. The published dump's `$44=4 $45=1 $46=2` homes Z, then X, then Y (grblHAL semantics, as K3 tabulated, `docs/audits/2026-10-28-rolling-v6/K3-falcon-a1-pro-truth.md:112`). One A1 Pro owner describes the machine's own power-on "auto‑focus/homing sequence" as moving the module down to a Z endstop (Creality forum topic 53721, 2026-09-20, live URL https://forum.creality.com/t/broken-z-axis-alignment-tab-on-brand-new-falcon-a1-pro-homing-failure/53721, fetched 2026-11-03; no archive could be made from this session). So `$H` is a homing motion the machine itself performs, not a novel move. That post is a user report, not Creality documentation. Creality's own wiki pages (FAQ, machine software usage guide) returned only their titles to this session's fetch (they are script-rendered), and web.archive.org could not be fetched. The `.lbdev` Home macro `$HX\n$HY` therefore rests on K3's pinned hash (`9635b931…`) and is **UNVERIFIED** by this refuter. A Z home may leave the head at a different focus height than auto-focus set, but that was not shown.
  2. **Jog and Frame.** The out-of-bed moves are sent on both drivers. The stale driver removes the warning, not the guard, because there is none (ADR-228).
  3. **A way out is in view.** After the pick, the card was in view (top 186 px, bottom 280 px of 768), with an orange primary **Reconnect using selected profile** (`r1-a1-picked.png`). Clicking it, then saving, made Home send `$HX`, `$HY` (refuter repro). Any later Disconnect/Connect or restart also fixes it.
  4. **A warning comes before the burn.** Job Review names the mismatch before Start (jargon, but it says "Reconnect").
- **Other presets and firmware:**
  - **Vendor command sets.** `ControllerCommandSet` has one member, `'creality-falcon-a1-pro'` (`device-profile.ts:47`). No xTool, Sculpfun or Ortur preset has a vendor command set.
  - **Family mismatches.** The grblHAL presets are the A1 Pro and the three Ortur LM3 heads (`falcon-profiles.ts:13`, `brand-laser-profiles.ts:186`). The rest are `grbl-v1.1`, like the starter, so they keep the starter's driver correctly.
  - **Marlin fails safe.** Toolbar Connect to a Marlin board, then **Use detected Marlin in draft** → **Apply to draft** → Save without reconnecting. The card read "Connected as GRBL v1.1; the controller reports Marlin; this setup uses Marlin". After Save, the stock GRBL driver got no status: "Machine stopped answering" with **Reconnect controller**, the jog and Step controls disabled, and nothing sent (`r5-marlin-saved-jog.png`). No wrong move.
- **Fix-card note:** add "Essentials promises `$HX then $HY` while the live driver will send `$H`" and the lost out-of-bed and auto-focus messages to the brief. The auditor's Save-time reconnect covers all of them.

### U2-P2-2 — A refused Home shows "error:5" undecoded and tells the operator to home again; the decoded meaning exists but is not used

- **Where:**
  - `src/ui/state/laser-safety-notice.ts:496-516`: `errorText` is `error:${code}` and the generic advice is "home before continuing".
  - `src/core/controllers/grbl/error-codes.ts:32-35` holds the unused text: "Homing cycle disabled" / "The homing cycle ($H) was refused because homing is not enabled. Set $22=1 first."
  - `src/ui/laser/SafetyNoticeBanner.tsx:62` adds the interrupted-job paragraph.
- **What a beginner sees:**
  - They tick **Enable Home** (Essentials only says "Enable Home only after checking your switches") on a machine whose firmware has homing off, then press Home.
  - A red card appears: "Controller rejected a command. The controller rejected a command (error:5). Check the Laser Log, wait for Idle, and home before continuing if position is uncertain. Rejected line: $H".
  - The card goes on: "This warning is separate from the interrupted-job checkpoint. Reconnecting or resetting the controller does not resume the job…", although no job ever ran. The only button is **I made the machine safe**.
  - Three "Error: Home: error:5" toasts appear as well.
- **Why it blocks:** the advice is to do the thing that just failed. Nothing says homing is off in the firmware, or that the fix is to untick Home in Machine Setup (or set `$22=1` only if switches are fitted). A beginner cannot act on "error:5". This is the area's P2 definition: a message whose words a beginner cannot act on.
- **Evidence:** REPRO, `zz-u2-repro.sh` block P2-3. `shots\fail-05-home-error5.png`.
- **Related:** E2-P3-1 (Home can be ticked although `$22=0` was read). That finding is about the gate; this one is the message after it.
- **Fix direction:** use the decoded entry in the notice and give the action for the context.
  - Wording: "Home was refused: homing is turned off in the controller (error:5). If this machine has no homing switches, turn Home off in Machine Setup and set the origin by hand. If it has switches, homing must be turned on in the controller first."
  - Add **Open Machine Setup**.
  - Show the interrupted-job paragraph only when a checkpoint exists, and show one toast instead of three.

**Refuter (2026-11-03):** CONFIRMED, P2. Two facts in the finding are corrected, and the scope is wider than Home.
- **Re-checked:**
  - `laser-safety-notice.ts:490-517` builds `error:${code}` with generic advice. Home's refusal goes there via `laser-home-action.ts:313-320`.
  - The toast is `report-controller-action-failure.ts:34-41`, `` `${action}: ${reason}` `` with the raw `error:5`.
- **Repro** (own run: generic GRBL, `$22=0`, Enable Home ticked, Save, Home; `r6-error5.png`): the same red card and the same advice.
- **Correction 1: one toast, not three.** The screen shows one "Error: Home: error:5" toast. That was so in the auditor's own `fail-05-home-error5.png` too, and the refuter's de-nested count found one. The auditor's `h.toasts()` matched the toast container and its children (`[class*=toast]`), so the toast was counted three times. The same artefact is behind U2-P3-4's xTool and "three Frame complete" counts.
- **Correction 2: the decoded text is used, but only in the Console.**
  - `presentError` → `laser-transcript.ts:139-150` puts "Homing cycle disabled: The homing cycle ($H) was refused because homing is not enabled. Set $22=1 first." in the Console transcript.
  - The refuter found it there after **Console** (`r6-console.png`), below about 140 `$$` rows that must be scrolled.
  - The notice says "Check the **Laser Log**". No control, panel or menu item has that name; the only on-page "Laser Log" is the notice itself.
  - So the beginner's way out depends on guessing that "Laser Log" means **Console** and scrolling. That keeps it at P2, not P3.
- **Other paths where a raw `error:N` reaches the beginner** (each through `controllerErrorMessage`, plus the action toast):
  - A controller rejection during a job, Frame, jog or command: `laser-error-line.ts:173-190` → `controllerErrorNotice(code, context…)`. Refuter repro: a jog answered `error:15`, GRBL's "Jog target exceeds travel" and the usual soft-limit jog refusal, showed "The controller rejected a jog command (error:15). Wait until the controller reports Idle…", with no word about travel or limits (`r7-jog-error15.png`).
  - Set origin: `laser-origin-transaction.ts:220,226`.
  - Probe recovery: `laser-probe-recovery.ts:98`. Post-job settle: `laser-post-job-settle.ts:180`.
  - Rail action toasts (Home, Jog, Unlock, overrides, air): `report-controller-action-failure.ts:37`.
- The fix card should decode in `controllerErrorMessage` itself, for every context, not only Home. The decoded detail must not be copied unchanged for `error:5`; see U2-P3-9.

### U2-P3-1 — An unlisted machine set up from the automatic fill is saved as "Default 400×400" with a different bed

- **Where:** `src/ui/laser/device-setup/machine-picker-entries.ts:281-300`. Only the untouched starter is renamed to "My machine". A filled draft keeps the starter's name.
- **What a beginner sees:** a Falcon 2 owner connects. The not-listed form is pre-chosen with 400 × 415. They save, and the toolbar and status bar say "Default 400×400 · Bed: 400 × 415 mm". It reads as if setup did not take, and the name contradicts the bed beside it.
- **Evidence:** REPRO, `zz-u2-repro.sh` last block (`toolbar: "…Default 400×400…"`, `status: "Bed: 400 × 415 mm"`). `shots\f2-02-not-listed-after-connect.png`, `f2-03-saved-name-default.png`.
- **Fix direction:** when the fill changes the starter, name it "My machine" (as rule 5 does for the untouched starter) and focus the Name field: "Name your machine (e.g. Falcon 2 22W)".

**Refuter (2026-11-03):** CONFIRMED, P3. The rename is only for the untouched starter (`machine-picker-entries.ts:285-293`, `draftIsUntouchedStarter`). Refuter repro (Falcon 2 fake, toolbar Connect, Review, Save): toolbar "Default 400×400", "Device: Default 400×400", "Bed: 400 × 415 mm" (`r10-falcon2-saved.png`). The name field is editable in step 1, so this is wording, not a block.

### U2-P3-2 — Review says "Ready to save … internally consistent" for the untouched generic starter, or a firmware starter's guessed bed

- **Where:** `src/ui/laser/device-setup/DeviceSetupReviewStep.tsx:63-80`.
- **What a beginner sees:** Next, Next on the untouched starter gives "Ready to save". After Save, the first-run banner that called these values guesses is gone for good (ADR-500 #4, accepted). The same happens with a Marlin starter's 300 × 200 bed, which Marlin cannot report.
- **Evidence:** REPRO, `shots\gen-03-untouched-review.png`, `ma-05-review.png`. The 2026-07-14 acceptance listed "Untouched generic work area and power scale block Finish". Save is not blocked now, which is consistent with ADR-228's no-guard rule, so only the wording is raised.
- **Fix direction:** keep Save enabled, and add a review row: "Work area 400 × 400 mm and power S 1000 are KerfDesk's starter guesses, not read from your machine. Check them against your manual or connect to read them."

**Refuter (2026-11-03):** CONFIRMED, P3.
- `SoftwareStatus` keys only on `machineSetupValidationIssues` (`DeviceSetupReviewStep.tsx:62-74`); nothing marks starter values. Not re-run; the auditor's `gen-03-untouched-review.png` shows it.
- Review does carry a "Before your first run … Software setup does not verify the hardware" aside (`:120-128`). That softens "internally consistent" but does not say the bed and S scale are guesses, so the finding stands as wording.

### U2-P3-3 — The toolbar and the setup sidebar say "Connected" while the window says "Your machine didn't answer"

- **Where:** the toolbar status and `DeviceSetupShell` sidebar, against the strip in `DeviceSetupConnectStep.tsx`.
- **Evidence:** REPRO, `shots\xt-02-wrong-baud-after-20s.png`: "Connected" (green dot) beside "Your machine didn't answer. Nothing came back at 115200 baud."
- **Fix direction:** show "Port open — no answer" until the controller has answered.

**Refuter (2026-11-03):** CONFIRMED, P3. Refuter repro: xTool fake at 230400, toolbar Connect at 115200, 22 s. The strip read "Your machine didn't answer … at 115200 baud", while the setup sidebar showed a green "Connected" and the toolbar "Connected · Connected" (`r9-xtool-wrong-baud-22s.png`). The strip's **Try other speeds** is the primary action beside it, so the contradiction misleads but does not block.

### U2-P3-4 — Duplicate toasts with controller jargon repeat the setup card; on Marlin they speak GRBL ("fresh Idle")

- **Where:** the toast and notice layer (toasts appear twice). Text: "Waiting to retry: Controller must report Idle or Alarm before reading machine settings"; on Marlin "Timed out waiting for fresh Idle."
- **Evidence:** REPRO: `xt-02-…png` (two identical "Machine stopped answering" cards), `ma-02-connect.png`, `a1-04-…png` (two "Machine settings detected"), and three "Frame complete" toasts in the xTool run.
- **Fix direction:** show each toast once. While Machine Setup shows the strip, leave the explanation to the strip. Use plain words: "No answer from the machine yet."

**Refuter (2026-11-03):** CONFIRMED in part, P3.
- **Real:** two identical "Machine settings detected" toasts on the strip-Connect path. The auditor's `a1-04-connected-in-setup.png` shows both; there were two connects, because Find's adopt-reconnect runs. The refuter's toolbar-Connect run showed one (`r1-a1-picked.png`). The jargon ("Waiting to retry: Controller must report Idle or Alarm…", Marlin's "fresh Idle") is real.
- **Not real:** "Two identical 'Machine stopped answering' cards" in `xt-02` and "three Frame complete toasts". `xt-02-wrong-baud-after-20s.png` shows no toast. Those counts came from the nested `[class*=toast]` selector (see U2-P2-2, correction 1). The refuter's de-nested count found one "Frame complete".

### U2-P3-5 — 3018-PRO preset: the stock defaults to 400 × 400 mm on a 300 × 180 machine, and the requested Frame feed (6000) is above the output maximum (1000)

- **Where:** `src/core/scene/machine.ts:299-306` (`DEFAULT_CNC_STOCK` "sized to the 4040 target machine's 400 × 400 mm bed"); the Frame feed comes from the starter's 6000.
- **Evidence:** REPRO, `shots\cnc-04-review.png` ("Output max / requested Frame feed 1000 / 6000 mm/min", "Stock 400 × 400 × 6.35 mm"), `cnc-05-saved.png` (stock chip over a 300 × 180 bed).
- **Fix direction:** when a CNC preset is applied and the stock is still the default, clamp the stock to the work area, and clamp the Frame feed to the output maximum.

**Refuter (2026-11-03):** CONFIRMED, P3 (READ, plus the auditor's REPRO). `DEFAULT_CNC_STOCK` is 400 × 400 × 6.35 (`machine.ts:299-307`). Not re-run. Review prints the 1000/6000 pair itself, so the operator is told, and the output maximum governs. That makes it wording and a default, not wrong output.

### U2-P3-6 — Connection help ends with a repository path, is a native alert, and cannot be reached while Machine Setup is open

- **Where:** `src/ui/help/connection-help.ts:48` ("Full guide: docs/connection-troubleshooting.md"); `src/ui/commands/CommandShell.tsx:121` (`jobAwareAlert`).
- **Evidence:** REPRO: the alert text was captured. A Help menu click with Machine Setup open was intercepted by the modal backdrop (Playwright: "lf-dialog-backdrop intercepts pointer events").
- **Fix direction:** link to the published guide, or drop the line. Offer "Can't connect?" inside the setup strip (this also fixes the KNOWN item below).

**Refuter (2026-11-03):** CONFIRMED, P3. Its first half is KNOWN.
- **KNOWN half.** `connection-help.ts:48` ends "Full guide: docs/connection-troubleshooting.md". The repository path in a native alert is the 2026-07-10 sweep's **S12-F1** ("In-app help points users at docs/ files that are not shipped, from inside a window.alert that cannot link", `docs/audits/2026-07-10-full-sweep-audit.md:1606-1614`), still open.
- **New half.** It cannot be reached while Machine Setup is open. Refuter repro: after a cancelled chooser, Machine Setup stays open, and a click on the Help menu (`summary[data-help-id="menu:help"]`) timed out "waiting for element to be … stable" behind the modal (`r8-help-blocked.png`).

### U2-P3-7 — The Start-from modes are explained only by one combined tooltip

- **Where:** `src/ui/laser/JobPlacementControls.tsx:56`. The four options have no titles. The status bar says "Relative view — physical bed position unverified".
- **What a beginner sees:** "Absolute Coordinates / User Origin / Current Position / Verified Origin". Nothing says that under User Origin the design's place on the canvas is ignored and the job runs from the head (`xt-10-…png` shows the rectangle at canvas X 110 while it framed at the head).
- **Fix direction:** add one line under the select for the chosen mode, e.g. User Origin: "Burns from the origin you set with Set origin here; where the design sits on the canvas does not matter." Absolute: "Burns where the design sits on the bed; needs Home."

**Refuter (2026-11-03):** CONFIRMED, P3 (READ). `JobPlacementControls.tsx:50-64`: one combined `title` on the select, and the `<option>`s carry no titles. Not re-run.

### U2-P3-8 — Several brand families a beginner is likely to own have no row: the Falcon A1, the Falcon 2, Atomstack and any generic diode kit

- **Where:** `src/core/devices/profile-catalog.ts:174-224`.
- **What a beginner sees:** searching "falcon" shows only the A1 Pro, with "Other firmware" shown only after a connect. An A1 (non-Pro) or Falcon 2 owner may pick the A1 Pro. The not-listed path that does work is clear (`at-01-…png`, `f2-01-…png`).
- **Fix direction:** under the search, when a brand matches but the model does not, say: "Only the Falcon A1 Pro is listed. For another Falcon model, choose My machine isn't listed and connect."

**Refuter (2026-11-03):** CONFIRMED, P3 (READ).
- `profile-catalog.ts:174-224` lists one Creality model row. The broad `FALCON_COMPATIBLE_PROFILE` (`:181-189`) is withheld from the picker; it carries a C7-P2-3 note that its 400 × 400 bed is not any Falcon's.
- The not-listed path works, so nothing blocks. The risk is an A1 or Falcon 2 owner picking the A1 Pro. Without the A1 Pro's command set that would be a 358 × 268 bed on a larger machine, a smaller-bed mismatch the canvas shows.

### U2-P3-9 (refuter-raised) — The Console's decode of `error:5` tells a beginner to "Set $22=1 first", with no word about homing switches

- **Where:** `src/core/controllers/grbl/error-codes.ts:29-35` (detail: "The homing cycle ($H) was refused because homing is not enabled. Set $22=1 first."). It is shown by `laser-transcript.ts:146-149` in the Console.
- **What a beginner sees:** after U2-P2-2's refused Home, the only place the meaning is spelled out is the Console line "Homing cycle disabled: … Set $22=1 first." (`r6-console.png`).
  - A beginner whose machine has no switches can type `$22=1` in the Console; nothing in that path asks about switches.
  - Home would then run a homing cycle. GRBL searches for a switch over up to 1.5 × the travel and then raises an alarm, with the head driven against the frame end.
  - Essentials' "Enable Home only after checking your switches" is not on this path.
- **Anchor:** gnea/grbl's own text for error 5 is "Homing cycle failure. Homing is not enabled via settings." (quoted in the code comment at `error-codes.ts:30`). The "Set $22=1 first" advice is KerfDesk's addition.
- **Evidence:** REPRO for the text (`r6-console.png`). The physical effect is not reproduced; no hardware.
- **Severity:** P3. It needs a typed setting write, and the Console write path is an expert surface. It is raised so that U2-P2-2's fix does not copy this detail into the beginner-facing notice.
- **Fix direction:** "Homing is turned off in the controller ($22=0). Turn it on only if the machine has homing switches; otherwise turn Home off in Machine Setup."

## KNOWN re-observed

- **2026-07-10 full sweep, connection failure without a help pointer** (`docs/audits/2026-07-10-full-sweep-audit.md:1620-1624`). Re-observed on `22dca0a20`: a cancelled or empty chooser returns silently to "Not connected" (`laser-connect-action.ts:152-158`). No toast, and neither the strip nor the toolbar mentions drivers or "Can't connect?". REPRO block P2-2: `mentionsDriver: false`, `shots\fail-02-no-port-chosen.png`. For a beginner this is the most likely first-day blocker; recommend the ledger treat it as P2.
  - **Refuter (2026-11-03):** CONFIRMED; agree P2 for the **web app only**.
    - **Web.** `laser-connect-action.ts:152-157` sets `disconnected` and returns, with no toast and no hint. Refuter repro (`picker: 'cancel'`): the strip is back to "Not connected … Connect", the toolbar reads "Not connected", there are no toasts, and no text on the page mentions a driver, CH340 or "Can't connect" (`r8-no-port.png`).
    - **Help on the web is three steps away.** Machine Setup stays open and modal, and the Help menu cannot be clicked behind it (`r8-help-blocked.png`, U2-P3-6). The beginner must close setup, find Help → "Can't connect? (Troubleshooting)", and read a native alert.
    - **Nothing explains the chooser beforehand.** The strip's Connect tooltip (`help-topics.ts:305-308`) and the toolbar command tooltip ("Open the browser serial picker…", `command-help-topics.ts:288`) do not say what to do if the list is empty.
    - **The web cannot tell Cancel from an empty list** (both are `NotFoundError`). So the hint has to be neutral, e.g. "No port was chosen. If your machine wasn't in the list, see Can't connect?".
    - **Silence is the written spec.** WORKFLOW.md:2136-2137 says "App returns to disconnected state, no error surfaced". A fix needs that spec changed in the same PR.
    - **Desktop is clean.** An empty Chromium list keeps the request pending behind a native "No serial ports found" box. It names "(CH340 or CP210x)" and "Help > Can't connect? (Troubleshooting)", with Retry and Cancel (`electron/serial-port-wait.ts:15-20,46-73`, `electron/desktop-serial-chooser.ts:54-65`). Not run; the desktop app was not launched.
    - The 2026-07-10 S12-F2 was MAJOR on that audit's scale. Under AREAS' P2 ("blocks … workaround a beginner could plausibly find"), P2 fits: Help is findable once setup is closed.
- **E2-P3-1** (`docs/audits/2026-10-22-controller-v4/E2-ctl-machine-setup-flow.md`): `$22` is never consulted. Re-observed twice. The Alarm card asks "if the machine has homing switches" after `$22=1` was read (`sc-04-…png`, `settingsRead22: "1"`). Home can be ticked with `$22=0` (leads to U2-P2-2).
- **C7-P3-2** (`docs/audits/2026-10-22-controller-v2/C7-ctl-device-profiles.md:323`): the Sculpfun S30 note still says the firmware ships `$22=1, $21=1` (`brand-laser-profiles.ts:121`), against Sculpfun's guide.
- **L8-P2-6 (P3)**: the canvas origin cross sits top-left (rear-left) for every machine origin, with the Y ruler counting toward the operator. A front-left A1 Pro shows its 0,0 cross at the back (`a1-09-machine-tab.png`).
- **ADR-500 "Remember every machine, with a picker. Not now"** (accepted). A second machine means re-picking the row, which brings catalogue values, or importing an exported profile.
- **Controller systems audit 2026-07-26 CS-01**: Start is permissive on a profile/driver mismatch. This is context for U2-P2-1.
- **Refuter (2026-11-03), on the KNOWN list:**
  - **E2-P3-1 re-observed by the refuter.** `$22=0` was read at connect, yet Essentials let Home be ticked with only "Enable Home only after checking your switches" (`r6-home-ticked.png`).
  - **S12-F1 (2026-07-10) belongs here too,** for U2-P3-6's repository path.
  - The other KNOWN items were not re-run; their code references are unchanged on `c93fbb3bc`.

## Refuted

- **"The Sculpfun S30 preset ships homing off although the machine homes."** Refuted by C7-P3-2's source: Sculpfun's own guide says homing is usually not enabled in the firmware. The preset's homing-off is right. My fake S30 with `$22=1` and an Alarm at boot was a worst case, not stock.
- **"A generic GRBL profile saved at S 1000 burns at the wrong power on a `$30=255` controller."** Refuted: Job Review says "Output power uses the connected controller's $30=255: 100% means S255" (`gen-02-job-review-s255.png`), and output follows the connected scale.
- **Refuter (2026-11-03):** both refutations upheld.
  - **S30:** the preset at `brand-laser-profiles.ts:108-124` sets no `homing`, so it inherits the default homing off. That is consistent with C7-P3-2's Sculpfun source; its stale note at `:121` is the KNOWN item. Not re-fetched.
  - **`$30=255`:** accepted on the auditor's screenshot. Not re-run.

## Verified clean

- The Machine stage leads with one searchable list. A no-match search points to **My machine isn't listed**, and the not-listed form explains GRBL and connecting (ADR-637).
- **Wrong baud:** a clear "didn't answer at N baud" message, then **Try other speeds** found 230400 (xTool) and 115200 (Marlin, from the 250000 starter).
- **Listed machines keep their work area** at connect, with a plain note naming `$130 × $131` (xTool, ADR-637 Amendment 2). The A1 Pro gets 358 × 268 from the published dump with no bed offer (Amendment 4).
- **Preset values** match their sources for the A1 Pro (358 × 268, front-left, homing `$HX`/`$HY`, S 1000, 115200, CoreXY), the xTool D1 Pro (430 × 390, rear-left, 230400) and the 3018-PRO (300 × 180, CNC). No preset was found that drives the head out of bounds or burns at the wrong power.
- **`$32=0` at connect** makes an unlisted draft CNC and says so ("laser mode is off ($32=0)").
- **Busy port:** a plain, actionable message in the strip and the toolbar.
- **No Web Serial:** a toolbar message naming the supported browsers, and Connect is disabled.
- **User Origin without an origin:** Frame offers to set it at the head, then frames from there.
- **Reload** restores the saved machine (ADR-500 Amendment 1).
- **Essentials** explains the origin corner in words ("+X to your right, +Y away from you") and that Save does not run Home.

## Not verified

- **Chrome's own serial chooser** (its wording, the empty-list state, the permission prompt). The fake port's `requestPort` resolves without UI, so whether KerfDesk explains the chooser before it appears was judged from the strip and the tooltips only.
- **The desktop app's port picker**, driver behaviour on Windows, and macOS CH340 re-pick.
- The **background-streaming warning** seen on every connect is an artefact: a fake port cannot move to the worker.
- **Physical effects of `$H` on an A1 Pro** (its Z-first cycle), whether xTool's firmware accepts `$J=`, the real Falcon 2 / Atomstack / Ortur `$$` dumps (assumed), and network (Wi-Fi) connect.
- **Disconnect mid-session and unplug** (U5), Frame and Start beyond the first Frame (U4).

## Refuter summary

- **Refuter:** a fresh agent, 2026-11-03, on `origin/main` @ `c93fbb3bc`. `git diff 22dca0a20 c93fbb3bc -- src e2e electron` is empty.
- **Build and driver:** an own production build (`git archive` of main → `zz-u2r\tree`, `vite build` → `zz-u2r\dist`), served by `zz-u2r-host.mjs` on 127.0.0.1:4921. The tree's `node_modules` junction was removed after use; re-junction it to rebuild. The refuter's own Playwright driver `zz-u2r-drive.mjs` ran on 4922 in installed Chrome, with a clean context per run.
- **Fake port:** the auditor's fake Web Serial, reviewed and copied to `zz-u2r-fake-serial.js`, with two changes:
  - every `G` line updates the G90/G91 state, because the Falcon jog's own `G21 G91` line was ignored and positions under-counted;
  - `jogError: N` answers `$J=` with `error:N`.
- No hardware was operated, and nothing was downloaded or installed.

**Verdicts:** 10 confirmed (2 P2, 8 P3), 0 refuted, 0 severity changes, 1 new P3. The auditor's 2 refutations were upheld. KNOWN connect-help: agree P2, web only.

| ID | Verdict | One line |
|---|---|---|
| U2-P2-1 | CONFIRMED P2 (P1 weighed, not raised) | Reproduced: `$H` and `$J=` after Essentials promised "$HX then $HY". On the toolbar path the live driver is stock GRBL v1.1. Worse than reported: out-of-bed Frame and jog warnings vanish, and Auto-focus says to choose the profile already chosen. Not P1: the moves are the operator's own (the firmware's configured `$H` cycle, requested jogs), the same out-of-bed moves go out on the right driver too (ADR-228), the step-1 card's orange **Reconnect** is in view and works, and Job Review names the mismatch before Start. The only vendor command set is the A1 Pro's; Marlin fails safe ("Machine stopped answering"). |
| U2-P2-2 | CONFIRMED P2, corrected | One toast, not three (selector artefact). The decoded text *is* shown, but only in the Console, under a name ("Laser Log") that appears nowhere else. The raw `error:N` reaches the beginner on job, Frame, jog (`error:15` reproduced), origin, probe and post-job paths and in every rail action toast. |
| U2-P3-1 | CONFIRMED | Reproduced: "Default 400×400" beside "Bed: 400 × 415 mm". |
| U2-P3-2 | CONFIRMED | READ. |
| U2-P3-3 | CONFIRMED | Reproduced: a green Connected beside "didn't answer". |
| U2-P3-4 | CONFIRMED in part | The A1 duplicate "settings detected" is real. The xTool double card and the triple "Frame complete" are a selector artefact. |
| U2-P3-5 | CONFIRMED | READ. |
| U2-P3-6 | CONFIRMED | The modal blocks Help (reproduced). The repository path half is KNOWN S12-F1. |
| U2-P3-7 | CONFIRMED | READ. |
| U2-P3-8 | CONFIRMED | READ. |
| U2-P3-9 | NEW P3 | The Console decode of `error:5` says "Set $22=1 first" with no switch caveat. |

**Unverified anchors:**
- Creality's A1 Pro documentation. Its wiki pages are script-rendered and returned only titles to this session, and web.archive.org could not be fetched. The `.lbdev` Home macro rests on K3's pinned hash.
- The physical effect of `$H` (Z first) on an A1 Pro: one owner report only.
- The desktop empty-port dialog: read, not run.

**Refuter shots** (`scratchpad\zz-u2r\shots\`): `r1-a1-picked`, `r1-a1-review`, `r1-a1-after-jog`, `r1-a1-stale-jog-400`, `r2-a1-falcon-jog-limit`, `r3-offbed-stale-frame`, `r3-offbed-falcon-frame`, `r4-stale-autofocus`, `r4-stale-job-review`, `r5-marlin-applied`, `r5-marlin-saved-jog`, `r6-home-ticked`, `r6-error5`, `r6-console`, `r7-jog-error15`, `r8-no-port`, `r8-help-blocked`, `r9-xtool-wrong-baud-22s`, `r10-falcon2-saved`.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u2\`:

| File | Purpose |
|---|---|
| `zz-u2-fake-serial.js` | Init script: a fake Web Serial machine (GRBL/grblHAL/Marlin; baud, busy, cancel, no-serial, alarm, homing) |
| `zz-u2-machines.mjs` → `zz-u2-machines.json` | The nine simulated machines; the A1 Pro is read from the repo fixture |
| `zz-u2-drive.mjs` | Playwright driver (installed Chrome) on 127.0.0.1:4912; a clean context per machine |
| `host.mjs` | Static host with the production headers on 4911 |
| `zz-u2-repro.sh`, `repro-out.txt` | The finding repros and their output |
| `shots\*.png` | Screenshots cited above |

To rebuild the bundle (the `dist` and `tree` copies were deleted to save space):
1. Copy main's `src`, `public`, `scripts`, `electron`, `index.html`, `package.json`, `tsconfig.json` and `vite.config.ts` into `zz-u2\tree`.
2. Junction `node_modules` to the main checkout's.
3. Use `zz-u2-vite.config.ts`, the fflate alias copied from `zz-u1`. Run `node node_modules/vite/bin/vite.js build --config zz-u2-vite.config.ts --outDir ..\dist`.

```json
[
  {"id":"U2-P2-1","severity":"P2","area":"machine-setup-connect","file":"src/ui/laser/device-setup/DeviceSetupConnectStep.tsx","line":187,"evidence":"REPRO","summary":"First Connect -> pick listed grblHAL machine (Falcon A1 Pro, Ortur LM3) -> Save keeps the connect-time driver: A1 Pro Home sends $H (not $HX/$HY), jogs $J=; Review says internally consistent, toolbar names the Falcon; mismatch named only in step-1 card and Start's Job Review","known":false,"related":["2026-07-26 controller systems audit CS-01"]},
  {"id":"U2-P2-2","severity":"P2","area":"machine-setup-connect","file":"src/ui/state/laser-safety-notice.ts","line":496,"evidence":"REPRO","summary":"Refused Home shows 'error:5' undecoded and advises 'home before continuing', plus an interrupted-job paragraph with no job and three toasts; the decoded 'Homing cycle disabled … Set $22=1' text in error-codes.ts:32 is unused","known":false,"related":["E2-P3-1"]},
  {"id":"U2-P3-1","severity":"P3","area":"machine-setup-connect","file":"src/ui/laser/device-setup/machine-picker-entries.ts","line":281,"evidence":"REPRO","summary":"Unlisted machine set up from the connect fill is saved named 'Default 400×400' beside a 400 × 415 bed","known":false},
  {"id":"U2-P3-2","severity":"P3","area":"machine-setup-connect","file":"src/ui/laser/device-setup/DeviceSetupReviewStep.tsx","line":70,"evidence":"REPRO","summary":"Review says 'Ready to save … internally consistent' for the untouched starter or a firmware starter's guessed bed; nothing says the values are guesses","known":false},
  {"id":"U2-P3-3","severity":"P3","area":"machine-setup-connect","file":"src/ui/laser/device-setup/DeviceSetupConnectStep.tsx","line":null,"evidence":"REPRO","summary":"Toolbar and setup sidebar say Connected while the strip says the machine didn't answer","known":false},
  {"id":"U2-P3-4","severity":"P3","area":"machine-setup-connect","file":"src/ui/state/laser-controller-silence.ts","line":null,"evidence":"REPRO","summary":"Duplicate toasts repeat the setup card with controller jargon; Marlin gets GRBL 'fresh Idle' wording","known":false},
  {"id":"U2-P3-5","severity":"P3","area":"machine-setup-connect","file":"src/core/scene/machine.ts","line":301,"evidence":"REPRO","summary":"3018-PRO preset keeps the 400 × 400 default stock on a 300 × 180 bed and a 6000 Frame feed above the 1000 output max","known":false},
  {"id":"U2-P3-6","severity":"P3","area":"machine-setup-connect","file":"src/ui/help/connection-help.ts","line":48,"evidence":"REPRO","summary":"Connection help ends with a repository path, is a native alert, and is unreachable while Machine Setup is open","known":false},
  {"id":"U2-P3-7","severity":"P3","area":"machine-setup-connect","file":"src/ui/laser/JobPlacementControls.tsx","line":56,"evidence":"REPRO","summary":"Start-from modes explained only by one combined tooltip; nothing says User Origin ignores the canvas position","known":false},
  {"id":"U2-P3-8","severity":"P3","area":"machine-setup-connect","file":"src/core/devices/profile-catalog.ts","line":174,"evidence":"REPRO","summary":"No row or brand-level pointer for Falcon A1/Falcon 2/Atomstack/generic diode; a Falcon search shows only the A1 Pro","known":false},
  {"id":"U2-P3-9","severity":"P3","area":"machine-setup-connect","file":"src/core/controllers/grbl/error-codes.ts","line":34,"evidence":"REPRO","summary":"Refuter-raised: the Console's error:5 decode says 'Set $22=1 first' with no homing-switch caveat; must not be copied into U2-P2-2's beginner notice","known":false,"related":["U2-P2-2","E2-P3-1"]},
  {"id":"KNOWN-2026-07-10-connect-help","severity":"P2 (recommended)","area":"machine-setup-connect","file":"src/ui/state/laser-connect-action.ts","line":152,"evidence":"REPRO","known":true,"summary":"Cancelled/empty port chooser returns silently to Not connected with no driver or Can't connect pointer"},
  {"id":"KNOWN-E2-P3-1","known":true,"summary":"$22 read but never consulted (Alarm card asks about switches; Home tickable with $22=0)"},
  {"id":"KNOWN-C7-P3-2","known":true,"summary":"S30 note still claims $22=1/$21=1"},
  {"id":"KNOWN-L8-P2-6","known":true,"summary":"Canvas origin cross at rear-left for every machine origin"},
  {"id":"KNOWN-ADR-500-one-machine","known":true,"summary":"Only one last machine remembered (accepted)"},
  {"id":"KNOWN-CS-01","known":true,"summary":"Start permissive on profile/driver mismatch"}
]
```
