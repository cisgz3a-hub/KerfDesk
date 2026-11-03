# New-user experience audit U1 — U4 First burn

- **When:** 2026-11-03 **Tree:** origin/main @ `c93fbb3bc` (`git diff 22dca0a20 c93fbb3bc -- src e2e electron` is empty, so this is the same app U1–U3 audited).
- **Scope:** a beginner with a generic GRBL diode laser (simulated) and a design of text plus a rectangle (Fill and Line) doing a first burn by following only the screen: focus, origin and position, Frame, Start and Job Review, the burn itself (progress, Pause, Resume, Abort), what happens when it goes wrong (part off the bed, wrong origin, USB pulled, limit alarm, door, Start twice), and repeating the job. Code: `src/ui/laser/` (JobActionControls, job-review/, LiveMotionBar, FocusJogControls, AlarmRecoveryActions, start-blocked-setup-offers, frame-dispatch-support), `src/ui/state/` (laser-safety-notice, laser-jog-warnings, frame-homed-area-warning, laser-status-position, native-bed-frame), `src/core/controllers/grbl/alarm-codes.ts`, `src/ui/help/safety-notice.ts`. Governing: ADR-224, ADR-228 (+ Amendment), ADR-230, ADR-237, ADR-053, ADR-212, ADR-367, ADR-637 Amendment 5.
- **How:** an own production web build of `c93fbb3bc` (`vite build` into `zz-u4\dist`, served with the repo's COOP/COEP/CSP headers on 127.0.0.1:4941), driven by Playwright in installed Chrome from a clean context per run (`zz-u4-drive.mjs` on 4942). The machine is **the repo's own GRBL simulator** (`src/__fixtures__/controllers/grbl-simulator.ts` with its reducer, RX ring and a 15-block planner with back-pressure), bundled for the browser behind a fake Web Serial port (`zz-u4-sim.js`). It answers `$$`/`$I`/`$G`, streams with real `ok` back-pressure, holds on `!`/0x84, resumes on `~`, raises `ALARM:3` on a reset during motion, and can be given `ALARM:1`, a door input and a pulled cable. One change to the simulator: no planner block retires while it is in Hold or Door (`zz-u4\simsrc\grbl-sim-backpressure-u4.ts`). Two machines: generic GRBL 1.1h, 400 × 400 mm, `$32=1`, `$30=1000`, **homing off** (`$22=0`, the common cheap diode); and the same with **homing on** (`$22=1`, Alarm at power-up). Both set up through **My machine isn't listed** as U2 found. No hardware was operated.
- **Counts:** 14 raised → 0 refuted → P1 0 / P2 6 / P3 8 (+ 8 KNOWN re-observed). 5 of my own candidates refuted (see Refuted).
- **Counts after the refuter:** 14 raised → 0 refuted → **P1 0 / P2 5 / P3 9** (+ 8 KNOWN upheld). 13 confirmed at their severity, 1 severity change (U4-P2-2 → P3). The three P1 candidates (U4-P2-1, P2-3, P2-4) stay P2. No new finding. See [Refuter summary](#refuter-summary).

## Headline

A beginner **can** complete a first burn by following the screen: Set origin here → Frame job → Start → Job Review → Start job → burn → "Job complete", and repeat it or place a second copy. Start pressed twice streams once, Pause turns the beam off and Resume continues, Abort resets the controller (beam off), and a job ends with `M5` and a return to the origin. No P1 was reproduced.

What a beginner is **not** told is the problem:
- **U4-P2-1, safety.** Between installing and a 16-minute fill burn, nothing on the beginner's path says to wear laser glasses, watch for fire or stay with the laser. With "Laser mode verified" the Job Review has no safety section at all. The app's own "Never leave a running machine unattended" sits in Help → Safety & liability and About.
- **U4-P2-2, focus.** The only focus guidance is one grey line under the jog pad: "Manual focus: adjust the laser head by hand."
- **U4-P2-3, after Abort.** Every Abort shows "Alarm 3: Reset during motion … Position is lost. Re-home the machine ($H)" on a machine with no homing, never says the laser is off, and the origin the beginner set is silently gone. The next Frame offers to set the origin wherever the head stopped, and the re-run lands 69 mm away from the first.
- **U4-P2-4, off the bed.** A Frame that runs 75 mm past the end of a 400 mm bed reports "Frame complete". A jog to the same place warns.
- **U4-P2-5,** Unlock then Frame dead-ends with "Wait for a complete status report", and **U4-P2-6,** the Job Review's warnings for a first job are four expert notes, one of them about a Neotronics 4040.

The single change that would make the first burn safer: **one plain "Before you start" block in Job Review** (glasses, focus, stay with it, fire) and a beginner-worded alarm after Abort that says the laser is off and the origin must be set again. Under ADR-228 rule 7 both are warnings, not new guards.

## Beginner journey

Screenshots are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u4\shots\` (abbreviated `shots\` below). G-code and serial lines are from the simulator's log (`window.__U4.events`).

### A. Setup and design (no homing)
1. First launch: the "Generic 400 × 400 mm machine … guesses" banner with **Set up machine** (`shots\01-first-launch.png`).
2. Set up machine → Connect → "Found your GRBL controller … Travel 400 × 400 mm … Power S 0–1000 · Laser mode on" → **My machine isn't listed** → Next → Next → Review "Ready to save" with a **Hardware commissioning checklist** that mentions "focus method, enclosure, interlocks, and exhaust" once → Save (`02-setup-connected.png`, `04-essentials.png`, `05b-review-checklist.png`, `06-after-save.png`).
3. Draw a rectangle (Line) and type HELLO, switch it to Fill and make it 90 mm wide. The status bar adds the red "Relative view — physical bed position unverified" (`07-rect.png`, `09-text-fill.png`). Estimate ≈ 16 min.

### B. Focus
4. The only focus words on screen: "Manual focus: adjust the laser head by hand." under the jog pad, and a **Set up auto-focus** button that opens Machine Setup (`06-after-save.png`). Ctrl+K "focus" finds only **Focus Test…**, which "Requires controllable Z" (`61-search-focus.png`). The Materials tab is an empty material library (`12-materials-tab.png`). Nothing mentions material thickness or a focus gauge, and neither Frame nor Job Review mentions focus → **U4-P2-2**.

### C. Origin and position
5. Placement shows **Start from: User Origin**, Job origin **FL** (`10-placement.png`). Nothing on the canvas changes with it (KNOWN U2-P3-7).
6. **Frame job** with no origin: a native confirm "User Origin needs a custom work origin. OK: set the work origin at the current head position — the job runs from here…". Cancel leaves the toast "Click "Set origin here" first." (`13-frame-no-origin-dismissed.png`).
7. Jog +X+Y 5 × 10 mm (`$J=G91 G21 X10.000 Y10.000 F3000`). There is no position readout; a red dashed travel line from the head is the only hint of where the head is (`14-jogged.png`). **Set origin here** → `G54 G92 X0 Y0`, "Origin set to current head position (G92)". The red "Last Frame attempt blocked" banner stays (`15-origin-set.png`) → U4-P3-6.

### D. Frame
8. **Frame job** → `M5`, `M9`, then `$J=G90 G21` to (0,0), (124.887,0), (124.887,116.9), (0,116.9), (0,0) at F6000. Beam off throughout. Toast "Frame complete — press Start to review and run…" (`17-framed.png`). The button's title says "Trace the job's generated motion envelope with the tool off" → U4-P3-6.

### E. Start and Job Review
9. **Start** opens "Review job before starting" (`18-job-review.png`, expanded `19-job-review-expanded.png`):
   - header "LASER · My machine · Connected — Idle · ✓ Laser mode verified";
   - tiles ESTIMATED TIME 16m 24s, JOB SIZE 124.9 × 116.9 mm, OPERATIONS, **FILL RUNWAY 819 / 1,403 full**, G-CODE 5,808 lines, ORIGIN User origin;
   - "4 warnings · none block the start": the controller-to-bed coordinate mapping is unverified; 2 operations use uncalibrated defaults ("Run a material test on scrap…"); Generic Scan Line runways (with a **Neotronics 4040** paragraph); bidirectional scan with no scan-offset table;
   - per-operation cards (power, speed, passes, air assist Off), Controller and Machine facts, footer "Runs from User origin — anchor front left", **Start job**.
   - Nothing about glasses, fire, staying with the machine, focus or air → **U4-P2-1**, **U4-P2-2**, **U4-P2-6**.

### F. During the burn
10. **Start job** streams `G21 G90 G54 G94 M4 S0`, the rectangle at S300, then the fill. A bottom bar shows "JOB RUNNING 107 / 5804 lines · 2%", **Pause**, **ABORT JOB**, and "Software controller stop — use the physical E-stop or power isolation for danger"; the rail shows "~6m 54s remaining" and override buttons (`20-running.png`). The rail also says "Frame expired — The controller session, position, origin, or CNC Z reference changed after Frame. Frame the job again." while the job runs → U4-P3-3.
11. **Pause** sends `0x84` (safety door). The bar reads "JOB PAUSED … Resume / ABORT JOB", the simulator holds with spindle 0, the rail says "State: Door:0" and the canvas head marker says "Door" (`21-paused.png`) → U4-P3-1. **Resume** sends `~` and the stream continues (`23-resumed.png`).
12. **ABORT JOB** (no confirm) sends `0x18`; the controller answers `ALARM:3`, then KerfDesk sends `M5`, `M9` (both `error:9` while locked). The laser is off. The rail shows a red card "Alarm 3: Reset during motion — The controller was reset while still moving. Position is lost. Re-home the machine ($H) before resuming work." with **Set up homing** and **$X — Unlock**. The canvas marker still says "Run" (`25-after-abort.png`) → U4-P2-3, U4-P3-3.
13. **$X — Unlock**, then **Frame job**: the same "set the work origin at the current head position — the job runs from here" confirm. OK sends `G54 G92 X0 Y0` at machine X 119.1, Y 51.5, 69 mm right of the first origin, and frames from there (`27-reframe-after-abort.png`) → U4-P2-3.

### G. When it goes wrong
14. **Start pressed twice** (double-click **Start job**, then Ctrl+Enter, then the toolbar Start): one program header was streamed; Start is disabled while running (`29-start-twice.png`). Clean.
15. **Limit alarm mid-job** (`ALARM:1`, `[MSG:Reset to continue]`): "Alarm 1: Hard limit triggered — A limit switch was hit while the machine was moving. The controller stopped on a critical event … Press Reset (Ctrl-X), then Unlock or Home." with **Reset (Ctrl-X)**; the canvas marker and status bar still say "Run" and the rail still shows "~3m 58s remaining" (`30-alarm1-midjob.png`). After **Reset** the card still says "The controller accepts only a soft reset now: press Reset (Ctrl-X). Then clear the obstruction and re-home the machine ($H)." beside **Set up homing** and **$X — Unlock** (`31-after-reset.png`) → U4-P3-3, U4-P3-4.
16. **USB cable pulled mid-job:** a red card "Connection lost mid-job — USB connection was lost during an active job. The machine may still be moving from buffered commands. Use physical E-stop or power cutoff now if unsafe. Reconnect and home before continuing." plus a paragraph about the interrupted-job checkpoint, **Reconnect controller…** and **I made the machine safe**. The toolbar says "Didn't connect by itself: The previous serial connection is still closing." The simulator kept executing the 16 moves already in its planner, ending at X 115.8 with S300 still modal (`33-unplug-5s.png`). On replug the app reconnected by itself (`34a-after-replug.png`) → U4-P3-5.
17. **Door opened mid-job** (door input): bar "CONTROLLER DOOR HOLD — The controller is in its door-safety state and has stopped motion. Release it with cycle start on the machine" with **Pause** and **ABORT JOB**, no Resume. After the door closes the bar is unchanged. **Pause** (sends `0x84`) then turns it into a Resume (`~`), which continues (`50-door-open-midjob.png`, `51-door-closed.png`, `53-door-resume.png`) → U4-P3-2.
18. **Part off the bed (no homing, User Origin):** jog to machine (350, 350); a further jog to X 450 is warned ("Jog target X450.000 Y350.000 is outside the configured machine bounds X0.000..400.000…", `62-jog-past-bed-warned.png`). Set origin at (350, 350) and **Frame job**: the head is sent to machine X 474.9, Y 466.9 and the toast says "Frame complete" (`63-frame-past-bed-not-warned.png`). Job Review shows the same 4 warnings, none about the bed (`37-offbed-job-review.png`) → U4-P2-4.
19. **Part off the bed (homing on, homed, Absolute):** design moved to X 330 (55 mm past the right edge). Frame sends `$J=G90 G21 X54.887 …` (past the homed 0) and says "Frame complete" (`48-frame-off-bed-homed.png`). Job Review lists "Line 9: X out of bed: 454.887", "Line 10…", "Line 15…" etc. (`49-job-review-off-bed-homed.png`) → U4-P2-4, U4-P3-7.
20. **Wrong origin, Absolute without homing:** with the G92 origin still at (350, 350), Absolute frames the design at its canvas place (machine 25–150 × 253–370; KerfDesk subtracts the G92 offset correctly). Job Review then shows "ORIGIN Absolute · Machine space" with "JOB SIZE … X -324.9 to -200 · Y -96.9 to 20 mm" (`40-absolute-job-review.png`) → U4-P3-7. Nothing says the machine is not homed, so Absolute counts from where the head was at power-on; the only text is "The controller-to-bed coordinate mapping is unverified" → U4-P2-6.
21. **Homing machine, Unlock instead of Home:** Alarm at power-up; the rail card offers **Home ($H)** and **$X — Unlock** "only after confirming the head is safe". After **$X — Unlock**, **Frame job** (Absolute, the default here) is refused with "The controller did not report a usable work position. Wait for a complete status report, then Frame again." on every retry, while Idle reports keep arriving; a jog warns "The current machine XY position is unresolved…" (`44-frame-not-homed.png`, `44b-…`, `44c-frame-after-jog.png`) → U4-P2-5. Pressing **Frame job** while still in Alarm instead offers "Home runs the homing cycle… OK: home now and continue" (`58-frame-in-alarm-offer.png`). Clean.

### H. Repeat
22. A full run ends with `M5`, `G0 X0.000 Y0.000 S0` (back to the origin). A modal "Job complete — Would you like to darken selected areas?" opens; the rail shows **Run same job again from start**, **Paint a second pass…** and an enabled **Start** ("Ready to start — framed placement unchanged") (`54-job-complete.png`) → U4-P3-8.
23. **Start** again opens Job Review with the same job (`55-repeat-start.png`).
24. **Second copy at a new spot:** jog +150 mm X, **Set origin here**, **Frame job** (frames 0..124.9 × 0..116.9 from the new origin), Start (`57-second-copy-framed.png`). Clean.

## Findings

### U4-P2-1 — Nothing on the burn path tells a beginner to wear glasses, watch for fire or stay with the laser; Job Review has no safety section once laser mode is verified

- **Where:**
  - `src/ui/laser/job-review/JobReviewAcknowledgement.tsx:18-19`: `case 'laser-verified': return null;`, so a normal GRBL laser (`$32=1` read at connect) gets no safety block in Job Review.
  - The app's safety text exists only in Help → **Safety & liability** (`src/ui/commands/CommandShell.tsx:122`, `src/ui/help/safety-notice.ts:25-26,36`: "Never leave a running machine unattended…", "Wear eye protection rated for your laser's wavelength…") and About (`CommandShell.tsx:402-404`). The desktop installer's EULA has it; the web app shows no EULA.
  - The Learn lesson "Frame, review and start the exact job" (`src/ui/tutorials/run-tutorials.ts:4-55`) never mentions glasses, fire or supervision. No tutorial does (grep of `src/ui/tutorials` for glasses/eye/fire/unattended/extinguisher: no hit about safety).
- **What a beginner sees:** Job Review's header "✓ Laser mode verified", four technical warnings, and **Start job** (`shots\18-job-review.png`, `19-job-review-expanded.png`). The job runs 16 minutes; the running bar mentions only "the physical E-stop or power isolation for danger" (`20-running.png`).
- **Why it misleads:** a first-time diode owner is the person most likely to walk away from a long fill or to watch the dot without glasses. The app has the right words ("Never leave a running machine unattended. Watching on a camera, phone or remote connection is NOT supervision") but puts them where only someone looking for them finds them; the Help item's own description says "read before running a job" (`command-help-topics.ts:373`), and nothing on the path to Start sends the beginner there. ADR-224 Consequences describe Job Review as "one consistent pre-burn checkpoint … and the safety acknowledgement", which a verified laser never gets.
- **Anchor:** Contract: ADR-224 Consequences (quoted above); `safety-notice.ts:25-26` is KerfDesk's own rule. Ground truth (prior research): the 2026-07-12 competitive audit S11 records MillMage's "prominent in-app warnings … never leave a running machine unattended" (`docs/audits/2026-07-12-competitive-audit/data/S11-market.json:519`).
- **Evidence:** REPRO (`shots\18-job-review.png`, `19-job-review-expanded.png`, `59-help-menu.png`, `60-search-safety.png`) and READ.
- **Severity:** P2. The burn itself is correct and nothing leads the beginner to leave; the risk is behavioural. The coordinator may weigh P1 under AREAS "led into … an unsafe burn … without a warning they would understand".
- **Fix direction:** not a guard (ADR-228 rule 7). A short block in every laser Job Review, above **Start job**, shown whatever the laser-mode state:
  > **Before you start**
  > - Wear laser safety glasses made for your laser.
  > - Check the focus on your material.
  > - Stay with the laser until it finishes. Lasers can set material on fire; keep a fire extinguisher close.
  > - Run air assist and ventilation if you have them.
  
  It could fold after the first N completed jobs, but should never vanish for good.

**Refuter (2026-11-03):** CONFIRMED P2. I weighed P1 and rejected it.
- **Main, re-checked:**
  - `JobReviewAcknowledgement.tsx:18-19` returns null for `laser-verified`.
  - The safety text is in `safety-notice.ts:21-38` (Help) and `CommandShell.tsx:402-404` (About) only.
  - `run-tutorials.ts` has no safety words. The only safety words in any lesson are about machine-state recovery (`controller-tutorials.ts:132`).
- **Reproduced** with my own build and the **unmodified** repo simulator:
  - The first web screen is the workspace chooser with **Continue with Free**. It has no EULA and no safety text (`zz-u4r\shots\r01-first-launch.png`).
  - The first Job Review (`r41-job-review-warnings.png`) shows the whole dialog, header to **Start job**. It has no glasses, fire or supervision text.
- **Anchor correction.** The ADR-224 Consequences quote ("the safety acknowledgement") is verbatim, but in ADR-224 that acknowledgement is the two absorbed native confirms. ADR-224 Decision says it "absorbs the two former native confirms with their exact prompt text": the unverified-`$32` laser confirm and the CNC attestation. A verified laser never had a confirm, so this is not a broken contract.
- **A stronger twin.** The app *does* say "Wear laser safety glasses" for a low-power positioning dot (`CentreSelectionButton.tsx:112,163`; `PositioningLightEditor.tsx:88`), but never for a full-power job.
- **Why not P1.** The output is correct, and nothing leads the beginner to leave or to look at the beam. METHOD §3 P1 is about the app producing wrong output or firing unexpectedly. Missing behavioural advice is neither.
- **LightBurn 2.0 docs** (pinned paths, read 2026-11-03), for comparison:
  - In the app, LightBurn has no default safety prompt either. Its only in-app reminder is an optional **Enable Job Checklist**, a "list of items" shown at Start (https://docs.lightburnsoftware.com/2.0/Reference/DeviceSettings/BasicSettings/).
  - Its beginner docs do say it on the first-project page: "Never run your laser unsupervised." (https://docs.lightburnsoftware.com/2.0/GetStarted/FirstProject/).
  - KerfDesk's equivalent, the Learn lesson, does not. That keeps this at P2, not P3.

### U4-P2-2 — Focus is one grey line under the jog pad; nothing says how to focus or reminds the beginner before Frame or Start

- **Where:** `src/ui/laser/FocusJogControls.tsx:23` ("Manual focus: adjust the laser head by hand."). Job Review, the Frame toast and the Learn lessons say nothing about focus. Ctrl+K "focus" finds only Focus Test, "Requires controllable Z" (`command-help-topics.ts:144-147`). The only other mention is the Machine Setup checklist row "Air-assist relay, focus method, enclosure, interlocks, and exhaust are verified" (`shots\05b-review-checklist.png`).
- **What a beginner sees:** `shots\06-after-save.png` (the hint), `61-search-focus.png`, `18-job-review.png`.
- **Why it misleads:** an unfocused diode burns faint or not at all. A beginner who has never heard of focus reads "adjust the laser head by hand" as optional and then blames power and speed. Nothing says focus is the distance from the laser to the top of the material, that it changes with material thickness, or that most diode kits ship a gauge or fixed-focus spacer.
- **Anchor:** AREAS U4 ("Focuses, Frames, presses Start"); twin: the setup checklist names "focus method" as a hardware item, but no per-job surface does.
- **Evidence:** REPRO (screenshots above) and READ.
- **Related:** KNOWN G-S13-2 (no laser material-thickness/focus-offset field, 2026-07-12 competitive audit S13) covers the missing feature; this finding is the missing instruction.
- **Fix direction:** replace the hint with: "Manual focus: before each job, set the gap between the laser and the top of your material with the focus gauge or spacer that came with your laser (see its manual), then tighten the head." Add a Job Review fact "Focus: manual — set it on this material before Start" (see U4-P2-1's block).

**Refuter (2026-11-03):** SEVERITY CHANGE → **P3**.
- **The facts are right.** On main, `FocusJogControls.tsx:21-26` shows "Manual focus: adjust the laser head by hand." whenever the profile has no Z and no auto-focus command. No lesson mentions focus: every `focus:` hit in `src/ui/tutorials` is a step label, such as `calibration-tutorials.ts:20`. My Job Review has no focus line (`zz-u4r\shots\r41-job-review-warnings.png`), and the hint is under the jog pad (`r02-rect.png`).
- **Why P3.** AREAS P2 needs something that blocks or misleads.
  - Nothing here blocks: the burn runs.
  - Nothing on screen is false: the hint is literally correct.
  - An unfocused first burn is weak or faint. Its power, position and scale are not wrong.
  - The one quality prompt a beginner gets before Start is already in Job Review: "Run a material test on scrap before burning final material" (`r43-job-review-expanded.png`). A beginner whose test is faint has a next step.
- **LightBurn 2.0** has no in-app focus prompt either. Its beginner docs say "Focus the laser according to your laser's user guide" and that diodes "usually have a focusing spacer" (https://docs.lightburnsoftware.com/2.0/GetStarted/FirstProject/, "Focusing the Laser"). KerfDesk lacks the docs sentence, not a screen LightBurn has. That gap is a wording and polish item: put the sentence in the hint and the run lesson, as the fix direction says.

### U4-P2-3 — After ABORT JOB the beginner sees an alarm that reads like a fault, is told to re-home a machine with no homing, is never told the laser is off, and loses the origin; the next Frame offers to set the origin wherever the head stopped

- **Where:**
  - The Abort itself resets at once (`0x18`), so GRBL answers `ALARM:3`: KNOWN D-1 (`docs/audits/2026-10-20-controller-design-audit.md:141,166`; open maintainer decision per `docs/audits/2026-10-23-meta-v1/M7-meta-older-audits.md:121`).
  - The card text: `src/core/controllers/grbl/alarm-codes.ts:76-79` ("Reset during motion", "The controller was reset while still moving. Position is lost.", "Re-home the machine ($H) before resuming work."), with `src/ui/laser/AlarmRecoveryActions.tsx:61` "Turn on homing in Machine Setup if this machine has homing switches." on a machine whose homing is off.
  - The reset clears GRBL's G92 offset, which is what **Set origin here** wrote (`ADR-053` Decision 3: "soft-reset (which itself clears `G92`)"; the repo simulator models it at `src/__fixtures__/controllers/grbl-sim-machine.ts:336-339`, citing gnea/grbl `gc_init`).
  - The next Frame's offer: `src/ui/laser/start-blocked-setup-offers.ts:16-21` ("OK: set the work origin at the current head position — the job runs from here — …").
- **What a beginner sees:** they press ABORT JOB because something looked wrong. A red "Alarm 3: Reset during motion … Position is lost. Re-home the machine ($H)", first button **Set up homing** (`shots\25-after-abort.png`). Nothing says "you stopped it" or "the laser is off". After **$X — Unlock** and **Frame job**, the confirm offers to set the origin "at the current head position". The head is where the job stopped.
- **Why it misleads:** REPRO, serial log:
  - origin set at machine (50, 50): `G54 G92 X0 Y0`;
  - Abort at machine (119.1, 51.5): `0x18` → `ALARM:3`, then `WCO:0.000,0.000,0.000` in the next status report (the origin is gone);
  - `$X`, Frame, OK → `G54 G92 X0 Y0` at (119.1, 51.5), frame `$J=G90 G21 X0..124.887 Y0..116.9` from there (`shots\27-reframe-after-abort.png`).
  
  The re-run would burn 69 mm to the right of the first, over half-burnt material. The beginner was never told the first origin was cleared, so "the current head position" reads like the place they already chose. "Re-home" cannot be done on this machine. "Position is lost" is the only hint.
- **Anchor:** Contract: ADR-053 Decision 3 (the reset clears G92) and ADR-367 Decision 6 ("Refusals name their remedy"); AREAS U4 item 5 ("Is the laser off after Stop? Does the beginner know what state the machine is in?") and item 6 ("Can the user resume or restart safely?").
- **Evidence:** REPRO (`shots\24-abort-click.png`, `25-after-abort.png`, `26-unlocked.png`, `27-reframe-after-abort.png`; log in the run of 2026-11-03 16:22).
- **Severity:** P2, P1 weighed. For P1: by METHOD §3 G6 the Frame is not a warning, and the offer is the only way forward. Against P1: the confirm states where the job will run ("the current head position — the job runs from here"), and the move is one the operator confirms. Not P1 by AREAS' "without a warning they would understand", but close; the coordinator should decide.
- **Fix direction:**
  - When ALARM:3 follows KerfDesk's own Abort, replace the card with: "You stopped the job. The laser is off. Stopping reset the controller, so the origin you set is gone. To run the job again in the same place, move the head back to that corner and press Set origin here. Then press $X — Unlock." Show **Set up homing** only when homing is on.
  - In the origin offer after a reset: "Your earlier origin was cleared when the job stopped. The head is now 69 mm right of it and 2 mm further back." (The app had the old WCO.)
  - Longer term: D-1's hold-then-reset keeps the position, and re-applying the G92 the app itself wrote would keep the origin.

**Refuter (2026-11-03):** CONFIRMED P2. I weighed P1 and rejected it.
- **Main, re-checked:**
  - `alarm-codes.ts:75-79` (code 3, "Re-home the machine ($H) before resuming work.").
  - `AlarmRecoveryActions.tsx:61`.
  - `start-blocked-setup-offers.ts:15-21`.
  - Unlock clears the origin source: `laser-console-completion.ts:113-120` (`positionLostAtUnlockPatch`) sets `workOriginSource: 'none'`.
- **Reproduced** with the unmodified repo simulator:
  - Setup: origin at machine (50, 50), a 70 × 60 mm Fill, **ABORT JOB** after about 117 lines.
  - Abort sends `0x18` → `ALARM:3`, then `M5`/`M9` → `error:9` ×2. The next status shows `WCO:0.000,0.000,0.000`, so the origin is gone (`zz-u4r\shots\r11-after-abort.png`: red card, **Set up homing** first, no "laser is off").
  - **$X — Unlock**, then **Frame job**. The confirm reads "User Origin needs a custom work origin. OK: set the work origin at the current head position — the job runs from here…". OK sends `G54 G92 X0 Y0` at machine (45, 52.8) and frames from there (`r16-reframe-after-abort.png`).
  - **The shift is wherever the head stopped:** 5 mm / 2.8 mm in my run, 69 mm in the auditor's. Up to the job's own size.
- **Why not P1.** METHOD §3 lets a P1 drop when "a clear warning reaches the operator before the output is produced". Here the operator hears this, in words, before any output:
  - The one prompt on the path to the re-run names the new placement: "at the current head position — the job runs from here". The head is physically over the half-burnt work.
  - The card says "Position is lost."
  - The Origin panel says "Origin: not reported yet".
  - **Go to work zero** is disabled, titled "Set a work origin and wait for its controller position before returning to it." (`r17-goto-work-zero-after-abort.png`).

  So the burn lands where the app said it would, at an operator-confirmed spot. G6 does not apply: G6 is about a Frame that silently compares with nothing, and this is a stated placement. What fails is the explanation, not the warning. Nothing says *your* origin was cleared, and the card's first remedy (re-home) is impossible here. That is P2 by AREAS ("misleads, with a workaround").
- **A way out a beginner can find** (it lowers the risk, not the wording problem):
  - The rail keeps "Interrupted job saved · … Recorded cause: Stopped by the operator (Abort)" with **Review recovery** (`r12-interrupted-expanded.png`).
  - That dialog says it plainly: "The controller has no work origin set now… Set origin here would put the origin where the head is now, not where the job started." It also offers **Restore saved origin** at X 50, Y 50 (`r15-review-recovery.png`).
  - It is buried and jargon-heavy ("sealed", "freshly qualified"). The fix should reuse its sentences on the Alarm 3 card.
- **Other controllers** (READ):
  - **grblHAL** keeps G92 through a reset (`laser-recovery-origin.ts:50-56`), so the origin survives an Abort. This finding does not happen there.
  - **Marlin** has `softReset: null` (`marlin/driver.ts:68`), so Abort takes the no-reset path (`laser-job-stop.ts:112-115`, `runNoResetStop`). There is no ALARM:3, and G92 is kept.
  - **CNC on GRBL** loses G92 XY and Z. But a CNC Frame refuses until Z is zeroed again: "CNC Frame requires a current work Z zero…" (`cnc-frame-lines.ts:31-32`). So the loss is forced into view.
  - The finding is **stock GRBL and FluidNC lasers**, the most common beginner diode.
- **LightBurn 2.0:** Stop "Immediately aborts a currently running job" (https://docs.lightburnsoftware.com/2.0/Reference/LaserWindow/). JobControl says you "won't be able to resume right where you left off" (https://docs.lightburnsoftware.com/2.0/GetStarted/JobControl/). The docs do not say whether LightBurn's GRBL Stop resets the controller or clears G92: UNVERIFIED.

### U4-P2-4 — A Frame that runs past the end of the bed reports "Frame complete" on stock GRBL; with no homing the beginner is never warned, though a jog to the same place is

- **Where:**
  - Jog: `src/ui/state/laser-jog-warnings.ts:55-76,123-143`. A never-homed machine is compared with the bed in the "MPos zero where the head powered up" convention and warned.
  - Frame: the only Frame-time bed warning is grblHAL's (`src/ui/state/frame-homed-area-warning.ts:1-8,25-52`, ADR-637 Amendment 5: "The Frame reaches X … past the controller's homed area … The Frame is sent unchanged…"). Stock GRBL gets "Frame complete" (`src/ui/laser/frame-dispatch-support.ts:26-27`).
  - Job Review: with no homing and User Origin there is no bed warning; homed Absolute gets per-line "Line 9: X out of bed: 454.887" items.
- **What a beginner sees:**
  - No homing: the head near the back right, Set origin here, Frame. The head is driven to machine X 474.9, Y 466.9 on a 400 × 400 bed, and the toast says "Frame complete" (`shots\63-frame-past-bed-not-warned.png`). Job Review has the usual 4 warnings, none about the bed (`37-offbed-job-review.png`). A moment earlier, a jog to X 450 had warned "outside the configured machine bounds X0.000..400.000" (`62-jog-past-bed-warned.png`).
  - Homed, Absolute, design 55 mm past the right edge: Frame sends `$J=G90 G21 X54.887 …` past the homed 0 and says "Frame complete" (`48-frame-off-bed-homed.png`). Only at Start does Job Review list five "Line N: X out of bed: …" lines (`49-job-review-off-bed-homed.png`).
- **Why it misleads:** with `$20=0` (soft limits off, the default on these kits) the head runs into the end of the rail and the steppers skip; the beginner is told the Frame succeeded. The app had the numbers: `$130 × $131` = 400 × 400 read at connect, MPos (350, 350), a 124.9 × 116.9 job. It uses them for jogs and for grblHAL Frames, but not for a stock-GRBL Frame.
- **Anchor:** Twin: the jog bound check (`laser-jog-warnings.ts`) and the grblHAL Frame warning (`frame-homed-area-warning.ts`) against the stock-GRBL Frame. Contract: ADR-228 ("operator-relevant findings go into the Job Review warnings list") and the Job Review out-of-bed warning that exists for the homed case but not the never-homed one. ADR-237 Consequences accept that "the tool-off Frame trace itself therefore runs without a prior warning surface". A toast as the Frame is sent, as grblHAL already gets, is not a prior dialog.
- **Evidence:** REPRO (shots above; serial lines quoted).
- **Severity:** P2. The overrun follows the operator's own origin and the beam is off; the warning exists on two sibling paths.
- **Fix direction:** extend the grblHAL Frame warning to stock GRBL, in both conventions (homed with a known frame; never homed, from power-up), and add the same fact to Job Review for the never-homed case. Plain wording: "This frame goes 75 mm past the right edge and 67 mm past the back of the 400 × 400 mm bed, counted from where the machine was switched on. Stop the frame, then move the origin or the design." In Job Review, one line per edge ("The job goes 55 mm past the right edge of the bed"), not one per G-code line.

**Refuter (2026-11-03):** CONFIRMED P2. I weighed P1 and rejected it.
- **Main, re-checked:**
  - `frame-homed-area-warning.ts:26-35` returns null unless `grblHalHomedEnvelope` is known.
  - `frame-dispatch-support.ts:26-27` (`FRAME_COMPLETE_MESSAGE`).
  - `laser-jog-warnings.ts` is the jog twin.
- **Reproduced, never homed:**
  - Jogged to machine (400, 350). That jog sat exactly on the edge, so it did not warn. Then **Set origin here** and **Frame job** on a 70 × 60 mm design.
  - The frame went `$J=G90 G21 X0..70 Y0..60` from there, i.e. machine X 470, Y 410 on a 400 × 400 bed.
  - The rail then read "Ready to start — framed placement unchanged", with no warning (`zz-u4r\shots\r21-frame-past-bed-mid.png`, `r22-frame-past-bed-done.png`). The canvas still draws the design at its canvas place (KNOWN U2-P3-7), so nothing on screen hints at the far corner.
- **Reproduced, homing on:**
  - Home, then the design moved to X 360 (30 mm past the right edge). Frame sent `$J=G90 G21 X-40.000 … X30.000 …`, past the homed 0, with no warning (`r71-homed-frame-offbed.png`).
  - Here the canvas **does** draw the design over the bed edge in red dashes before the Frame.
  - Job Review lists "Line 9: X out of bed: 430" and "Line 10…" before any burn (`r72-homed-review-offbed.png`).
- **Why not P1.**
  - The move is beam-off (`M5`, `M9` first).
  - It traces the footprint the operator asked to trace, from the origin they chose.
  - Its worst result is a stall at the rail end, which is mechanical and loses position. It is not a hazard to the person, and no burn follows without Job Review.
  - Bed bounds are advisory by contract. ADR-228 "Deleted or demoted" says out-of-bed findings are "demoted to Job Review warnings". ADR-237 Consequences accept that the Frame "runs without a prior warning". A warning toast is the most the rules allow, and grblHAL already gets one.
- **LightBurn 2.0 is no better.** Its "Out of Bounds" warning is a device option that "requires that your device has been properly homed". "Check Bounds When Framing" exists only for DSP devices (https://docs.lightburnsoftware.com/2.0/Reference/DeviceSettings/BasicSettings/). So a never-homed GRBL laser framed past the bed is silent in LightBurn too.
- **What keeps it at P2** is KerfDesk's own twin: the jog to the same place warns ("outside the configured machine bounds"), while the Frame says it is fine.

### U4-P2-5 — After the rail's **$X — Unlock**, Frame refuses with "Wait for a complete status report, then Frame again", which no report can satisfy

- **Where:** `src/ui/laser/frame-dispatch-support.ts:20-21` (the message), raised at `src/ui/laser/use-frame-action.ts:371-374` because `currentWorkXy` is undefined. Unlock withholds the position on purpose (`src/ui/state/laser-console-completion.ts:117` sets `positionEvidenceSuppressed: true`; `src/ui/state/laser-status-position.ts:61-69,96-102` then strips MPos/WPos/WCO from every report until Home or Set origin).
- **What a beginner sees:** homing machine, Alarm at power-up. The rail card offers **Home ($H)** and **$X — Unlock** ("Unlock ($X) only after confirming the head is safe"); the beginner unlocks. **Frame job** (Absolute, the default for a homing profile) gives "Error: The controller did not report a usable work position. Wait for a complete status report, then Frame again." and the red "Last Frame attempt blocked" banner. It does so on every retry while `<Idle|MPos:…|WCO:…>` reports keep arriving (`shots\44-frame-not-homed.png`, `44b-frame-not-homed-retry.png`). A jog meanwhile warns "The current machine XY position is unresolved…" (`44c-frame-after-jog.png`).
- **Why it blocks:** waiting cannot help; the fix is Home or Set origin here, and the message names neither. ADR-367 Context item 2 describes exactly this dead end ("the Frame that followed was refused with 'Wait for a complete status report', which no report could satisfy") and Decision 2 fixed it only for the Unlock **offered by Frame**. The rail's own Unlock button still leads into it.
- **Anchor:** Contract: ADR-367 Context 2 and Decision 6 ("Refusals name their remedy").
- **Evidence:** REPRO and READ.
- **Fix direction:** when the position is withheld after Unlock, say so: "After Unlock, KerfDesk doesn't know where the head is. Press Home, or move the head to your material, press Set origin here, and choose User Origin." Better, make the rail Unlock hand over to Set origin as ADR-367 Decision 2 does for the offer.

**Refuter (2026-11-03):** CONFIRMED P2.
- **Main, re-checked:**
  - `frame-dispatch-support.ts:20-21`.
  - `laser-console-completion.ts:117` (`positionEvidenceSuppressed: true`).
  - ADR-367 (`docs/decisions/ADR-367-frame-offers-blocker-fixes-in-place.md`):
    - Context item 2 describes this exact dead end.
    - Decision 2 ("Unlock hands over to Set origin") covers only the Frame's own offer.
    - Decision 1 offers Home, not Unlock, on a machine with homing enabled.
    - Decision 6 says "Refusals name their remedy."
- **Reproduced** (homing ticked in Essentials as **Enable Home ($H)**, `$22=1`, Alarm at power-up). Two routes into Unlock both dead-end:
  1. The rail card's **$X — Unlock**, then **Frame job** twice (3 s apart). Each time: "The controller did not report a usable work position. Wait for a complete status report, then Frame again." and "Last Frame attempt blocked". Meanwhile `<Idle|MPos:0.000,0.000,0.000|…|WCO:0.000,0.000,0.000>` reports kept arriving (`zz-u4r\shots\r31-frame-after-rail-unlock.png`, `r32-frame-retry.png`).
  2. **Console** → typing `$X` → **Frame job**: the same message (`r35-frame-after-console-unlock.png`).
- **Way out.** **Home** stays visible in the centre of the jog pad, and the Alarm card had just said "Home ($H) if the machine has homing switches". **Set origin here** is on the rail too. A beginner can plausibly find one of them, which keeps this at P2.
- **A note for the fix.** Without **Enable Home**, a `$22=1` machine set up through **My machine isn't listed** gets User Origin and the Set-origin offer instead (my first attempt). The dead end needs a homing profile, where Absolute is the default.

### U4-P2-6 — Job Review's warnings for a beginner's first job are four expert notes, one about a Neotronics 4040; none tells them what to check

- **Where:**
  - `src/ui/state/native-bed-frame.ts:62`: "The controller-to-bed coordinate mapping is unverified. The canvas is artwork-relative; physical bed position and no-go-zone clearance must be checked at the machine."
  - `src/ui/laser/job-intent-warnings.ts:35`: "Generic Scan Line feed-matched entry and exit runways are active. The Neotronics-qualified 4040 fill policy is not selected because My machine is selected… If this is that machine, open Machine Setup, choose Neotronics 4040 Max…"
  - `job-intent-warnings.ts:92`: "Bidirectional scan output at 1500 mm/min has no saved scan-offset table. KerfDesk will emit 0 mm scan correction…"
  - The **FILL RUNWAY** tile: "819 / 1,403 full · Effective target 5 mm · 584 partial".
- **What a beginner sees:** `shots\18-job-review.png`, `19-job-review-expanded.png`. Of the four, only "2 operations are still using the uncalibrated defaults … Run a material test on scrap" is actionable (that one is U3's).
- **Why it misleads:** Job Review is the one place ADR-224 gives for "everything the deleted guards used to refuse" (ADR-228). For a beginner it is four notes they cannot act on, so they learn to click **Start job** past it. The only note about where the job will burn ("controller-to-bed coordinate mapping") does not say what to do: watch the Frame. The Neotronics paragraph appears on **every** generic machine with a fill and invites the beginner to pick a machine they don't own. This is AREAS' P2: "a message whose words a beginner cannot act on".
- **Anchor:** Contract: ADR-224 (the review "visually help[s] you check all settings in one pop up window"); AREAS U4 item 4 ("whether a beginner understands each check").
- **Evidence:** REPRO and READ.
- **Fix direction:** lead with the plain block of U4-P2-1. Reword the mapping note: "KerfDesk can't check where this burns on your bed. The box the Frame traced is where it will burn — make sure your material is under it." Move scan-offset, runway and fill-policy notes, and the FILL RUNWAY tile, into a folded "Advanced notes". Show the Neotronics note only when the bed and controller settings could be that machine.

**Refuter (2026-11-03):** CONFIRMED P2.
- **Main, re-checked:** `native-bed-frame.ts:62`, `job-intent-warnings.ts:35,92`.
- **Reproduced.** A first job (one 70 × 60 mm Fill on a generic 400 × 400 GRBL laser) shows "4 warnings · none block the start" (`zz-u4r\shots\r41-job-review-warnings.png`). Expanded (`r43-job-review-expanded.png`), they are:
  - "The canvas is artwork-relative; physical bed position and no-go-zone clearance must be checked at the machine."
  - The Neotronics 4040 paragraph ("If this is that machine, open Machine Setup, choose Neotronics 4040 Max…").
  - The scan-offset note.
  - Only the uncalibrated-defaults line is actionable.
- **Severity.** AREAS P2 names "a message whose words a beginner cannot act on". The 4040 paragraph also invites a beginner with a 400 × 400 diode to pick a machine they don't own.
- **Overlap.** U3-P3-6 (refuter) has the same 4040 text in the Save G-code toasts. One fix card should cover both surfaces: gate `job-intent-warnings.ts:35` on a plausible 4040.
- **Hand-off from U3's refuter, confirmed on screen.** The first job's Job Review shows "Operation "Rectangle" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass)". Expanded, it reads "Run a material test on scrap before burning final material." (`r43-job-review-expanded.png`). It is second of four, visible without expanding the list.

### U4-P3-1 — Pause shows the machine as "Door" ("State: Door:0", canvas label "Door"); its tooltip says "Pause is feed hold only" while it sends the safety-door command

- **Where:** Pause sends `0x84` (serial log, step 11). The rail state label and canvas marker show the raw state (`shots\21-paused.png`). The tooltip and running-bar text are at `src/ui/laser/job-control-copy.ts:6`.
- **Why:** a beginner with no door sees "Door" and wonders what opened; "feed hold only" is the wrong mechanism (ADR-212 uses the door state so the beam goes dark).
- **Fix direction:** show "Paused (laser off)" for a Door state KerfDesk requested. Tooltip: "Pause stops the head and turns the laser off. Use ABORT JOB or the machine's power switch if anything is unsafe."

**Refuter (2026-11-03):** CONFIRMED P3. `job-control-copy.ts:6` reads "Pause is feed hold only…". **Pause** sent `0x84`, and the rail read "State: Door:0" with the simulator at spindle 0 (`zz-u4r\shots\r51-paused.png`). The running rail shows the "feed hold only" line (`r10-running.png`).

### U4-P3-2 — A machine door hold says "Release it with cycle start on the machine" and offers no Resume

- **Where:** `src/ui/laser/LiveMotionBar.tsx:346-353`.
- **What a beginner sees:** "CONTROLLER DOOR HOLD … Release it with cycle start on the machine" with **Pause** and **ABORT JOB**, unchanged after the door is closed (`shots\50-door-open-midjob.png`, `51-door-closed.png`). Most hobby lasers have no cycle-start button. The working path, **Pause** then **Resume** (`0x84`, then `~`), is not suggested (`53-door-resume.png`).
- **Note:** the simulator reported `Door:1`/`Door:0` without a `Pn:D` pin field, so the "door-safety state" variant was shown; with the pin field the text is "Close it, then press cycle start on the machine". Same advice either way.
- **Fix direction:** once the report says `Door:0` (closed, ready), show **Resume** (send `~`): "The lid was opened, so the laser stopped. Close it, then press Resume."

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `LiveMotionBar.tsx:351-352`.
- **Door opened mid-job:** "CONTROLLER DOOR HOLD — The controller is in its door-safety state and has stopped motion. Release it with cycle start on the machine". It was unchanged after the door closed, and only **Pause** and **ABORT JOB** were offered (`zz-u4r\shots\r53-door-open.png`, `r54-door-closed.png`).
- **The workaround works:** **Pause** (`0x84`) turns the bar into **Resume**, which sends `~` and runs on (`r55-door-pause-resume.png`). P3, because ABORT and that workaround exist.

### U4-P3-3 — Running and alarm screens show stale state: "Frame expired … changed after Frame" during a normal run; "Run" on the canvas and status bar after Abort, a limit alarm or a pulled cable

- **Where:** `src/ui/laser/JobActionControls.tsx:217-219` with `framed-run-readiness.ts:19` (shown while the job consumes its one-use permit); the canvas motion overlay and status bar ("Controller-reported • Run").
- **What a beginner sees:** "Frame expired — The controller session, position, origin, or CNC Z reference changed after Frame. Frame the job again." beside a running job (`shots\20-running.png`, `21-paused.png`). After Abort and ALARM:1 the head label still says "Run", and after ALARM:1 the rail still says "~3m 58s remaining" (`25-after-abort.png`, `30-alarm1-midjob.png`, `33-unplug-5s.png`).
- **Fix direction:** while a job runs, say "Running the framed job"; after it, "Frame again to run it from a new origin". Clear the head label and time left when the run ends for any reason.

**Refuter (2026-11-03):** CONFIRMED P3.
- **During a normal run:** "Frame expired — The controller session, position, origin, or CNC Z reference changed after Frame. Frame the job again." (`framed-run-readiness.ts:19`; `zz-u4r\shots\r10-running.png`).
- **After Abort:** the status bar still read "Controller-reported • Run" (`r11-after-abort.png`).
- **After ALARM:1:** "~3m 44s remaining" and "Controller-reported • Run • 6s" (`r60-alarm1.png`).

### U4-P3-4 — The ALARM:1 card still says "accepts only a soft reset now: press Reset (Ctrl-X)" after Reset was pressed, and advises re-homing on a machine with homing off

- **Where:** `src/core/controllers/grbl/alarm-codes.ts:64` (the fixed action text), shown after the reset beside **Set up homing** and **$X — Unlock** (`shots\31-after-reset.png`).
- **Fix direction:** after the reset, show the next step only: "The machine stopped because it hit the end of its travel. Check that the design and origin fit the bed. Then press $X — Unlock (or Home, if homing is on)."

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `alarm-codes.ts:64`. After **Reset (Ctrl-X)** the card still read "The controller accepts only a soft reset now: press Reset (Ctrl-X). Then clear the obstruction and re-home the machine ($H).", beside **Set up homing** and **$X — Unlock**, on a no-homing profile (`zz-u4r\shots\r60-alarm1.png`, `r61-alarm1-after-reset.png`).

### U4-P3-5 — The cable-pulled card says the machine "may still be moving" but not that the laser may still be burning; it says "Reconnect and home" to a machine with no homing, and adds a checkpoint paragraph

- **Where:** `src/ui/state/laser-safety-notice.ts:200-205` and the paragraph at `src/ui/laser/SafetyNoticeBanner.tsx:62`.
- **What a beginner sees:** `shots\33-unplug-5s.png`. The simulator ran on through the 16 moves in its planner at S300 (M4), which on a real diode means burning while it moves.
- **Fix direction:** "The USB cable was disconnected during the job. The laser may keep moving and burning for a few seconds. If it doesn't stop, switch the laser off at its power switch. Then reconnect." Move the checkpoint sentence behind a "More" link.

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `laser-safety-notice.ts:202`. Reproduced: "…The machine may still be moving from buffered commands. Use physical E-stop or power cutoff now if unsafe. Reconnect and home before continuing.", plus the checkpoint paragraph and "Didn't connect by itself: The previous serial connection is still closing." The unmodified simulator drained its planner to X 120 with S300 modal (`zz-u4r\shots\r62-unplugged.png`). P3: the card does name the physical E-stop and power cutoff.

### U4-P3-6 — Frame and origin wording: "generated motion envelope with the tool off"; the origin offer doesn't say which corner of the design goes at the head; "Last Frame attempt blocked" stays after the origin is set

- **Where:** `src/ui/laser/JobActionControls.tsx:233` and `src/ui/tutorials/run-tutorials.ts:28` ("generated motion envelope with the tool off"); `src/ui/laser/start-blocked-setup-offers.ts:16-21`.
- **What a beginner sees:** the Frame title (step 8); the confirm (step 6) with Job origin **FL** only in the Placement panel; the stale red banner after **Set origin here** (`shots\15-origin-set.png`).
- **Related:** KNOWN U2-P3-7 (Start-from modes explained only by one tooltip).
- **Fix direction:** Frame title: "Move the head around the outside of the job with the laser off, so you can check it fits your material." Origin offer: "OK: the front-left corner of your design goes where the laser head is now." Clear the banner when the origin it asked for is set.

**Refuter (2026-11-03):** CONFIRMED P3.
- **The Frame title** is at `JobActionControls.tsx:233` (seen in the button list).
- **The origin offer** text is `start-blocked-setup-offers.ts:15-21`.
- **The stale banner:** I declined the offer, then pressed **Set origin here**. The rail still read "Last Frame attempt blocked — User Origin needs a custom work origin. Click "Set origin here" first." (`zz-u4r\shots\r50-origin-set-banner.png`).

### U4-P3-7 — Job Review mixes coordinate frames: "ORIGIN Absolute · Machine space" with a job size in work coordinates, and out-of-bed lines in bed coordinates

- **Where:** Job Review stats and warnings.
- **What a beginner sees:**
  - With a leftover G92 origin: "X -324.9 to -200 · Y -96.9 to 20 mm" under "Machine space" (`shots\40-absolute-job-review.png`).
  - After Home: "X -70 to 54.9 · Y -146.9 to -30 mm" next to "Line 9: X out of bed: 454.887" (`49-job-review-off-bed-homed.png`).
  - The park warning "X 0 · Y 0 mm" is in work coordinates.
- **Anchor:** Twin: the tile label against the numbers beside it.
- **Fix direction:** show bed coordinates throughout (what the canvas rulers show), and label anything else.

**Refuter (2026-11-03):** CONFIRMED P3. File:line for the JSON:
- the "Machine space" label is `job-review-format.ts:77`;
- the "X out of bed: N" text is `core/invariants/predicates.ts:199`.

Reproduced homed, Absolute, design at X 360. Job Review shows "ORIGIN Absolute / Machine space" with "JOB SIZE … X -40 to 30 · Y -150 to -90 mm", next to "Line 9: X out of bed: 430" and the park note "X 0 · Y 0 mm" (`zz-u4r\shots\r72-homed-review-offbed.png`).

### U4-P3-8 — The first "Job complete" is a modal about a second pass

- **Where:** `src/ui/laser/second-pass/SecondPassCompletionPrompt.tsx:48`.
- **What a beginner sees:** "Job complete — Would you like to darken selected areas? Paint the parts you want to engrave again…" with **Not now** / **Darken selected areas…** (`shots\54-job-complete.png`). The calm facts ("the laser is off and the head is back at the origin") and the obvious next steps (**Run same job again from start**, a new copy) are in the rail behind it.
- **Fix direction:** make the prompt non-modal, or lead it with "Job complete. The laser is off and the head is back at the origin." and offer "Run again" beside "Darken areas".

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `SecondPassCompletionPrompt.tsx:48`. The first completed job opens "Job complete — Would you like to darken selected areas?…" with **Not now** and **Darken selected areas…**. Behind it the rail shows **Run same job again from start** and "Ready to start — framed placement unchanged" (`zz-u4r\shots\r56-job-complete.png`).

## KNOWN re-observed

- **U2-P3-7** (Start-from modes): User Origin is the default for a no-homing machine; nothing on the canvas changes with it, and the design's canvas place is ignored (`10-placement.png`, steps 5–8).
- **U1-P3-2**: the red "Relative view — physical bed position unverified" appears with the first artwork (`09-text-fill.png`).
- **L8-P2-6 (P3)**: origin cross at the top-left (rear-left) while the machine origin is front-left; the travel line starts from the front-left (`14-jogged.png`).
- **U3-P2-1** (starter power and speed): Job Review does say "2 operations are still using the uncalibrated defaults … Run a material test on scrap before burning final material." (`19-job-review-expanded.png`).
- **G-S13-2** (2026-07-12 competitive audit S13): no material-thickness / focus-offset field. Re-observed: the Materials tab is an empty library; Focus Test needs a powered Z. U4-P2-2 is the missing instruction.
- **D-1** (2026-10-20 controller design audit; M7 row 35, maintainer decision pending): an owned Abort resets at once, so every Abort shows ALARM:3. Re-observed (`25-after-abort.png`). U4-P2-3 is its beginner-facing consequence.
- **ADR-237 Consequences** (accepted): the Frame runs before any warning surface. Context for U4-P2-4.
- **U2-P2-2** (raw `error:N`): after Abort, KerfDesk's `M5`/`M9` are answered `error:9` while locked. No toast showed it in this run; it is in the Console only.

**Refuter (2026-11-03):** all 8 UPHELD as KNOWN. I re-observed each in my own runs:
- **U2-P3-7:** the canvas keeps the design at its canvas place while the Frame runs at (400, 350) (`zz-u4r\shots\r22-frame-past-bed-done.png`).
- **U1-P3-2:** the same screenshot.
- **L8-P2-6:** the red origin cross at the canvas top-left (`r02-rect.png`).
- **U3-P2-1:** see U4-P2-6's refuter note (`r43-job-review-expanded.png`).
- **D-1:** `0x18` → `ALARM:3` on every Abort.
- **U2-P2-2:** `error:9` ×2 in the log after Abort, with no toast (`r11-after-abort.png`).
- **G-S13-2 and ADR-237:** by READ.

None needs a new ID. Ownership stays as given: U2 owns raw `error:N`, and U3 owns the toast cap and the 4040 note on Save G-code. U4-P2-6 is its Job Review twin.

## Refuted

- **"Pause doesn't stop; KerfDesk resets the controller after a 'Pause did not complete' timeout"** (my first run, `Controller stream stalled`). A harness artefact: my bridge decoded written bytes as UTF-8, so the `0x84` Pause byte reached the simulator as U+FFFD and was ignored. With byte-for-byte decoding (`zz-u4-sim-entry.ts`) Pause holds with the beam off and Resume continues (`21-paused.png`, `23-resumed.png`). KerfDesk's own writer sends single bytes (`src/platform/web/serial-wire.ts:10-23`).
- **"Start pressed twice streams the job twice."** One program header was streamed after a double-click of **Start job**, Ctrl+Enter and a toolbar Start click (`29-start-twice.png`).
- **"The laser can stay on after ABORT JOB."** Abort sends `0x18` (GRBL stops the spindle on reset), then `M5` and `M9`; the job end also sends `M5` before the return move.
- **"An Absolute Frame ignores a leftover G92 origin and frames in the wrong place."** KerfDesk subtracted the G92 offset: the frame went to machine X 25.1–150, Y 253.1–370, the design's canvas place (`39-absolute-framed.png`). Only the labels are wrong (U4-P3-7).
- **"Repeating the job or making a second copy needs tricks."** **Start** after completion re-opens Job Review for the same placement; a second copy is jog → Set origin here → Frame → Start (`55-repeat-start.png`, `57-second-copy-framed.png`).

**Refuter (2026-11-03):** all 5 refutations UPHELD. I used the **unmodified** repo simulator, without the auditor's "no retire in Hold" change.
1. **Pause.** Pause sent `0x84` → `Door:0`, spindle 0. Resume sent `~` and the job ran on (`zz-u4r\shots\r51-paused.png`, `r52-resumed.png`).
2. **Start twice.** A double-click of **Start job**, then Ctrl+Enter, then the toolbar Start, streamed exactly one program header, and the job completed.
3. **Abort.** Abort sent `0x18`, `M5`, `M9`, and the simulator showed spindle 0.
4. **Absolute with a leftover G92:** not re-run. The homed Absolute Frame I ran subtracted no stale offset (WCO 0).
5. **Repeat.** After completion the rail offers **Run same job again from start** and an enabled Start (`r56-job-complete.png`).

## Verified clean

- **Frame is beam-off:** `M5`, `M9`, then `$J=G90` jogs around the job box and back to the start, at the profile's 6000 mm/min.
- **Start needs a completed Frame,** and is disabled while a job runs. A double Start streams once.
- **Running bar:** lines, percent, time left, Pause, ABORT JOB and "Software controller stop — use the physical E-stop or power isolation for danger".
- **Pause** is beam-off (safety-door state, spindle 0); **Resume** continues from where it held.
- **ABORT JOB** acts at once without a confirm, and the beam is off.
- **Job end:** `M5`, then `G0 X0 Y0 S0` back to the origin.
- **Frame in Alarm (homing on)** offers "Home runs the homing cycle… OK: home now and continue" (ADR-367).
- **Jogs past the bed warn** on a never-homed machine ("Jog target X450.000 … outside the configured machine bounds").
- **A pulled cable** raises a clear red card with **Reconnect controller…** and keeps an interrupted-job record ("Interrupted job saved · 210 of 5804 lines").
- **Repeat and a second copy** work by following the rail.

## Not verified

- **Real hardware:** the physical result of a Frame past the rail end (stall, skipped steps), whether a real diode keeps burning after a cable pull (M4 dynamic mode should turn the beam off when motion stops), and real door-switch firmware (`Pn:D`).
- **Real Chrome serial behaviour** and Arduino boards that reset on port open (the simulator keeps its G92 across a reconnect; a board that resets would clear it too, which would make U4-P2-3's origin loss also follow a cable pull).
- **grblHAL, Marlin and the Falcon A1 Pro** first-burn paths. U4-P2-4's grblHAL Frame warning was read, not run.
- **The desktop app** (its EULA shows the safety terms at install; not launched, as instructed).
- **LightBurn's beginner path** for focus and safety prompts (U8).
- **The canvas head marker during a run:** its position against the reported work position was not measured; the simulator updates MPos when a line is parsed, not when it is executed.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u4\`:

| File | Purpose |
|---|---|
| `simsrc\zz-u4-sim-entry.ts` | Web Serial bridge over the repo GRBL simulator: `window.__U4.unplug()`, `.replug()`, `.alarm(code)`, `.door(open)`, `.state()`, event log |
| `simsrc\grbl-simulator-u4.ts`, `simsrc\grbl-sim-backpressure-u4.ts` | Copies of the repo files with imports pointed at `tree\src`; the only behaviour change is "no block retires in Hold or Door" |
| `zz-u4-bundle-sim.mjs` → `zz-u4-sim.js` | esbuild 0.28.1 bundle of the above |
| `zz-u4-host.mjs` | Static host with the production headers (copy of `zz-u2r-host.mjs`), `node zz-u4-host.mjs dist 4941` |
| `zz-u4-drive.mjs`, `zz-u4-run.sh` | Playwright driver on 4942 (POST a JS body); `cat zz-u4-setup.js body.js \| ./zz-u4-run.sh` |
| `zz-u4-setup.js` | Shared steps: `setupMachine(cfg)`, `drawDesign()`, `jogXY(n)`, `toFramed()`, `evSince(n)` |
| `shots\*.png` | Screenshots cited above |

To rebuild: `git archive c93fbb3bc src public scripts index.html vite.config.ts package.json tsconfig.json electron` into `zz-u4\tree`, junction `node_modules` to the main checkout's, copy `zz-u2r\tree\zz-u2r-vite.config.ts` as `zz-u4-vite.config.ts`, and run `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u4-vite.config.ts --outDir ../dist`. `zz-u4-bundle-sim.mjs` needs `zz-u4\tree\src` in place. `dist` and `tree` were deleted after the run to save space.

## Refuter summary

**Refuter:** a fresh context, 2026-11-03.
- **Tree:** `origin/main` c93fbb3bc, re-fetched. Still the head of main.
- **Build:** my own production build: `git archive origin/main` into `zz-u4r\tree`, a `node_modules` junction, `zz-u4r-vite.config.ts` (main's config plus the fflate alias), and Vite build into `zz-u4r\dist`.
- **Host and driver:** `zz-u4r-host.mjs` on 4991 and `zz-u4r-drive.mjs` on 4992, headless installed Chrome with a fresh context per run. Steps are in `r-setup.js` (`setupMachine`, `setupHoming` with **Enable Home ($H)** ticked, `drawRect`, `toFramed`, `startJob`). Bodies are POSTed with `zz-u4r-run.sh`.
- **Machine:** the repo's GRBL simulator **unmodified**, bundled from my tree (`simsrc\zz-u4r-sim-entry.ts` → `zz-u4r-sim.js`). It is not the auditor's Hold-retire variant, so every finding was reproduced without that change.
- **Paths:** `zz-u4r` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u4r`. Screenshots `r01`–`r72` are in `zz-u4r\shots\`.
- **Cleanup:** `dist` and `tree` were deleted at the end; the junction was removed first with `cmd /c rmdir`.
- **LightBurn:** the 2.0 docs, read only, at the pinned versioned paths cited under each finding.

**Tally:** of 14 findings, 13 confirmed at their severity and 1 severity change; 0 refuted. No new finding. The 8 KNOWN and the auditor's 5 refutations are upheld.

| ID | Auditor | Refuter | One line |
|---|---|---|---|
| U4-P2-1 | P2 | P2 (P1 rejected) | No glasses, fire or stay-with-it reminder anywhere on the web path, first launch included; Job Review has none for a verified laser. Not P1: the output is correct, and missing advice is neither wrong output nor an unexpected firing. LightBurn's app has no default prompt either (an optional Job Checklist only), but its first-project doc says "Never run your laser unsupervised". KerfDesk's lesson doesn't. ADR-224's "safety acknowledgement" means the absorbed `$32`/CNC confirms, so that anchor is replaced by the twin: "Wear laser safety glasses" appears for the low-power dot (`CentreSelectionButton.tsx:112`) but never for a job. |
| U4-P2-2 | P2 | **P3** | Focus guidance really is one line. But nothing blocks or is false, an unfocused burn is faint rather than misplaced, Job Review already says "Run a material test on scrap", and LightBurn's app has no focus prompt either (docs only). Wording and polish. |
| U4-P2-3 | P2 | P2 (P1 rejected) | Reproduced: Abort → ALARM:3 → origin gone (`WCO:0`) → Unlock → Frame offer → origin at the stop point (5 mm off in my run, 69 mm in the auditor's). Not P1: before any output the only prompt says "at the current head position — the job runs from here", the card says "Position is lost", and **Go to work zero** is disabled with "Set a work origin…". **Review recovery** explains the loss and offers **Restore saved origin**, but it is buried. Stock GRBL and FluidNC lasers only: grblHAL keeps G92 through a reset, Marlin aborts without a reset, and a GRBL CNC Frame refuses until Z is re-zeroed. |
| U4-P2-4 | P2 | P2 (P1 rejected) | Reproduced never-homed (Frame to machine X 470, Y 410 on a 400 bed, "Ready to start") and homed (Frame past the homed 0; Job Review lists "X out of bed: 430"; the canvas shows red dashes). Not P1: the move is beam-off, it traces the footprint the operator asked for, and ADR-228 demotes out-of-bed to warnings. LightBurn's out-of-bounds check needs homing and skips GRBL framing. KerfDesk's own jog warning is the twin that keeps it P2. |
| U4-P2-5 | P2 | P2 | Both routes into Unlock dead-end with "Wait for a complete status report": the rail's **$X — Unlock** and Console `$X`. ADR-367 Decision 2 covers only the Frame's own offer. Home and Set origin stay visible as ways out. It needs a homing profile (Absolute default). |
| U4-P2-6 | P2 | P2 | Four first-job warnings, one actionable. The 4040 paragraph shows on a generic machine. It is the Job Review twin of U3-P3-6 and should share one fix card. |
| U4-P3-1 to P3-8 | P3 | P3 | All reproduced on screen: Door label, door hold with no Resume (Pause → Resume works), stale "Frame expired" and "Run", ALARM:1 card after Reset, cable-pull card, the stale "Last Frame attempt blocked" after Set origin, mixed coordinate frames, and the modal second-pass prompt. P3-7's file:line corrected to `job-review-format.ts:77`. |

**Hand-off from U3's refuter, confirmed.** A first job's Job Review shows "Operation "Rectangle" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass)" unexpanded, second of four warnings. Expanded, it adds "Run a material test on scrap before burning final material." (`zz-u4r\shots\r41-job-review-warnings.png`, `r43-job-review-expanded.png`).

**For the coordinator:**
- **U4-P2-3** is the closest P1 call. The prompt states the placement, but nothing says the beginner's own origin was cleared. Its fix should lift the Review-recovery sentences ("Set origin here would put the origin where the head is now, not where the job started") onto the Alarm 3 card after an owned Abort.
- **U4-P2-1 and U4-P2-2** share one fix: a "Before you start" block in Job Review, plus the same lines in the run lesson.

```json
[
  {"id":"U4-P2-1","severity":"P2","area":"first-burn","file":"src/ui/laser/job-review/JobReviewAcknowledgement.tsx","line":18,"anchor":"Contract: ADR-224 Consequences ('the safety acknowledgement'); safety-notice.ts:25-26","evidence":"REPRO","verdict":"CONFIRMED P2 (P1 weighed and rejected; ADR-224 anchor corrected to Twin CentreSelectionButton.tsx:112)","known":false,"summary":"No glasses/fire/stay-with-it reminder anywhere on the burn path; with laser mode verified Job Review has no safety section; the app's own 'never leave unattended' is only in Help and About"},
  {"id":"U4-P2-2","originalSeverity":"P2","severity":"P3","area":"first-burn","file":"src/ui/laser/FocusJogControls.tsx","line":23,"anchor":"AREAS U4; twin: setup checklist names 'focus method' but no per-job surface does","evidence":"REPRO","verdict":"P2→P3 (refuter): weak burn, nothing false on screen; Job Review already asks for a material test; LightBurn has no in-app focus prompt either","known":false,"related":["G-S13-2"],"summary":"Focus guidance is one line ('Manual focus: adjust the laser head by hand.'); nothing says how, mentions material thickness, or reminds before Frame/Start"},
  {"id":"U4-P2-3","severity":"P2","area":"first-burn","file":"src/core/controllers/grbl/alarm-codes.ts","line":76,"anchor":"Contract: ADR-053 Decision 3 (reset clears G92), ADR-367 Decision 6","evidence":"REPRO","verdict":"CONFIRMED P2 (P1 weighed and rejected: the confirm names the placement before output; stock GRBL/FluidNC lasers only)","known":false,"related":["D-1 (2026-10-20)"],"summary":"After ABORT JOB: 'Alarm 3: Reset during motion … Re-home the machine' on a no-homing machine, no 'laser is off', origin (G92) silently cleared; next Frame offers to set origin where the head stopped and the re-run lands 69 mm away. P1 weighed"},
  {"id":"U4-P2-4","severity":"P2","area":"first-burn","file":"src/ui/state/frame-homed-area-warning.ts","line":25,"anchor":"Twin: jog bound warning (laser-jog-warnings.ts) and grblHAL Frame warning vs stock-GRBL Frame","evidence":"REPRO","verdict":"CONFIRMED P2 (P1 weighed and rejected: beam-off, ADR-228 demotes out-of-bed to warnings; LightBurn also silent on a never-homed Frame)","known":false,"related":["ADR-237 Consequences"],"summary":"Frame driven 75 mm past a 400 mm bed reports 'Frame complete' on stock GRBL; never-homed User Origin gets no bed warning anywhere though a jog to the same X warns; homed Absolute warns only in Job Review as 'Line N: X out of bed'"},
  {"id":"U4-P2-5","severity":"P2","area":"first-burn","file":"src/ui/laser/frame-dispatch-support.ts","line":20,"anchor":"Contract: ADR-367 Context 2, Decision 6","evidence":"REPRO","verdict":"CONFIRMED P2 (rail Unlock and Console $X both dead-end)","known":false,"summary":"After the rail's $X Unlock, Frame (Absolute) refuses with 'Wait for a complete status report, then Frame again' forever; the fix is Home or Set origin, which it doesn't name"},
  {"id":"U4-P2-6","severity":"P2","area":"first-burn","file":"src/ui/laser/job-intent-warnings.ts","line":35,"anchor":"Contract: ADR-224/ADR-228 (Job Review is the warning surface); AREAS U4 item 4","evidence":"REPRO","verdict":"CONFIRMED P2 (twin of U3-P3-6 on Job Review)","known":false,"summary":"First-job Job Review shows four expert notes (bed mapping unverified, Neotronics 4040 fill policy, scan-offset table, runways) and a FILL RUNWAY tile; none tells a beginner what to check"},
  {"id":"U4-P3-1","severity":"P3","area":"first-burn","file":"src/ui/laser/job-control-copy.ts","line":6,"anchor":"Twin: tooltip 'feed hold only' vs 0x84 on the wire","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Pause shows 'State: Door:0' and a 'Door' head label; tooltip says feed hold"},
  {"id":"U4-P3-2","severity":"P3","area":"first-burn","file":"src/ui/laser/LiveMotionBar.tsx","line":352,"anchor":"AREAS U4 item 6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Machine door hold says 'Release it with cycle start on the machine' and offers no Resume; Pause then Resume works"},
  {"id":"U4-P3-3","severity":"P3","area":"first-burn","file":"src/ui/laser/JobActionControls.tsx","line":217,"anchor":"Twin: rail state vs canvas/status bar","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"'Frame expired … changed after Frame' during a normal run; 'Run' label and time left stay after Abort/alarm/unplug"},
  {"id":"U4-P3-4","severity":"P3","area":"first-burn","file":"src/core/controllers/grbl/alarm-codes.ts","line":64,"anchor":"ADR-367 Decision 6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"ALARM:1 card still says 'press Reset (Ctrl-X)' after Reset, and 're-home' on a no-homing machine"},
  {"id":"U4-P3-5","severity":"P3","area":"first-burn","file":"src/ui/state/laser-safety-notice.ts","line":200,"anchor":"AREAS U4 item 6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cable-pulled card: 'may still be moving' not 'may still be burning'; 'Reconnect and home' on no-homing; checkpoint jargon paragraph"},
  {"id":"U4-P3-6","severity":"P3","area":"first-burn","file":"src/ui/laser/start-blocked-setup-offers.ts","line":16,"anchor":"AREAS U4 items 2-3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"related":["U2-P3-7"],"summary":"Frame title 'generated motion envelope with the tool off'; origin offer doesn't name the design corner; 'Last Frame attempt blocked' stays after origin is set"},
  {"id":"U4-P3-7","severity":"P3","area":"first-burn","file":"src/ui/laser/job-review/job-review-format.ts","line":77,"fileNote":"label at src/ui/laser/job-review/job-review-format.ts:77; out-of-bed text src/core/invariants/predicates.ts:199","anchor":"Twin: 'Machine space' label vs work-coordinate numbers vs bed-coordinate warnings","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Job Review mixes coordinate frames (negative work coords under 'Machine space', out-of-bed lines in bed coords)"},
  {"id":"U4-P3-8","severity":"P3","area":"first-burn","file":"src/ui/laser/second-pass/SecondPassCompletionPrompt.tsx","line":48,"anchor":"AREAS U4 item 7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"First 'Job complete' is a modal about darkening areas; laser-off/back-at-origin and Run again are behind it"},
  {"id":"KNOWN-U2-P3-7","known":true,"summary":"User Origin default; canvas place ignored; Start-from modes explained only by tooltip"},
  {"id":"KNOWN-U1-P3-2","known":true,"summary":"Red 'Relative view — physical bed position unverified'"},
  {"id":"KNOWN-L8-P2-6","known":true,"summary":"Origin cross at rear-left for a front-left machine"},
  {"id":"KNOWN-U3-P2-1","known":true,"summary":"Starter power/speed; Job Review does advise a material test"},
  {"id":"KNOWN-G-S13-2","known":true,"summary":"No material-thickness / focus-offset field"},
  {"id":"KNOWN-D-1","known":true,"summary":"Owned Abort resets at once (ALARM:3 after every Abort); maintainer decision pending"},
  {"id":"KNOWN-ADR-237","known":true,"summary":"Frame runs before any warning surface (accepted)"},
  {"id":"KNOWN-U2-P2-2","known":true,"summary":"Raw error:N (error:9 to M5/M9 after Abort, Console only)"}
]
```
