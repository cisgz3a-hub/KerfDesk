# New-user experience audit U1 — U5 Errors and recovery

- **When:** 2026-11-03 **Tree:** origin/main @ `c93fbb3bc` (`git diff 22dca0a20 c93fbb3bc -- src` is empty, so U1–U3's citations still hold).
- **Scope:** a beginner meets an error and follows only what the screen says. Covered: alarms on connect and while idle (ALARM:1, 2, 3, 9, the `$H`/`$X` boot lock, a critical alarm that predates the connection); Marlin `kill()`; a grblHAL door and E-stop; idle cable pull, idle controller reset and a busy port; a rejected `$` setting write; broken, empty, huge, unreadable, newer and missing-font files; a failed Save and full browser storage; Free and licence limits (read, plus one web repro); an uncaught exception and a render crash. Mid-burn cases are U4's.
- **How:** a production web build of main (`vite build` of a `git archive`), served with the repo's COOP/COEP/CSP headers on 127.0.0.1:4951 and driven by Playwright in installed Chrome on 4952 from a clean profile per run. The fake Web Serial port is the U2 refuter's `zz-u2r-fake-serial.js`, extended for U5 (see Repro files). It follows the firmware rules KerfDesk's own code cites: stock GRBL answers nothing, not even `?`, in a critical alarm (`controller-reset-required.ts:4-6`), and grblHAL answers `?` and refuses `$X`/`$H` with `error:79` (`:7`, HF-3). File pickers are U3's harness. Browser storage was filled for real (CDP `Storage.overrideQuotaForOrigin` and a full `localStorage`). No hardware was operated, and nothing was downloaded or installed.
- **Counts:** 14 raised → 0 refuted → **P1 0 / P2 1 / P3 13** (+ 5 KNOWN re-observed). Five of my own candidates were refuted during the run (see Refuted).
- **Counts after the refuter:** 14 raised → 0 refuted → **P1 0 / P2 1 / P3 13** (+ 5 KNOWN upheld). All 14 confirmed at their severity; 0 severity changes. P2 was weighed and rejected for U5-P3-7 and U5-P3-9. One sub-claim of U5-P2-1 is refuted as a harness artefact: the stock-GRBL "Found your GRBL v1.1 controller … The controller answered" screen. The P2 stands on the grblHAL path. See [Refuter summary](#refuter-summary).

## Headline

Most errors a beginner meets are explained in plain words, with the right next button, and the machine is left stopped:
- a limit or E-stop alarm seen while connected offers a single **Reset (Ctrl-X)**;
- a halted Marlin board is explained;
- an idle cable pull reconnects on its own when replugged;
- Frame in Alarm is refused with a reason;
- a crash keeps the work (**Save project** on the crash screen; autosave runs outside the boundary).

No P1 was found: no error path moved the machine or fired the laser, and no work was lost.

**The one P2, U5-P2-1: a controller already locked by a limit or E-stop before KerfDesk connected.**
- Machine Setup greets it as "Found your GRBL v1.1 controller … The controller answered but reported no settings KerfDesk maps. Enter the manufacturer values in the next step."
- The Machine tab shows an ordinary "Controller reports Alarm" card with **$X — Unlock**.
- On grblHAL, Unlock answers "The controller rejected a command (error:79). Check the Laser Log, wait for Idle, and home before continuing…". No Reset is offered anywhere, although KerfDesk's own decode of `error:79` says "Press Reset (Ctrl-X)".
- The way out is Disconnect then Connect, because Disconnect happens to send Ctrl-X. Nothing says so.

**The message that most needs rewriting** is the shared "Controller rejected a command … (error:N). Check the Laser Log, wait for Idle, and home before continuing if position is uncertain" (`laser-safety-notice.ts:515`). It is U2-P2-2's text. In U5 it also met a refused Unlock (`error:79`), a refused `$32=1` (`error:17`) and a Marlin halt (as the title). Each time it named a log that doesn't exist and advised homing, which was impossible or irrelevant.

## Beginner journey

Screenshots are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u5\shots\` (`shots\` below).

### Alarms
1. **Hard limit while idle (stock GRBL, homing on).** I raised `ALARM:1` + `[MSG:Reset to continue]` with the Artwork tab open. Nothing changed on screen: the toolbar stayed green "Connected", there was no toast, and **Frame job** stayed orange (`ai-01-idle-alarm1-artwork-tab.png`) → U5-P3-1.
   - The Machine tab shows "Alarm 1: Hard limit triggered … The controller stopped on a critical event … Press Reset (Ctrl-X), then Unlock or Home." with one **Reset (Ctrl-X)** button (`a1-04-alarm1-machine-panel.png`). The controller answered nothing for 25 s and KerfDesk raised no silence notice (`ai-04-idle-alarm1-faithful-25s.png`). Clean.
   - After Reset the card keeps "Alarm 1" but now says "The controller accepts only a soft reset now: press Reset (Ctrl-X). Then clear the obstruction and re-home", next to **Home ($H)** and **$X — Unlock** (`ai-05-idle-alarm1-faithful-reset.png`) → U5-P3-2. Unlock recovered to Idle.
2. **Frame in Alarm.** "Last Frame attempt blocked — Controller is in Alarm. Home it if the machine has homing switches, or Unlock it once the head is safe, then try again." Nothing was sent (`a1-05-alarm1-frame-click.png`). Clean.
3. **ALARM:2 and ALARM:3.** ALARM:2 got the same Reset card. ALARM:3 got "Re-home the machine ($H) before resuming work." with Home and Unlock (`ai-03-alarm3.png`). Clean.
4. **Homing failure.** Home on a machine whose switch is never reached gives `ALARM:9`, then GRBL's reset banner. The card reads "Alarm 9: Homing fail — could not find limit switch … Check the switch wiring, or increase max travel ($130–$132) or decrease pull-off ($27), then re-home ($H)." with **Home ($H)** first. The toast reads "Error: Home: ALARM:9" (`a9-02-after-alarm9.png`) → U5-P3-3, plus KNOWN U2-P2-2 for the toast.
5. **Boot lock** (`Grbl 1.1h` + `[MSG:'$H'|'$X' to unlock]`). "Controller reports Alarm … Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe." (`rb-01-board-reset-idle.png`; also U2 `sc-04`). Clean, apart from KNOWN E2-P3-1.
6. **A critical alarm that predates the connection** (a board that does not reset when the port opens):
   - Stock GRBL, silent. Machine Setup says "Found your GRBL v1.1 controller … answered but reported no settings" (`pc-10-grbl-silent-setup-30s.png`). **Read again** sends `$I` and changes nothing (`a1-08`/`a1-09`).
   - Behind the modal, a "Machine stopped answering … Reconnect controller" card waits (`pc-11-grbl-silent-main.png`). Reconnect sends Ctrl-X and recovers (`pc-12`).
   - grblHAL. Setup fills in values normally (`pc-20`). The Machine tab shows the ordinary Alarm card. **$X — Unlock** gives the raw `error:79` notice, an "Error: Unlock: error:79" toast, and still no Reset (`pc-23-hal-driver-unlock-79.png`).
   - Disconnect → Connect recovers, and Unlock then works (`pc-04`, `pc-05`) → **U5-P2-1**.

### Marlin and grblHAL
7. **Marlin `kill()`** (`Error:Printer halted. kill() called!`). The notice says "The controller halted its firmware … Press the controller's reset button or power-cycle it, then reconnect. Position is unknown after a halt, so home before running a job." It is titled "Controller rejected a command", and the rail still says "State: Idle" (`mk-07-killed-20s.png`) → U5-P3-6.
   - Pressing the board's reset recovered without a reconnect: a jog then ran (`mk-10`).
   - Before that, U5-P3-7 met me on the way: **Use detected Marlin in draft** → **Apply to draft** changed the working 115200 connection's draft to 250000. Reconnect then gave "Your machine didn't answer. Nothing came back at 250000 baud." **Try other speeds** fixed it (`mk-02` … `mk-04`).
8. **grblHAL door, idle.** Opening it gives the "CONTROLLER DOOR HOLD" bar: "The controller reports its door or lid input open and has stopped motion. Close it, then release it with cycle start or clear it with Abort" (`hal-02-door-open.png`).
   - After closing: "The controller is in its door-safety state and has stopped motion. Release it with cycle start, or Abort to clear it with a controller reset", with only **ABORT MOTION** (`hal-03-door-closed.png`) → U5-P3-5. ABORT MOTION sent Ctrl-X, M5, M9 and returned to Idle (`hal-05`).
9. **grblHAL E-stop** (Ortur LM3 profile, grblHAL driver). "Alarm 10: E-stop asserted (grblHAL) — The hardware E-stop is active." + the generic Reset sentence (`hal-06-estop.png`).
   - Reset while it is still pressed brings back the same card, with nothing new (`hal-07`). Release, Reset, Unlock → Idle (`hal-08`) → U5-P3-2.
   - On the stock GRBL driver (setup cancelled, or the U2-P2-1 path), the same alarm reads "Alarm 10: Homing fail — dual-axis switch" (`hal-09-estop-stock-driver.png`) → U5-P3-4.

### Disconnects when idle
10. **Cable pulled.** The toolbar turns grey "Not connected" with an orange **Connect**. There is no toast (`dc-03-cable-pulled-real.png`). Replugging auto-connects and re-reads settings (`dc-04-replugged.png`). Clean (quiet, but the next step is obvious).
11. **Controller resets itself while idle.** Settings are re-read, and the boot lock card appears when homing is on (`rb-01`). Clean.
12. **Port taken by another program.** U2 verified the Connect path ("The port is busy or unavailable. Close any other program…"). The auto-connect path says "Didn't connect by itself: the machine's port is in use by another program. Close it, then Connect." (READ, `ConnectionBar.tsx:376-380`). Clean.

### Settings writes
13. **Console `$32=1`** on a build without PWM (`error:17`), then `$22=1` (`error:7`).
    - The native confirm says "Send persistent controller setting?". The red notice then says "The controller rejected a command (error:17). Check the Laser Log, wait for Idle, and home before continuing if position is uncertain. Rejected line: $32=1", with the interrupted-job paragraph and **I made the machine safe** (`sw-06-console-321.png`).
    - The decoded "Laser mode needs PWM…" is only in the Console transcript. The second rejection did not replace the notice; it showed only as a bare "error:7" (`sw-06-console-221.png`) → KNOWN U2-P2-2, plus U5-P3-13.
    - Machine Setup's own firmware write (READ) would toast "Software setup was saved, but firmware sync stopped: error:17 Reopen Machine Setup after checking the controller." (`use-machine-setup-save.ts:102-105`).

### Files
14. **Open a corrupt `.lf2`** (truncated): "Could not open corrupt.lf2: not valid JSON: Expected ',' or '}' after property value in JSON at position 19437 (line 1 column 19438)" (`f1-open-corrupt-lf2.png`). An empty file and a renamed zip got the same treatment → U5-P3-8. The canvas stays as it was.
15. **Newer project:** "This project was saved with a newer KerfDesk (schemaVersion 99). Update the app to open it." (native alert). Clean enough.
16. **Missing font** (`fontKey: "system:Bauhaus 93"`). "Success: Opened missing-font.lf2" with no warning. The burn keeps the saved outline (`f2-missing-font-preview.png`).
    - Editing the text shows "Missing font: system:Bauhaus 93" with **Import** and **System fonts…**, and Done is disabled.
    - The reason, "Font … is not available. Relink it to edit.", is drawn at y = 722 px, below the panel's visible bottom edge (about 650 px) (`f4-missing-font-after-edit.png`) → U5-P3-9.
17. **Imports:**
    - Broken SVG: "SVG parse error: 1:134: unexpected close tag." Empty SVG: "1:0: document must contain a root element." → U5-P3-10.
    - "nothing.svg has no drawable content".
    - PDF: "Could not read PDF. Password-protected files must be unlocked first. Invalid PDF structure."
    - Binary DXF: "Binary DXF is not supported — re-export as ASCII DXF."
    - 3DSOLID-only DXF: "no supported geometry — skipped 1 3DSOLID." (`f5-import-*.png`).
    - A 9 MB SVG with 300 000 paths shows "reading / parsing in worker. Press Esc to cancel." and lands as 1 object after about 35 s, with one page stall of about 8 s (`f6-huge-*.png`).
18. **Save into a read-only folder:** "Could not save project: An attempt was made to modify an object where modifications are not allowed." The title stays "Not saved to file" (`f7-save-readonly.png`) → U5-P3-11.
19. **Browser storage full** (IndexedDB quota 2 KB and `localStorage` full): "Autosave could not preserve the newest project. Save the .lf2 file manually; image-heavy projects can exceed browser storage." (`f8-autosave-full.png`). Clean.

### Licence and crashes
20. **Free meets a Pro tool:** "Design Studio is a Pro tool … All Pro features are in the KerfDesk desktop app for Windows … Everything else in KerfDesk stays free, and a licence never stops a job that is running." (`lic-01-design-studio-free.png`). Clean.
21. **Uncaught exception** (injected): toast "Error: Error: Cannot read properties of undefined (reading 'points')" (`cr-01-crash-screen.png`).
    - **Render crash** (injected): the crash screen reads "Something broke", then the raw message and the full stack, then **Save project**, **Copy diagnostic** and **Try again** (`cr-03-crash-screen.png`) → U5-P3-12.
    - Save project wrote a 3 KB `.lf2`, and Try again restored the workspace with its object (`cr-04-after-try-again.png`).

## Findings

### U5-P2-1 — A controller locked by a limit or E-stop before KerfDesk connected is shown as an ordinary Alarm: Unlock fails (grblHAL `error:79`, stock GRBL silence), no Reset is offered, and Machine Setup says the controller "answered but reported no settings"

- **Where:**
  - `src/ui/state/laser-line-handler.ts:252-257`: "reset required" is latched only from the `[MSG:Reset to continue]` line (`controller-reset-required.ts:39-45`). A controller that printed it before the port opened is never latched. A refused Unlock (`error:79`) or a timed-out Unlock does not latch it either.
  - `src/ui/laser/AlarmBanner.tsx:34-36,49-66`: with no latch, the card offers Home or Unlock, never Reset.
  - `src/ui/state/laser-safety-notice.ts:513-516`: `error:79` is shown raw. Yet `src/core/controllers/grbl/grblhal-error-codes.ts:47-49` already says "A hard limit, soft limit, E-stop or motor fault stopped the controller … Press Reset (Ctrl-X), then unlock or home."
  - `src/ui/laser/device-setup/find-machine-phase.ts:145-163`: when the first `$$` is never acknowledged, the qualification is not `failed`, so the strip falls through to "Found your … controller". `DeviceSetupFoundMachine.tsx:41-44` then says "The controller answered but reported no settings KerfDesk maps."
- **What a beginner sees:**
  - **Machine Setup** (opens on the first Connect): a green "Found your GRBL v1.1 controller … The controller answered but reported no settings KerfDesk maps. Enter the manufacturer values in the next step." On stock GRBL nothing at all came back (`rx: []`). **Read again** sends `$I` and nothing changes (`pc-10`, `a1-07`…`a1-09`).
  - **Machine tab:** "Controller reports Alarm — GRBL has locked jog, frame, and start until the machine is homed or unlocked. … Unlock ($X) only after confirming the head is safe." with **$X — Unlock**.
  - **grblHAL:** Unlock → red notice "Controller rejected a command — The controller rejected a command (error:79). Check the Laser Log, wait for Idle, and home before continuing if position is uncertain. Rejected line: $X", the interrupted-job paragraph, **I made the machine safe**, and the toast "Error: Unlock: error:79". The card is unchanged, and no control anywhere names Reset (`resetBtn: []`, `pc-23`).
  - **Stock GRBL:** Unlock sends `$X`, which is swallowed. Only the "Machine stopped answering … Reconnect controller" card, hidden behind Machine Setup while it is open, leads out (`pc-11`).
- **Why it blocks:**
  - The controller accepts only a soft reset. The beginner is offered Unlock, and Home (which needs homing switches); both are refused.
  - The advice "home before continuing" cannot be followed: Home is refused too, and with homing off the button is "Set up homing".
  - Disconnect → Connect works only because Disconnect sends Ctrl-X (`pc-04` tx: `\x18`, `M5`, `M9`, then `$$`). Nothing on screen suggests it.
  - Machine Setup's message sends the beginner to type values by hand for a controller that has them but is locked.
- **When it happens:** any board that does not reset when the port opens (the 32-bit and ESP32 boards in most current diode lasers) and was stopped while KerfDesk was not connected. Examples: the E-stop was pressed before power-on or before connecting; a hard limit tripped while another program or a closed tab was in charge; the page was reloaded after a limit alarm. For machines with an E-stop button this is a first-day event.
- **Evidence:** REPRO, `zz-u5-d.sh` scripts in the transcript (blocks `pc-1x` stock GRBL, `pc-2x` grblHAL); fake `preCritical` + `criticalMode: 'grblhal'`.
  - Serial: tx `$X\n` → rx `error:79`. After Disconnect/Connect: tx `\x18 M5 M9 $$ $I $G`, then `$X` → `[MSG:Caution: Unlocked]`, Idle.
  - Shots: `pc-10-grbl-silent-setup-30s.png`, `pc-11-grbl-silent-main.png`, `pc-12-grbl-silent-reconnect.png`, `pc-20-hal-critical-setup.png`, `pc-22-hal-driver-critical.png`, `pc-23-hal-driver-unlock-79.png`, `pc-04-after-reconnect.png`, `pc-05-unlock-after-reconnect.png`.
- **Related:** controller audit 2026-09-25 HF-3 / GP-2 (ADR-393) fixed the case where KerfDesk sees "Reset to continue". This is the case where it was printed before the connection. U2-P2-2 covers the raw `error:N` in the notice. Not a duplicate: the missing Reset offer is the block.
- **Not P1 because:** the machine is stopped and locked throughout. No motion or laser output, no work lost.
- **Fix direction:**
  - Treat `error:79` (grblHAL), a timed-out Unlock in Alarm (stock GRBL), and FluidNC's Critical state as reset-required evidence: latch, and offer **Reset (Ctrl-X)** on the card.
  - Card wording: "The controller is locked after a limit switch, E-stop or motor fault and accepts only a reset. Release the E-stop or move the head off the switch, then press Reset (Ctrl-X). After the reset, Unlock or Home."
  - Machine Setup: when the first settings read gets no acknowledgement, show the `silent` phase. When the status says Alarm, add: "Your controller is in Alarm, so it may not report its settings. Close setup and use the Alarm card on the Machine tab, then Read again."
  - Never print "The controller answered" when no line came back.

**Refuter (2026-11-03):** CONFIRMED P2 on the grblHAL path. I weighed P1 and rejected it. I weighed P3 and rejected it too. Two corrections follow: the stock-GRBL half is a P3-level detour, and its "Found … answered" screen was a harness artefact.

- **Re-checked in main (`c93fbb3bc`):**
  - The latch is set only from `[MSG:…Reset to continue]` (`laser-line-handler.ts:251-261`, `controller-reset-required.ts:39-45`).
  - With no latch the card shows `AlarmRecoveryActions` (Home, Set up homing, Unlock), never Reset (`AlarmBanner.tsx:34-36,49-66`).
  - The notice prints `error:${code}` with "Check the Laser Log … home before continuing" (`laser-safety-notice.ts:496-516`). The decoded `error:79` text that says "Press Reset (Ctrl-X)" sits unused in `grblhal-error-codes.ts:46-50`.
  - Outside the latched card, the only Reset buttons in the UI are `AlarmBanner.tsx:55` and `HeldResumeTailNotice.tsx:24`. No menu, Console or toolbar control sends Ctrl-X.
- **Is the fake controller realistic? grblHAL: yes.** Read at grblHAL/core `d7aaee3d84b1e7010f075d395206afff038d7379`, KerfDesk's own pin. Line numbers are approximate, so functions are named.
  - `alarms.h` `alarm_is_critical()` returns true for HardLimit, SoftLimit, **EStop**, MotorFault and ExpanderException.
  - `system.c` `system_raise_alarm()` sets `sys.blocking_event` from it. `system_execute_line()` refuses any `$` command without `allow_blocking` with `Status_NotAllowedCriticalEvent`, which is `error:79` (KerfDesk's `grblhal-error-codes.ts:47-48` uses grblHAL's own text). `$X` and `$H` lack the flag. `$$` has it, which is why Setup still fills in values.
  - `protocol.c` services status reports and `protocol_poll_cmd()` inside its critical loop, so `?` and `$$` are answered.
  - At boot with the E-stop pressed, `protocol_main_loop()` calls `system_raise_alarm(Alarm_EStop)` and prints `Message_EStop`, which is "Emergency stop - clear, then reset to continue" (`messages.c`). That line goes out before any host has the port open.
  - I found no code in `protocol.c` that re-reports the alarm when a host connects. `stream.c` could not be fetched (timed out), so whether a USB-CDC build re-sends its banner on DTR is **not verified**.
  - So the realistic case is: the E-stop is pressed before KerfDesk connects, or a limit trips while KerfDesk isn't connected, or the page is reloaded after an alarm. Then grblHAL still answers `?` and `$$`, refuses `$X`/`$H` with `error:79`, and waits for Ctrl-X.
- **Stock GRBL: real behaviour, but rare, and the auditor's run was contaminated.**
  - gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e` `protocol.c`, `protocol_exec_rt_system()`: after `MESSAGE_CRITICAL_EVENT`, the loop body is empty and polls only `EXEC_RESET`. A `?` is never serviced, although the comment says "except reset and status reports". `main.c:74-76` keeps the prior state across a soft reset. `HOMING_INIT_LOCK` (`main.c:65-67`) locks at boot when homing is on.
  - **Reach:** stock GRBL runs on AVR boards. Chrome asserts DTR when it opens the port, and KerfDesk's own comments say so (`web-serial-line-errors.test.ts:190`; closing drops DTR, `laser-disconnect-stop.ts:5`). The auto-reset circuit on those boards then reboots the controller, which clears a critical alarm. A pre-connection critical lock on stock GRBL therefore needs a board without auto-reset. Rare.
  - **Harness artefact:** the U5 fake set its critical state in `boot()`, 300 ms after `open()`. KerfDesk's first `?` went out at about 264 ms and got `<Idle|…>`. That one report is why the auditor saw "Found your GRBL v1.1 controller … The controller answered but reported no settings" (`pc-10`, `a1-07`) and a green "State: Idle". I reproduced the artefact (event log: `open 115200` at 8077 ms, `tx ?` at 8341 ms, `rx <Idle|…>` at 8347 ms; `zz-u5r\shots\r11-artefact-leaked-idle-main.png`).
  - I then set the state at `open()` (`zz-u5r-fake-serial.js`). With a **faithful** silent controller, Setup reads "**Your machine didn't answer** — Nothing came back at 115200 baud. The controller may use another speed, or this port belongs to another device." with **Try other speeds** (`r10-grbl-silent-setup-30s-faithful.png`). A port that never answers at all (machine off, wrong device) gives the same screen (`r40-dead-silent-setup-30s.png`).
  - **Following the screen recovers it, by accident.** Try other speeds closes the port first, and that close sends Ctrl-X at 115200, which resets the controller. The scan then skips 115200 and ends with "No answer at any common speed — Tried 230400, 250000, 921600, 57600, 38400, 19200, 9600 baud. Check the USB cable and that the machine is switched on…" (`r14`). Its **Try again** reopens at 115200 and finds the controller, with values filled in (`r15`). The diagnosis ("another speed") is wrong, but every button pressed was one the screen offered.
- **On the wording question:** "Found your GRBL v1.1 controller … reported no settings KerfDesk maps. Enter the manufacturer values in the next step." is **not a P2 on its own**, and is REFUTED for this scenario.
  - With a faithful stock GRBL, it never appears.
  - On grblHAL, the controller really does answer and Setup fills in real values (`r01-hal-setup.png`).
  - Where the message does appear (Marlin, which reports no `$$`; `r24`), it is true.
  - Even read as the auditor saw it, it asks for the manufacturer's values, which are the right ones, and nothing is written to the firmware. The fix direction "never print 'The controller answered' when no line came back" is still sound, but it has no reproduced trigger.
- **Reproduced on grblHAL, on the beginner's default path** (no profile picked): fake `ortur` + `preCritical` + `criticalMode: 'grblhal'`, with the fixed fake.
  - **Connect.** Machine Setup shows "Found your GRBL v1.1 controller", with values filled in from `$$` (`r01-hal-setup.png`). There is no "Use detected grblHAL": the board printed no banner, and banner-only detection is known and documented (`docs/audits/2026-09-25-controller-full-audit/tracks/HF.md:526`).
  - **Next, Next, Save, then the Machine tab.** The card reads "Controller reports Alarm — GRBL has locked jog, frame, and start until the machine is homed or unlocked. … Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe." The buttons are **Set up homing** and **$X — Unlock** (`r02`).
  - **$X — Unlock.** tx `$X` → rx `error:79`. The red notice says "…(error:79). Check the Laser Log, wait for Idle, and home before continuing if position is uncertain. Rejected line: $X", with **I made the machine safe** and the toast "Error: Unlock: error:79". The card is unchanged (`r03-hal-unlock-79.png`).
- **The way out: Disconnect then Connect.** I judge it plausible, which is what keeps this at P2 rather than P1. **Disconnect** is a labelled toolbar button beside the green machine pill, and turning it off and on again is a common beginner reflex.
  - The run: tx `\x18`, `M5`, `M9`, close, open, `$$`. Unlock then gives `[MSG:Caution: Unlocked]` (`r04`–`r06`). Power-cycling the laser would also work, if the board isn't powered from USB (not verified).
  - Nothing on screen points there, and the screen actively offers two wrong actions: Unlock, plus Home or Set up homing.
  - **Worse:** after the reconnect and a successful Unlock, the red "rejected a command (error:79) … home before continuing" notice stays up until **I made the machine safe** is pressed (`r06`). That part is U2-P2-2's notice behaviour.
- **Not P1:** the controller is locked, nothing moves or fires, and no work is lost.
- **Not P3:** on grblHAL, the card and the notice each name a next step that cannot work, and the step that does work is unstated. That is AREAS' P2 ("a message whose words a beginner cannot act on").
- **Overlaps:** the raw `error:79` text and the stale notice are KNOWN U2-P2-2. The stock-driver default for a banner-less grblHAL is the HF.md:526 known behaviour (see U5-P3-4). The missing Reset offer is new: no U2 or U4 finding covers a lock that predates the connection.
- **Fix-direction note:** the Machine Setup half of the fix ("show the `silent` phase when the first settings read gets no acknowledgement") already holds for a faithful silent controller. Keep the `error:79` → latch → **Reset (Ctrl-X)** part, and add FluidNC's `Critical` state (READ: `controller-reset-required.ts:8-9`). Also, the baud scan could try the original baud again after its own reset-on-close.

### U5-P3-1 — An alarm raised while the Artwork tab is open shows nowhere until Frame is pressed

- **Where:** `src/ui/laser/LaserWindow.tsx:98-112` (the card lives only in the Machine rail). The toolbar connection pill shows connection, not controller state.
- **What a beginner sees:** after `ALARM:1` the toolbar stays green "Default 400×400 · Connected", there is no toast, and **Frame job** stays orange (`ai-01-idle-alarm1-artwork-tab.png`). Only pressing Frame says "Controller is in Alarm…".
- **Fix direction:** give the toolbar pill an Alarm state ("Connected · Alarm", red dot), or one toast "Your machine stopped: Alarm 1 (hard limit). Open the Machine tab to recover."

**Refuter (2026-11-03):** CONFIRMED P3. The card is rendered only inside the Machine rail (`LaserWindow.tsx:98-110`). The global error handlers aside, no toast path exists for an alarm (no `pushToast` in `laser-line-handler.ts`).
- **Reproduced:** generic GRBL, connected, Artwork tab, `ALARM:1` + `[MSG:Reset to continue]`. After 3 s there was no toast and no alert; the pill title still read "Default 400×400 · Connected…" and the dot stayed green (`zz-u5r\shots\r50-idle-alarm1-artwork.png`).
- **P3:** Frame refuses with a reason, and the Machine tab is one click away.

### U5-P3-2 — The critical-alarm card hides each alarm's own advice, and after Reset it still says "press Reset"

- **Where:** `src/ui/laser/AlarmBanner.tsx:34-36` (`resetOffer ?? alarmRecoveryAction(...)`); `src/core/controllers/grbl/alarm-codes.ts:63-72,144`.
- **What a beginner sees:**
  - **Before Reset**, every critical alarm gets the same "The controller stopped on a critical event (hard or soft limit, E-stop or motor fault) … Press Reset (Ctrl-X), then Unlock or Home." Neither the ALARM:10 card nor the ALARM:1 card says what to fix (the E-stop, the switch) before the reset. ALARM:10's "Release the E-stop" and ALARM:1's "clear the obstruction" are never shown before the reset. Reset with the E-stop still pressed brings back the identical card (`hal-07`).
  - **After Reset**, ALARM:1's own action appears: "The controller accepts only a soft reset now: press Reset (Ctrl-X). Then clear the obstruction…", next to Home and Unlock, telling the beginner to do again what they just did (`ai-05`).
- **Fix direction:** show the alarm's physical step first, then the reset. ALARM:10: "Release the E-stop (twist it), then press Reset (Ctrl-X)." ALARM:1: "Move the head away from the limit switch by hand, then press Reset (Ctrl-X)." After the reset, use a post-reset sentence: "Reset done. Home ($H) to find the position again, or Unlock if this machine has no homing switches."

**Refuter (2026-11-03):** CONFIRMED P3, in two halves.
- **Before Reset (new):** `AlarmBanner.tsx:34-36` puts `resetOfferMessage` in place of the alarm's own `action`. The card shows the alarm's `detail` ("A limit switch was hit while the machine was moving." / "The hardware E-stop is active.") and then `RESET_REQUIRED_MESSAGE` (`controller-reset-required.ts:33-34`). ALARM:10's "Release the E-stop" (`alarm-codes.ts:144`) is never shown before the reset. READ, plus the auditor's `hal-06`/`hal-07`.
- **After Reset:** a **duplicate of U4-P3-4** (`alarm-codes.ts:64`), which U4's refuter reproduced (`zz-u4r\shots\r61-alarm1-after-reset.png`). Don't count it twice; one fix card should cover both halves.

### U5-P3-3 — Homing-failure alarms (8, 9) advise `$` settings and offer Home again; nothing asks whether the machine has homing switches

- **Where:** `src/core/controllers/grbl/alarm-codes.ts:115,122-123`; `AlarmRecoveryActions.tsx` puts **Home ($H)** first.
- **What a beginner sees:** "Check the switch wiring, or increase max travel ($130–$132) or decrease pull-off ($27), then re-home ($H)." The beginner has no screen for `$130` or `$27`. The commonest beginner cause is Home enabled on a machine without working switches. Pressing Home again drives each axis up to the firmware's search distance into the frame again (`a9-02-after-alarm9.png`).
- **Fix direction:** "Homing couldn't find a switch. If this machine has no homing switches, turn Home off in Machine Setup and Unlock. If it has switches, check that their cables are plugged in, then Home again." Add **Open Machine Setup**, and put Unlock first.

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `alarm-codes.ts:115` (ALARM:8) and `:122-123` (ALARM:9). `AlarmRecoveryActions.tsx:42` renders Home first whenever homing is on; Unlock comes first only on the halted branch (`:24-36`). Not re-run; this is READ plus the auditor's `a9-02`. The "Error: Home: ALARM:9" toast is KNOWN U2-P2-2.

### U5-P3-4 — On the stock GRBL driver, a grblHAL E-stop reads "Alarm 10: Homing fail — dual-axis switch"

- **Where:** `src/ui/laser/LaserWindow.tsx:54,101` passes `activeControllerKind` (the live driver) to `presentAlarm`. `src/core/controllers/grbl/alarm-codes.ts:127-134`.
- **What a beginner sees:** after Connect → Cancel (or U2-P2-1's connect-then-pick-then-Save path), the banner reported grblHAL, but the E-stop gives "Alarm 10: Homing fail — dual-axis switch. The second limit switch on a dual-motor axis did not trigger… (grblHAL firmware uses alarm 10 for E-stop instead.)" (`hal-09-estop-stock-driver.png`).
- **Fix direction:** decode with the firmware the controller reported (the banner), not the live driver. Or lead with "E-stop pressed (grblHAL)" whenever the welcome banner said grblHAL. Add this case to U2-P2-1's fix card.

**Refuter (2026-11-03):** CONFIRMED P3. `LaserWindow.tsx:54,101` passes `activeControllerKind`; `alarm-codes.ts:127-134` holds the stock text, with its "(grblHAL firmware uses alarm 10 for E-stop instead.)" hint.
- **Wider reach than the auditor's route:** a grblHAL board that does not reset on port open prints no banner, so even a plain toolbar Connect leaves the beginner on the stock GRBL driver. Setup said "Found your GRBL v1.1 controller", although `$I` returned `[FIRMWARE:grblHAL]` (`zz-u5r\shots\r01-hal-setup.png`). Banner-only detection is known (`HF.md:526`); its effect on the alarm decode is this finding.
- **Kept P3:** the decoded card's own parenthesis names E-stop. `ControllerPinNotice.tsx:23` adds "The controller reports its E-stop pressed." whenever `Pn:E` is reported.

### U5-P3-5 — An idle door hold says "release it with cycle start", which names no control; only ABORT MOTION is offered

- **Where:** `src/ui/laser/live-motion-unowned.ts:19,82-87` (deliberately no Resume).
- **What a beginner sees:** "CONTROLLER DOOR HOLD — The controller is in its door-safety state and has stopped motion. Release it with cycle start, or Abort to clear it with a controller reset" with a red **ABORT MOTION** and "Software controller stop — use the physical E-stop or power isolation for danger" (`hal-03-door-closed.png`). Most hobby lasers have no cycle-start button. The beginner just closed a lid after loading material, and is offered an emergency-styled control and nothing else.
- **Evidence:** REPRO. ABORT MOTION sent `\x18 M5 M9 $G` and the controller went Idle (`hal-05-after-abort.png`). Whether a set work origin survives that reset was not checked.
- **Fix direction:** "The lid or door was opened, so the controller paused. Close it, then press **Continue**." That needs a Continue (`~`) offered only when the door input is closed and no job is held. If the ADR-375 no-Resume rule stays, say "Press ABORT MOTION to clear the pause. Nothing is running, so nothing is lost, but set the origin again before you start."

**Refuter (2026-11-03):** CONFIRMED P3. The text is at `live-motion-unowned.ts:19` (`HOLD_RELEASE`) and `:82-87`. Not re-run; this is READ plus the auditor's `hal-02`/`hal-03`/`hal-05`.
- **Sibling of U4-P3-2,** the mid-job door hold at `LiveMotionBar.tsx:346-353`, with the same "cycle start" advice. That one is the owned bar, this one the unowned bar, so they are separate places. They should share one fix card.

### U5-P3-6 — A Marlin halt is titled "Controller rejected a command", and the rail keeps "State: Idle" and "Connected"

- **Where:** `src/ui/laser/SafetyNoticeBanner.tsx:18` (the title by kind `controller-error`); `src/ui/state/laser-safety-notice.ts:293-308` (`controllerHaltedNotice` reuses that kind).
- **What a beginner sees:** "Controller rejected a command — The controller halted its firmware (Error:Printer halted. kill() called!) and answers nothing until it is reset…", the interrupted-job paragraph with no job, "State: Idle", and a green "Connected" (`mk-07-killed-20s.png`). The body is good. The title and the status contradict it.
- **Fix direction:** title "Controller halted — press its reset button". Show the rail state as "Halted" until the controller's start banner arrives.

**Refuter (2026-11-03):** CONFIRMED P3. `SafetyNoticeBanner.tsx:18` titles every `controller-error` notice, and `controllerHaltedNotice` reuses that kind (`laser-safety-notice.ts:301-308`).
- **Reproduced:** Marlin fake under the Marlin driver, then `Error:Printer halted. kill() called!`. The notice was titled "Controller rejected a command", the rail read "State: Idle", and the pill title "Default 400×400 · Connected…" (`zz-u5r\shots\r60-marlin-killed.png`). The body is plain and correct.

### U5-P3-7 — "Use detected Marlin in draft" → "Apply to draft" changes a working 115200 connection to Marlin's 250000 starter, so the next Reconnect "didn't answer"

- **Where:** the Marlin starter's baud (`src/core/devices` Marlin starter, 250000) applied by `DeviceSetupDetectedApply`. The live baud is not kept.
- **What a beginner sees:** after Apply, Connection options reads "Marlin · 250000 baud" while connected at 115200. **Reconnect using selected profile** → "Your machine didn't answer. Nothing came back at 250000 baud." **Try other speeds** recovers (`mk-02` … `mk-04`).
- **Fix direction:** when adopting a detected firmware, keep the baud the controller just answered at. Show "Baud 115200 (kept: your controller answered at this speed)".

**Refuter (2026-11-03):** CONFIRMED P3. I weighed P2 and rejected it: the app warns about the change before it happens, and it offers the way out in the same place, as the primary button.
- **Where:** `controllerSelectionChanges` lists the baud the selection resets (`device-setup-controller-selection.ts:58`, `baudRateOf` `:94-96`, the Marlin starter's `baudRate: 250000` at `profile-catalog.ts:104`). `DeviceSetupUseDetectedController.tsx:21-58` shows that list before **Apply to draft**. The JSON's `line: null` can be `DeviceSetupUseDetectedController.tsx:53`.
- **Reproduced:** Marlin fake at 115200, toolbar Connect.
  1. The card says "The firmware banner differs from this setup … If this machine runs Marlin, use it in the draft."
  2. **Use detected Marlin in draft** lists "Baud rate: 115200 → 250000", with no reason, among three other changes that each have one (`zz-u5r\shots\r21-marlin-changes.png`).
  3. **Apply to draft**, then **Reconnect using selected profile**, gives "Your machine didn't answer — Nothing came back at 250000 baud…" (`r23`).
  4. **Try other speeds**, the orange primary button on that card, reopened at 115200 on its first try and showed "Found your Marlin controller" (`r24`). Opens: 115200, 250000, 115200.
- **Not P2:** not a dead end. The beginner was shown the baud change before applying it, and the next screen's primary button recovers in one click. The finding stands as a bad default plus an unexplained list line ("115200 → 250000" with no "your controller answered at 115200").

### U5-P3-8 — A damaged or empty project gives a JSON parser message

- **Where:** `src/ui/app/project-open-completion.ts:63`, `src/ui/app/file-action-formatters.ts:15`, `src/io/project/deserialize-project.ts:69-71,84`.
- **What a beginner sees:** "Could not open corrupt.lf2: not valid JSON: Expected ',' or '}' after property value in JSON at position 19437 (line 1 column 19438)". For an empty file, "…: not valid JSON: Unexpected end of JSON input" (`f1-open-*.png`).
- **Fix direction:** "corrupt.lf2 is damaged or incomplete (it may have been cut off while saving or copying), so KerfDesk can't open it. Your current design is unchanged. Open an earlier copy of the file if you have one." Keep the parser detail in the log.

**Refuter (2026-11-03):** CONFIRMED P3. `project-open-completion.ts:63` builds `Could not open ${fileName}: ${describeOpenResult(result)}`. Reproduced: "Error: Could not open corrupt.lf2: not valid JSON: Expected ',' or '}' after property value in JSON at position 19437 (line 1 column 19438)" (`zz-u5r\shots\r51-corrupt-lf2.png`). The canvas was unchanged.

### U5-P3-9 — A project with a missing font opens with "Success", and the reason editing is blocked is drawn off-screen and names a control that doesn't exist

- **Where:** `src/ui/state/project-load-notices.ts` (no font check); `src/ui/text/font-loader.ts:113` ("Relink it to edit."); `src/ui/text/CanvasTextPanel.tsx` (`.lf-canvas-text-error` below the panel's visible area).
- **What a beginner sees:** "Success: Opened missing-font.lf2". On editing: "Missing font: system:Bauhaus 93", **Import**, **System fonts…**, and Done disabled. The explanation sits at y = 722 px, below the panel's visible bottom edge at about 650 px (`f4-missing-font-after-edit.png`), and says "Relink", which no button is called.
- **Not a burn risk:** the saved outline still burns (`f2-missing-font-preview.png`). Rolling v2 15-scene-text called the behaviour "honest"; this finding is about the words and layout.
- **Fix direction:** a warning toast on open: "This project uses a font that isn't on this computer (Bauhaus 93). It will burn as saved; to edit the text, choose Import or System fonts… in the text panel." Show the panel's reason above Done: "Choose a font with Import or System fonts… to edit this text."

**Refuter (2026-11-03):** CONFIRMED P3. I weighed P2 and rejected it.
- **Re-checked in main:**
  - `project-open-completion.ts:49-53` pushes `Opened ${fileName}` as a `success` toast.
  - `project-load-notices.ts` has no font check.
  - `font-loader.ts:113` holds "Relink it to edit."; no control in `src/ui` is named Relink.
  - `CanvasTextPanel.tsx:55-59` renders the reason inside the scrolling body, and Done (`:66-72`) is disabled on `!fields.fontAvailable` with only the title "Done".
- **Reproduced** (the auditor's fixture, checked: identical to `good.lf2` except `fontKey: "system:Bauhaus 93"`):
  - Open → "Success: Opened missing-font.lf2" (`zz-u5r\shots\r30-font-opened.png`).
  - Double-click the text → the font box reads "Missing font: system:Bauhaus 93" beside **Import** and **System fonts…**, and Done is disabled.
  - The reason `<p role="alert">` sits at y = 722 px, inside `.lf-canvas-text-scroll`, whose visible box ends at y = 598 px (scrollHeight 561 vs clientHeight 412). It is reachable by scrolling the panel (`r31-font-edit.png`).
- **Why not P2:**
  - Nothing is blocked or wrong. The saved outline burns as before (the auditor's `f2`).
  - On editing, the first control in the panel says "Missing font" in plain words, with the two buttons that fix it right beside it. A beginner can act on that without ever seeing the "Relink" sentence.
  - The silent "Success" toast and the wording are polish.

### U5-P3-10 — SVG import errors are XML-parser text with no next step

- **Where:** `src/io/svg/parse-svg.ts:371`; `src/ui/app/import-toasts.ts:74`.
- **What a beginner sees:** "Could not import broken.svg: SVG parse error: 1:134: unexpected close tag." For an empty file, "…1:0: document must contain a root element." (`f5-import-broken-svg.png`, `f5-import-empty-svg.png`).
- **Fix direction:** "broken.svg isn't a complete SVG file (the file is damaged or was cut off), so nothing was imported. Export it again from your design program, or save it as plain SVG." The empty file: "broken.svg is empty."

**Refuter (2026-11-03):** CONFIRMED P3. `parse-svg.ts:368-371` passes the first line of `parsererror` through, and `import-toasts.ts:71-75` prefixes it. Reproduced: "Error: Could not import broken.svg: SVG parse error: 1:134: unexpected close tag." (`zz-u5r\shots\r52-broken-svg.png`).

### U5-P3-11 — Save failures show the browser's exception text

- **Where:** `src/ui/app/project-save-completion.ts:55`.
- **What a beginner sees:** "Could not save project: An attempt was made to modify an object where modifications are not allowed." or "…: The request is not allowed by the user agent or the platform in the current context." (`f7-save-readonly.png`, `f7-save-notallowed.png`). The work is kept: the title stays "Not saved to file" and autosave continues.
- **Fix direction:** "KerfDesk couldn't write to that folder. Choose another place, such as Documents, with Save as. Your design is still open and nothing was lost."

**Refuter (2026-11-03):** CONFIRMED P3. `project-save-completion.ts:52-56` (`failProjectSave`) pushes `Could not save project: ${message}` with the raw exception text. Not re-run; this is READ plus the auditor's `f7`. The work is kept, so this is wording only.

### U5-P3-12 — Uncaught errors show developer text: "Error: Error: …" toasts, and a crash screen that leads with a stack trace

- **Where:** `src/ui/app/use-global-error-handlers.ts:22,28`; `src/ui/common/ErrorBoundary.tsx:130-163`.
- **What a beginner sees:** "Error: Error: Cannot read properties of undefined (reading 'points')" (`cr-01-crash-screen.png`). The crash screen shows "Something broke", the raw message, about 10 lines of minified stack, then **Save project**, **Copy diagnostic** and **Try again**, and "The diagnostic is for your own bug report" with no place to send it (`cr-03-crash-screen.png`). The buttons work (`cr-04`). Only Save project's tooltip says the work is still in memory.
- **Fix direction:**
  - Toast: "Something went wrong in KerfDesk. Your design is safe. If it happens again, use Help → Report a problem." Drop the duplicated "Error:".
  - Crash screen lead: "KerfDesk hit a problem and closed this view. Your design is still here: press Save project to keep it, then Try again." Collapse the stack under "Details", and point to the support report.

**Refuter (2026-11-03):** CONFIRMED P3.
- **The doubled "Error:"** is two pieces of code: `use-global-error-handlers.ts:22` pushes `` `Error: ${msg}` ``, and `Toasts.tsx:46` prints the variant label "Error: " in front of every error toast.
- **Reproduced:** a real `TypeError` thrown from a timer gave "Error: Error: Cannot read properties of undefined (reading 'points')". An unhandled rejection gave "Error: Unhandled rejection: …" (`zz-u5r\shots\r70-uncaught-toasts.png`).
- **The crash screen** is `ErrorBoundary.tsx:130-163`: the title, the message, a `<pre>` stack, then the buttons, then "The diagnostic is for your own bug report." (`:162`). Not re-run; this is READ plus the auditor's `cr-03`/`cr-04`.

### U5-P3-13 — A second rejected setting write does not replace the first notice; it shows only as a bare "error:7"

- **Where:** the safety notice keeps the first `controller-error` (`SafetyNoticeBanner`); the Console's last-error line.
- **What a beginner sees:** after `$32=1` (`error:17`) and then `$22=1` (`error:7`), the red notice still names `error:17` / `$32=1`. The new rejection appears only as a separate "error:7" (`sw-06-console-221.png`). The second rejection actually means "EEPROM read failed… restored it to defaults", which matters more.
- **Fix direction:** replace or stack the notice with the newest rejection, decoded: "The controller refused $22=1: its settings memory failed and was reset to defaults (error:7). Check its settings before you burn."

**Refuter (2026-11-03):** CONFIRMED P3.
- **File:line:** the rule is in `src/ui/state/laser-error-line.ts:168-170`, not in `SafetyNoticeBanner`: `safetyNotice: previous ?? rejectionNotice(…)`.
- **It is deliberate.** The comment at `:150-158` says "first notice wins", so that the error echoes of an Abort can't bury the root cause. The rule is applied to every rejection, though, including a fresh, unrelated one when no job or stop is involved. The only exception is a Marlin halt (`:164-166`).
- Not re-run; this is READ plus the auditor's `sw-06-console-221`. Shares U2-P2-2's fix card (decode in `controllerErrorMessage`).

## KNOWN re-observed

- **U2-P2-2 (raw `error:N`, "Check the Laser Log", "home before continuing", the interrupted-job paragraph with no job).** Met again:
  - "Error: Home: ALARM:9" (`a9-02`);
  - "Error: Unlock: error:79" and the `error:79` notice (`pc-23`);
  - the Console `$32=1` → `error:17` notice (`sw-06-console-321`);
  - Machine Setup's firmware-sync toast "…firmware sync stopped: error:17…" (READ, `use-machine-setup-save.ts:102-105`);
  - the interrupted-job paragraph under a Marlin halt (`mk-07`).
  The fix card should also cover alarm codes in rail toasts (`ALARM:9`) and `error:79` (U5-P2-1).
- **E2-P3-1** (`$22` read but not consulted). The falcon2 fake reports `$22=1`, yet after a Reset the card offers "Set up homing … if this machine has homing switches" (`a1-06-alarm1-after-reset.png`).
- **U2-P2-1** (stale driver after connect-then-pick). It also mis-decodes ALARM:10 (U5-P3-4).
- **HF-3 / GP-2 (2026-09-25, fixed, ADR-393).** Re-verified for the seen-message case: `ALARM:1` + `[MSG:Reset to continue]` → a single Reset button. Unlock and Home are held, and the Console too (`ai-04`, `ai-05`). U5-P2-1 is the unseen-message gap.
- **Rolling v2 15-scene-text** ("a missing font is honest"). Still true for the burn. U5-P3-9 is wording and layout only.

**Refuter (2026-11-03):** all 5 UPHELD as KNOWN.
- **U2-P2-2:** re-observed as "Error: Unlock: error:79" and the `error:79` notice (`zz-u5r\shots\r03`). New detail for its fix card: the notice survives a successful recovery, and after Disconnect → Connect → Unlock it still says "rejected a command (error:79) … home before continuing" (`r06`).
- **U2-P2-1:** see U5-P3-4. A banner-less grblHAL also lands on the stock driver by the plain Connect path.
- **HF-3 / GP-2:** the seen-message latch is in `laser-line-handler.ts:251-261`.
- **E2-P3-1 and 15-scene-text:** by READ (`AlarmRecoveryActions.tsx:42-50`; `f2`).

## Refuted

My own candidates, refuted during the run:

- **"An idle cable pull leaves 'Didn't connect by itself: The previous serial connection is still closing'."** An artefact: my first fake kept listing the unplugged port in `getPorts()`, so auto-connect tried to reopen it. Chrome lists only connected devices. With that fixed, the pull shows "Not connected" and replugging reconnects (`dc-03`, `dc-04`).
- **"Autosave fails silently when storage is full."** My first two runs had no toast for different reasons. In the first, a synchronous-throw patch on `IDBObjectStore.put` is not how Chrome fails. In the second, `localStorage` still had room, so the fallback saved. With a real quota (CDP) and `localStorage` filled to the byte, the warning appeared on the first tick (`f8-autosave-full.png`).
- **"grblHAL answers `$X` with ok while critical."** An artefact: my fake folded grblHAL's realtime byte 0x87 into the next line. Fixed (all bytes ≥ 0x80 are treated as realtime) and re-run (`pc-23`).
- **"A missing font burns a substitute."** The saved outline burns. Preview matches the canvas (`f2-missing-font-preview.png`).
- **"A crash loses unsaved work."** Save project on the crash screen wrote the file, Try again restored the scene, and autosave lives outside the boundary (`App.tsx:166-176`).

**Refuter (2026-11-03):** all 5 refutations UPHELD, by READ of the fake and the cited code. One more artefact from the same fake is added:
- **"A silent stock-GRBL controller in a critical alarm shows 'Found your GRBL v1.1 controller … The controller answered'"** (part of U5-P2-1, Messages met row 1). The fake entered its critical state 300 ms after `open()`, and KerfDesk's first `?` got `<Idle|…>` before that. With the state set at `open()`, Setup shows "Your machine didn't answer", and Try other speeds → Try again recovers (`zz-u5r\shots\r10-…-faithful`, `r14`, `r15`). The auditor's `pc-10`, `pc-11`, `a1-07` … `a1-09` and the green "State: Idle" all come from that one leaked report. The "Unlock sends `$X`, which is swallowed" line in U5-P2-1 belongs to the same run: with a faithful fake there is no Alarm card to unlock from.

## Verified clean

- Alarms seen while connected: ALARM:1/2 (a single Reset), ALARM:3 (re-home), ALARM:9 (the code survives GRBL's post-alarm reset banner), the boot lock, and Frame refused in Alarm with nothing sent.
- Marlin `kill()`: a plain body; the notice keeps jog clicks from reaching the dead board; the board's reset recovers without a reconnect.
- grblHAL E-stop on the grblHAL driver: Reset, then Unlock, recovers; Reset with the E-stop still held brings the card back.
- grblHAL door: motion is held and ABORT MOTION clears it.
- Idle disconnects: unplug → "Not connected"; replug auto-connects; a controller self-reset re-reads settings; the busy-port texts for Connect and auto-connect.
- Files:
  - a newer `.lf2` gets a plain alert;
  - binary DXF names its fix;
  - a solid-only DXF names what was skipped;
  - an unreadable PDF mentions passwords;
  - a 9 MB SVG shows progress with Esc to cancel, then imports;
  - full storage warns once with an action.
- Licence (READ + one REPRO):
  - Free web Pro prompts (`ProInDesktopDialog.tsx:23-50`);
  - trial-ended text (`trial-expiry.ts:76-77`): "Existing work keeps working";
  - Pro-project dialogs (`ProProjectDesktopDialog.tsx:71-89`): "the file was not modified";
  - licence key help (`LicenceKeyForm.tsx`).
  All plain, all say what to do, and none stops a running job. The desktop licence window is held off (`public/desktop-licence-window.mjs`, `DESKTOP_LICENCE_WINDOW = false`).
- Crash: the crash screen keeps job protections and autosave mounted (`App.tsx:68-90,166-176`); Save project and Try again work.

## Not verified

- Real hardware, and real Chrome device-loss timing (`NetworkError` on read). The fake errors the stream and fires `disconnect`.
- What grblHAL answers to `$$` while critical. It is assumed answered, per HF-3's "serves only `?` and `$` lines" (`docs/audits/2026-09-25-controller-full-audit.md:428-437`). Whether a real Ortur or Falcon E-stop raises ALARM:10 was not checked against vendor documentation.
- Whether ABORT MOTION from a door hold keeps a hand-set origin (U5-P3-5).
- ALARM:8 (READ only), FluidNC's Critical state, Marlin M112 vs `kill()` wording, and network (Wi-Fi) disconnects.
- Machine Setup's firmware write path: READ only, because it requires an exported backup and a per-setting confirm. The settings table showed "No settings read yet" after **Read ($$)** on the generic fake (`sw-03-after-read.png`); not investigated.
- The desktop app: native save dialogs, the Electron crash and reload, the licence gate, and trial expiry (no licence calls made).
- The two early ALARM:1 runs (`a1-01` … `a1-06`, `ai-01` … `ai-03`) used a fake that answered `?` during a critical alarm, as grblHAL does. The stock GRBL behaviour was re-run faithfully (`ai-04`, `ai-05`, `pc-1x`).

## Messages met

| # | What the beginner sees (verbatim, shortened with …) | Actionable? | Source |
|---|---|---|---|
| 1 | "Found your GRBL v1.1 controller … The controller answered but reported no settings KerfDesk maps. Enter the manufacturer values in the next step." (controller silent or locked). **Refuter:** a harness artefact for a silent controller; a faithful one gets "Your machine didn't answer". The text is true for Marlin | no (false) → artefact | `device-setup/find-machine-phase.ts:161-163`; `DeviceSetupFoundMachine.tsx:41-44` |
| 2 | "Controller reports Alarm — GRBL has locked jog, frame, and start until the machine is homed or unlocked." | yes | `AlarmBanner.tsx:44` |
| 3 | "Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe." | yes | `start-job-input.ts:17-18` |
| 4 | "Alarm 1: Hard limit triggered — A limit switch was hit while the machine was moving." | yes | `alarm-codes.ts:57-58` |
| 5 | "The controller stopped on a critical event (hard or soft limit, E-stop or motor fault) and accepts only a soft reset. Press Reset (Ctrl-X), then Unlock or Home." | yes | `controller-reset-required.ts:33-34` |
| 6 | (after Reset) "The controller accepts only a soft reset now: press Reset (Ctrl-X). Then clear the obstruction and re-home the machine ($H)." | no (stale) | `alarm-codes.ts:63-64` |
| 7 | "Alarm 2: G-code target exceeds machine travel — The job tried to move outside the soft-limits envelope." | yes | `alarm-codes.ts:68-69` |
| 8 | "Alarm 3: Reset during motion … Re-home the machine ($H) before resuming work." | yes | `alarm-codes.ts:77-79` |
| 9 | "Alarm 9: Homing fail — could not find limit switch … increase max travel ($130–$132) or decrease pull-off ($27)…" | no | `alarm-codes.ts:119-123` |
| 10 | "Error: Home: ALARM:9" | no | `src/ui/laser/report-controller-action-failure.ts:37` (U2-P2-2) |
| 11 | "Info: Machine settings detected: review controller homing and limit settings in Machine Setup." | yes | `DetectedSettingsToast.tsx:102` |
| 12 | "Last Frame attempt blocked — Controller is in Alarm. Home it if the machine has homing switches, or Unlock it once the head is safe, then try again." | yes | `StartBlockerNotice.tsx:10` |
| 13 | "Error: Unlock: Unlock (clear alarm) timed out." | no | `laser-interactive-command.ts:422`; label `console-command-transport.ts:78` |
| 14 | "Controller rejected a command — … (error:79). Check the Laser Log, wait for Idle, and home before continuing… Rejected line: $X" + "Error: Unlock: error:79" | no | `laser-safety-notice.ts:513-516`; `SafetyNoticeBanner.tsx:18` |
| 15 | "Machine stopped answering — controller settings query timed out. Waiting to retry: Wait for the previous controller write and acknowledgement before reading machine settings." + Reconnect controller | partly (button yes, words no) | `laser-controller-silence.ts` (U2-P3-4) |
| 16 | "Alarm 10: E-stop asserted (grblHAL) — The hardware E-stop is active." | yes | `alarm-codes.ts:141-142` |
| 17 | "Alarm 10: Homing fail — dual-axis switch … (grblHAL firmware uses alarm 10 for E-stop instead.)" (E-stop on the stock driver) | no | `alarm-codes.ts:129-131`; `LaserWindow.tsx:54` |
| 18 | "CONTROLLER DOOR HOLD — … Close it, then release it with cycle start or clear it with Abort" / "…Release it with cycle start, or Abort to clear it with a controller reset" | partly | `live-motion-unowned.ts:19,85-86` |
| 19 | "Controller rejected a command — The controller halted its firmware (Error:Printer halted. kill() called!) … Press the controller's reset button or power-cycle it, then reconnect…" | yes (wrong title) | `laser-safety-notice.ts:293-298`; `SafetyNoticeBanner.tsx:18` |
| 20 | "This warning is separate from the interrupted-job checkpoint. Reconnecting or resetting the controller does not resume the job…" (no job ran) | no | `SafetyNoticeBanner.tsx:62-63` (U2-P2-2) |
| 21 | "Your machine didn't answer — Nothing came back at 250000 baud…" + Try other speeds | yes | `find-machine-phase.ts:148-150` |
| 22 | (idle unplug) "Not connected" + Connect; no message | yes | `ConnectionBar.tsx` |
| 23 | "Didn't connect by itself: the machine's port is in use by another program. Close it, then Connect." (READ) | yes | `ConnectionBar.tsx:376-380` |
| 24 | "Send persistent controller setting?\n\n$32=1" (native confirm) | yes | `console/run-console-command.ts:44` |
| 25 | "The controller rejected a command (error:17). Check the Laser Log… Rejected line: $32=1"; then a bare "error:7" | no | `laser-safety-notice.ts:515` (U2-P2-2) |
| 26 | "Software setup was saved, but firmware sync stopped: error:17 Reopen Machine Setup after checking the controller." (READ) | no | `use-machine-setup-save.ts:102-105` |
| 27 | "Could not open corrupt.lf2: not valid JSON: Expected ',' or '}' after property value in JSON at position 19437 (line 1 column 19438)" | no | `project-open-completion.ts:63`; `deserialize-project.ts:71` |
| 28 | "Could not open empty.lf2: not valid JSON: Unexpected end of JSON input" | no | same |
| 29 | "This project was saved with a newer KerfDesk (schemaVersion 99). Update the app to open it." | yes | `project-open-completion.ts:58-60` |
| 30 | "Success: Opened missing-font.lf2" / "Missing font: system:Bauhaus 93" / (off-screen) "Font "system:Bauhaus 93" is not available. Relink it to edit." | no | `project-open-completion.ts:49`; `FontPicker.tsx:62`; `font-loader.ts:113` |
| 31 | "Could not import broken.svg: SVG parse error: 1:134: unexpected close tag." | no | `parse-svg.ts:371`; `import-toasts.ts:74` |
| 32 | "Could not import empty.svg: SVG parse error: 1:0: document must contain a root element." | no | same |
| 33 | "nothing.svg has no drawable content" | yes | `import-toasts.ts:24` |
| 34 | "broken.pdf: import failed: Could not read PDF. Password-protected files must be unlocked first. Invalid PDF structure." | yes | `import-dispatch.ts:98`; `pdf-artwork-source.ts:51` |
| 35 | "binary.dxf: Binary DXF is not supported — re-export as ASCII DXF." | yes | `dxf-tags.ts:25` |
| 36 | "solid-only.dxf: no supported geometry — skipped 1 3DSOLID." | yes | `dxf-import-action.ts:182` |
| 37 | "huge.svg: reading in worker. Press Esc to cancel." / "parsing in worker…" | yes | `import-worker-controls.ts:53-54` |
| 38 | "Could not save project: An attempt was made to modify an object where modifications are not allowed." | no | `project-save-completion.ts:55` |
| 39 | "Autosave could not preserve the newest project. Save the .lf2 file manually; image-heavy projects can exceed browser storage." | yes | `use-autosave.ts:39-40` |
| 40 | "Error: Error: Cannot read properties of undefined (reading 'points')" / "Unhandled rejection: …" | no | `use-global-error-handlers.ts:22,28` |
| 41 | "Something broke" + raw message + stack + Save project / Copy diagnostic / Try again | partly | `ErrorBoundary.tsx:130-163` |
| 42 | "Design Studio is a Pro tool … All Pro features are in the KerfDesk desktop app for Windows … a licence never stops a job that is running." | yes | `ProInDesktopDialog.tsx:23-50` |
| 43 | "Your 30-day Pro trial has ended. Existing work keeps working. Buy a licence or enter your key to choose new Pro tools." (READ) | yes | `trial-expiry.ts:77` |
| 44 | "This project needs KerfDesk Pro … Your current workspace is unchanged and the file was not modified…" (READ) | yes | `ProProjectDesktopDialog.tsx:71-89` |

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u5\`:

| File | Purpose |
|---|---|
| `zz-u5-fake-serial.js` | The U2 refuter's fake with U5 knobs: `bootAlarm`, `preCritical` + `criticalMode` (stock GRBL silent / grblHAL `error:79`), `homeAlarm`, `settingError`, and `__U2.idleAlarm/resetBoard/pull/plug/door/estop/kill` |
| `zz-u5-files.js` | U3's file-picker harness (`__ZZ_PICK` serves `fixtures/<name>`) |
| `zz-u5-drive.mjs` | Playwright driver on 4952 (`h.fresh(machine, patch)`, `h.connect()`, `h.tx/rx/toasts/alertsRole/dialogs/shot`) |
| `zz-u5-host.mjs` | Static host with the production headers on 4951; serves `fixtures/` at `/__zz__/` |
| `zz-u5-d.sh` | Posts a JS body from stdin to the driver |
| `zz-u5-setup-homing.js`, `zz-u5-setup-ortur.js` | Setup snippets (homing-enabled generic; Ortur LM3 on the grblHAL driver) |
| `zz-u5-machines.json` | Machine configs (copied from `zz-u2r`) |
| `zz-u5-fixtures.mjs` | Builds the file fixtures (`huge.svg` was deleted to save space; rerun to rebuild) |
| `shots\*.png` | Screenshots cited above |

To rebuild the bundle (`dist` and `tree` were deleted):
1. `git archive origin/main src public scripts electron index.html package.json tsconfig.json vite.config.ts | tar -x -C zz-u5\tree`.
2. Junction `tree\node_modules` to the main checkout's.
3. Copy `zz-u2\zz-u2-vite.config.ts` to `tree\zz-u5-vite.config.ts`, then `node node_modules/vite/bin/vite.js build --config zz-u5-vite.config.ts --outDir ../dist`.
4. Remove the junction with `cmd /c rmdir` before deleting `tree`.

## Refuter summary

**Refuter:** a fresh context, 2026-11-03.
- **Tree:** `origin/main` `c93fbb3bc`, re-fetched; still the head of main.
- **Build:** my own production build: `git archive origin/main` into `zz-u5r\tree`, a `node_modules` junction, `zz-u5r-vite.config.ts` (copied from `zz-u2`), and Vite build into `zz-u5r\dist`.
- **Host and driver:** `zz-u5r-host.mjs` on 4991 and `zz-u5r-drive.mjs` on 4992 (headless installed Chrome, a fresh context per run). The scripts are in `zz-u5r\bodies\`, POSTed with `zz-u5r-d.sh`.
- **Fake:** the auditor's fake, copied to `zz-u5r-fake-serial.js` with two changes:
  - `preCritical` now sets the critical state at `open()`, not 300 ms later at `boot()`. This fixes the leaked `<Idle>`.
  - `deadSilent`: a port that opens and never answers.
- **Firmware sources** (read only, pinned):
  - grblHAL/core `d7aaee3d84b1e7010f075d395206afff038d7379`: `alarms.h` `alarm_is_critical`, `system.c` `system_execute_line`/`system_raise_alarm`/`disable_lock`, `protocol.c` `protocol_exec_rt_system`/`protocol_main_loop`, `messages.c`.
  - gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`: `grbl/protocol.c`, `grbl/main.c`.
  - Not verified: grblHAL `stream.c` (the fetch timed out), and how a COMPATIBILITY_LEVEL 1 build (Ortur's ESP32-S2) numbers this status.
- **Paths:** `zz-u5r` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u5r`. Screenshots `r01`–`r70` are in `zz-u5r\shots\`. The two `r1x-artefact-*` shots show the auditor's leaked-`<Idle>` run, kept as evidence.
- **Cleanup:** `dist` and `tree` were deleted at the end; the junction was removed first with `cmd /c rmdir`.

**Tally:** of 14 findings, 14 confirmed at their severity; 0 severity changes, 0 refuted. Sub-claims:
- U5-P2-1's stock-GRBL screen is refuted as an artefact.
- U5-P3-2's after-Reset half is a duplicate of U4-P3-4.
- U5-P3-5 is a sibling of U4-P3-2.

The 5 KNOWN and the auditor's 5 refutations are upheld. No new finding.

| ID | Auditor | Refuter | One line |
|---|---|---|---|
| U5-P2-1 | P2 | P2 (P1 and P3 rejected) | **grblHAL, reproduced with a faithful fake on the default Connect path.** A lock that predates the connection, such as an E-stop pressed before connecting, a limit tripped while unconnected, or a page reload, is never latched. The card offers Unlock and Set up homing; Unlock → `error:79` → "home before continuing". No Reset anywhere. grblHAL's source confirms the behaviour: E-stop is critical, `$X`/`$H` get `Status_NotAllowedCriticalEvent` (79), `?` and `$$` are served. Disconnect → Connect recovers, because it sends Ctrl-X. A beginner could plausibly find the labelled toolbar Disconnect, so P2, not P1. **Stock GRBL** is rare: Chrome asserts DTR and AVR boards reboot on open. With a faithful fake it is not a block: "Your machine didn't answer" → Try other speeds → Try again recovers. The "Found … answered but reported no settings" screen was a fake artefact (a leaked `<Idle>`), so the wording is not a P2 on its own; it has no reproduced trigger. |
| U5-P3-1 | P3 | P3 | Reproduced: ALARM:1 with the Artwork tab open gave no toast, a green "Connected" pill, and an orange Frame. |
| U5-P3-2 | P3 | P3 | The before-Reset half is new: the generic reset sentence replaces "Release the E-stop" and "clear the obstruction". The after-Reset half duplicates U4-P3-4. |
| U5-P3-3 | P3 | P3 | READ: `alarm-codes.ts:115,122-123`; Home first (`AlarmRecoveryActions.tsx:42`). |
| U5-P3-4 | P3 | P3 | READ. Reach is wider: a banner-less grblHAL lands on the stock driver by plain Connect (`r01`). The card's own parenthesis names the E-stop. |
| U5-P3-5 | P3 | P3 | READ. Unowned sibling of U4-P3-2; one fix card. |
| U5-P3-6 | P3 | P3 | Reproduced: a Marlin `kill()` gave "Controller rejected a command", "State: Idle", "Connected" (`r60`). |
| U5-P3-7 | P3 | P3 (P2 rejected) | Reproduced. The baud change is listed before Apply, and the "didn't answer" card's primary **Try other speeds** recovers at 115200 on its first try (`r21`–`r24`). Not a dead end. |
| U5-P3-8 | P3 | P3 | Reproduced: the JSON parser text (`r51`). |
| U5-P3-9 | P3 | P3 (P2 rejected) | Reproduced: "Success: Opened…"; the reason at y = 722 in a scroller that ends at 598. The font box itself says "Missing font" beside **Import** and **System fonts…**, and the burn is unchanged. |
| U5-P3-10 | P3 | P3 | Reproduced: "SVG parse error: 1:134: unexpected close tag." (`r52`). |
| U5-P3-11 | P3 | P3 | READ: `project-save-completion.ts:55`. |
| U5-P3-12 | P3 | P3 | Reproduced: "Error: Error: …" (`use-global-error-handlers.ts:22` + `Toasts.tsx:46`). |
| U5-P3-13 | P3 | P3 | READ. File:line corrected to `laser-error-line.ts:168-170` ("first notice wins", meant for stop echoes). |

**For the coordinator:**
- **U5-P2-1:** re-verify on grblHAL only. The fix card's Setup half (a "silent" phase for no acknowledgement) already holds for a faithful silent controller. The card part is the work: treat `error:79`, FluidNC `Critical`, and perhaps a reset-less Alarm on a banner-less connect as reset-required evidence, and offer **Reset (Ctrl-X)**.
- **A harness lesson for later audits:** a fake must enter its pre-connection state before the port opens. The 300 ms boot delay made one status report leak.

```json
[
  {"id":"U5-P2-1","severity":"P2","area":"errors-recovery","file":"src/ui/state/laser-line-handler.ts","line":251,"evidence":"REPRO","summary":"Controller already in a critical alarm (E-stop/limit) when KerfDesk connects: no reset latch (only from [MSG:Reset to continue]); card offers Unlock/Home only; grblHAL Unlock -> raw error:79 notice ('home before continuing'); no Reset anywhere. Way out (Disconnect/Connect sends Ctrl-X) is unstated. Stock-GRBL silent case: Setup says 'didn't answer' and Try other speeds -> Try again recovers (the 'Found ... answered' screen was a harness artefact)","known":false,"related":["HF-3","GP-2","ADR-393","U2-P2-2"],"verdict":"CONFIRMED P2 on grblHAL (P1 and P3 rejected): reproduced with a faithful fake; grblHAL d7aaee3d alarm_is_critical/system_execute_line confirm error:79 for $X/$H while ? and $$ are served. Stock-GRBL half is rare (DTR auto-reset) and recovers via Try other speeds -> Try again; its \"Found ... answered\" screen was a harness artefact (leaked <Idle>)"},
  {"id":"U5-P3-1","severity":"P3","area":"errors-recovery","file":"src/ui/laser/LaserWindow.tsx","line":98,"evidence":"REPRO","summary":"Alarm raised with the Artwork tab open: toolbar stays green Connected, no toast, Frame stays orange","known":false,"verdict":"CONFIRMED (REPRO r50)"},
  {"id":"U5-P3-2","severity":"P3","area":"errors-recovery","file":"src/ui/laser/AlarmBanner.tsx","line":34,"evidence":"REPRO","summary":"Generic reset text replaces each critical alarm's own step (release E-stop, move off switch); after Reset, ALARM:1 card still says 'press Reset (Ctrl-X)'","known":false,"verdict":"CONFIRMED; after-Reset half duplicates U4-P3-4","related":["U4-P3-4"]},
  {"id":"U5-P3-3","severity":"P3","area":"errors-recovery","file":"src/core/controllers/grbl/alarm-codes.ts","line":122,"evidence":"REPRO","summary":"ALARM:8/9 advice cites $130–$132/$27, offers Home first, never asks whether the machine has homing switches","known":false,"related":["E2-P3-1"],"verdict":"CONFIRMED (READ)"},
  {"id":"U5-P3-4","severity":"P3","area":"errors-recovery","file":"src/ui/laser/LaserWindow.tsx","line":54,"evidence":"REPRO","summary":"grblHAL E-stop decoded as 'Homing fail — dual-axis switch' on the stock GRBL driver (live driver, not reported firmware)","known":false,"related":["U2-P2-1"],"verdict":"CONFIRMED; wider reach: a banner-less grblHAL lands on the stock driver by plain Connect"},
  {"id":"U5-P3-5","severity":"P3","area":"errors-recovery","file":"src/ui/laser/live-motion-unowned.ts","line":19,"evidence":"REPRO","summary":"Idle door hold: 'release it with cycle start' names no control; only ABORT MOTION offered","known":false,"verdict":"CONFIRMED (READ); sibling of U4-P3-2","related":["U4-P3-2"]},
  {"id":"U5-P3-6","severity":"P3","area":"errors-recovery","file":"src/ui/laser/SafetyNoticeBanner.tsx","line":18,"evidence":"REPRO","summary":"Marlin kill() notice titled 'Controller rejected a command'; rail shows State: Idle and Connected","known":false,"verdict":"CONFIRMED (REPRO r60)"},
  {"id":"U5-P3-7","severity":"P3","area":"errors-recovery","file":"src/ui/laser/device-setup/DeviceSetupUseDetectedController.tsx","line":53,"evidence":"REPRO","summary":"Use detected Marlin -> Apply to draft swaps a working 115200 for the Marlin starter 250000; Reconnect then didn't answer","known":false,"verdict":"CONFIRMED P3, P2 rejected: baud change listed before Apply; Try other speeds recovers on its first try"},
  {"id":"U5-P3-8","severity":"P3","area":"errors-recovery","file":"src/ui/app/project-open-completion.ts","line":63,"evidence":"REPRO","summary":"Damaged/empty .lf2: 'not valid JSON: Expected ',' or '}' … position 19437'","known":false,"verdict":"CONFIRMED (REPRO r51)"},
  {"id":"U5-P3-9","severity":"P3","area":"errors-recovery","file":"src/ui/text/font-loader.ts","line":113,"evidence":"REPRO","summary":"Missing font: open says Success; edit reason drawn below the panel's visible edge and says 'Relink' (no such control)","known":false,"related":["rolling-v2 15-scene-text"],"verdict":"CONFIRMED P3, P2 rejected: the font box says Missing font beside Import / System fonts; burn unchanged"},
  {"id":"U5-P3-10","severity":"P3","area":"errors-recovery","file":"src/io/svg/parse-svg.ts","line":371,"evidence":"REPRO","summary":"SVG import errors are XML-parser text ('1:134: unexpected close tag', 'document must contain a root element')","known":false,"verdict":"CONFIRMED (REPRO r52)"},
  {"id":"U5-P3-11","severity":"P3","area":"errors-recovery","file":"src/ui/app/project-save-completion.ts","line":55,"evidence":"REPRO","summary":"Save failure shows DOMException text; no 'choose another folder'","known":false,"verdict":"CONFIRMED (READ)"},
  {"id":"U5-P3-12","severity":"P3","area":"errors-recovery","file":"src/ui/app/use-global-error-handlers.ts","line":22,"evidence":"REPRO","summary":"'Error: Error: …' toasts; crash screen leads with stack, 'your own bug report' with nowhere to send","known":false,"verdict":"CONFIRMED (REPRO r70)"},
  {"id":"U5-P3-13","severity":"P3","area":"errors-recovery","file":"src/ui/state/laser-error-line.ts","line":168,"evidence":"REPRO","summary":"Second rejected $ write (error:7) does not replace the first notice (error:17); shows as bare 'error:7'","known":false,"related":["U2-P2-2"],"verdict":"CONFIRMED (READ); file:line corrected to laser-error-line.ts:168-170"},
  {"id":"KNOWN-U2-P2-2","known":true,"summary":"Raw error:N / ALARM:N in notices and rail toasts (Home ALARM:9, Unlock error:79, $32=1 error:17, firmware-sync toast), Laser Log, interrupted-job paragraph","verdict":"UPHELD"},
  {"id":"KNOWN-E2-P3-1","known":true,"summary":"Alarm card asks about homing switches although $22=1 was read","verdict":"UPHELD"},
  {"id":"KNOWN-U2-P2-1","known":true,"summary":"Stale driver; also mis-decodes ALARM:10 (U5-P3-4)","verdict":"UPHELD"},
  {"id":"KNOWN-HF-3","known":true,"summary":"Fixed for the seen 'Reset to continue' case (re-verified); U5-P2-1 is the unseen case","verdict":"UPHELD"},
  {"id":"KNOWN-15-scene-text","known":true,"summary":"Missing font burns the saved outline (honest); U5-P3-9 is wording/layout","verdict":"UPHELD"}
]
```
