# Track GP — GRBL 1.1 protocol core (complete; the final hand-back mirrors this file)

Upstream: gnea/grbl 1.1h at bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e, cited as
`https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/FILE#Lnn`.
Repro tests live in `src/__audit_repro__/GP/`; each fails on current code.

## Findings (most severe first)

### GP-1 — After `$H`, GRBL re-runs `$N` startup blocks, but the store keeps the pre-Home active WCS, so Frame skips its G54 re-selection
- severity: high · verdict: CONFIRMED · status: new (gap in the C6 active-WCS readback)
- failure scenario: homing machine powers up in ALARM (HOMING_INIT_LOCK), `$N0=G55` stored.
  Connect → `$G` says G54 → `activeWcs='G54'`. Home → GRBL runs the startup block after homing,
  prints `>G55:ok`, then `ok`; controller is now in G55. Frame: `normalizeFrameWorkCoordinateSystem`
  sees cached `'G54'` and returns without selecting G54; the `$J=G90` perimeter runs in G55
  (with the G55 WCO compensation). Start: the program preamble selects G54, so the job runs offset
  from the traced Frame by (G54 − G55). The Frame permit does not notice (wcoCache/origin unchanged).
- kerfdesk evidence: `src/ui/laser/frame-controller-readiness.ts:44-47` (`if (... originalActiveWcs === 'G54') return { ok: true }`);
  `src/ui/state/laser-home-action.ts:138-178` (Home never clears/re-reads `activeWcs`);
  `src/ui/state/laser-line-handler.ts:89-93,303-306` (`>G55:ok` is 'unknown', goes to banner detection, dropped);
  `activeWcs` is only re-read in `laser-controller-handshake.ts:218` and `grbl-settings-actions.ts:139`;
  `src/core/output/grbl-strategy.ts:86` (preamble `G21 G90 G54 G94 ...`); `$J=` cannot carry G54 (gcode.c:856).
- upstream evidence: system.c:195-199 `if (!sys.abort) { sys.state = STATE_IDLE; st_go_idle(); if (line[2] == 0) { system_execute_startup(line); } }`
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L195-L199 ;
  report.c:361-367 (`>line:ok`); wiki Interface: "A reset or re-homing Grbl is highly recommended ... where any startup lines will be properly executed."
- reproduction: `src/__audit_repro__/GP/startup-lines-after-home.test.ts` — FAILS (activeWcs stays 'G54'; Frame normalization writes no `G54`). Passes when activeWcs is nulled after Home.
- fix (local): after any `$H` (rail Home, Console `$H`, alarm-banner Home) set `activeWcs: null` (Frame then selects G54) or re-read `$G`; optionally parse `>...:ok` echoes for G54-G59 words.

### GP-2 — After ALARM:1/ALARM:2 GRBL accepts only Ctrl-X; KerfDesk offers `$H`/`$X`, and Unlock strands an owed ack
- severity: high · verdict: CONFIRMED · status: new
- failure scenario: hard limit (or soft limit) during a job/jog → `ALARM:1` + `[MSG:Reset to continue]`. GRBL spins in a
  reset-only loop: parses no line, answers no `?`. Alarm banner shows Home/Unlock ("Re-home ($H) after clearing the obstruction").
  Unlock writes `$X` → no reply → "Unlock (clear alarm) timed out" after 8 s, `pendingUntrackedAcks` stays 1 → Home refused
  ("previous controller write and terminal acknowledgement"), Jog/Frame fenced. No Reset control outside Sleep; Console refuses
  control characters. Way out: disconnect/reconnect (only if port-open resets the board) or power-cycle.
- kerfdesk evidence: `src/ui/laser/AlarmRecoveryActions.tsx:20-54`; `src/ui/laser/LaserWindow.tsx:218-231,258-271` (reset only in Sleep banner);
  `src/ui/laser/SafetyNoticeBanner.tsx:39` (`resetAvailable ... statusState === 'Sleep'`); `src/ui/state/laser-autofocus-actions.ts:28-45` (unlockAlarm);
  `src/ui/state/laser-home-action.ts:57-63` (stranded ack blocks Home); `[MSG:...]` never interpreted (grep: no handler); `src/core/controllers/grbl/alarm-codes.ts:60,67` actions.
- upstream evidence: protocol.c:218-237 (`if ((rt_exec == EXEC_ALARM_HARD_LIMIT) || (rt_exec == EXEC_ALARM_SOFT_LIMIT)) { report_feedback_message(MESSAGE_CRITICAL_EVENT); ... do { } while (bit_isfalse(sys_rt_exec_state,EXEC_RESET)); }`)
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L218-L237 ; wiki Interface:
  "`[MSG:Reset to continue]` - Critical event message. Reset is required before Grbl accepts any other commands."
- reproduction: `src/__audit_repro__/GP/limit-alarm-requires-reset.test.ts` — FAILS (writes `$X\n`, times out, pendingUntrackedAcks = 1).
- fix (local): latch "reset required" on `[MSG:Reset to continue]` (or ALARM:1/2 on GRBL); banner offers "Reset (Ctrl-X)" via the existing
  wakeController flow and hides/defers Unlock/Home until the reboot banner; fix ALARM:1/2 action text.

### GP-3 — Console/macro lines carry GRBL realtime characters (`!`, `~`, `?`) verbatim; `!` holds GRBL and wedges the exchange
- severity: medium · verdict: CONFIRMED · status: new (the 0x80+ half was fixed as transport-2; printable realtime chars were not)
- failure scenario: operator types `!` or a macro `M8 (air on!)`. GRBL's RX ISR executes `!` as feed hold; from Idle it enters
  Hold:0 and stays in the suspend loop, so the line is never parsed and no `ok` comes. Store owes the ack → Jog/Frame/Home fenced;
  Console refuses `~` ("Manual motion requires a fresh Idle report; the controller reported Hold"); no non-job Resume exists.
  Same class: profile auto-focus command (only empty/multi-line checked).
- kerfdesk evidence: `src/core/controllers/console-text.ts:65-72` (allows 0x20-0x7E); `src/core/controllers/grbl/console-command.ts:58-60,83-86`
  (only lone `?` is realtime; everything else queued with `\n`); `src/ui/state/console-command-transport.ts:85` (plain write owes an ack);
  `src/ui/state/autofocus-action.ts:78-85`.
- upstream evidence: serial.c:148-155 (`case CMD_FEED_HOLD: system_set_exec_state_flag(EXEC_FEED_HOLD)`), config.h:51-54, protocol.c:257-290 (Idle → Hold: L273 `sys.suspend = SUSPEND_HOLD_COMPLETE`, L287 `sys.state = STATE_HOLD`), protocol.c:546 `while (sys.suspend)`.
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L143-L198
- reproduction: `src/__audit_repro__/GP/console-realtime-chars.test.ts` — FAILS (prepareConsoleCommand queues `!`; pendingUntrackedAcks = 1; `~` refused).
- fix (local): in `consoleLineRefusal`/`prepareConsoleCommand` treat a lone `!`/`~` as realtime bytes (like `?`, no newline, no ack) and refuse `!`, `~`, `?` inside longer lines (and in the auto-focus command) with a message naming the realtime meaning.

### GP-4 — Console can enter `$C` check mode but refuses the `$C` that exits it
- severity: medium · verdict: CONFIRMED · status: new
- failure scenario: operator sends `$C` from Idle → GRBL `[MSG:Enabled]`, state Check. Every KerfDesk action needs Idle; the second `$C`
  (GRBL's documented exit) is refused ("Manual motion requires a fresh Idle report; the controller reported Check"). Only disconnect/reconnect
  (DTR reset) or power-cycle exits. Same gating also refuses Console `$H`/`$SLP` in Alarm, which system.c accepts (IDLE or ALARM).
- kerfdesk evidence: `src/core/controllers/grbl/console-command.ts:83-86` (`$C` → 'gcode', requiresIdle); `src/ui/state/console-command-readiness.ts:33-37,53-55`.
- upstream evidence: system.c:147-159 (`if ( sys.state == STATE_CHECK_MODE ) { mc_reset(); report_feedback_message(MESSAGE_DISABLED); } else { if (sys.state) { return(STATUS_IDLE_ERROR); } ...`) and system.c:173 (default branch IDLE or ALARM).
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L147-L173
- reproduction: `src/__audit_repro__/GP/console-check-mode.test.ts` — FAILS.
- fix (local): classify `$C` as its own kind allowed in Idle or Check (stateEffect machine-state; the exit reboots and the banner handler already resets session state); allow Console `$H`/`$SLP` in Alarm like the banner.

### GP-5 — Guarded `$x=` writes accept values GRBL cannot store/report as typed, then report a failed write after GRBL applied a different value
- severity: low · verdict: CONFIRMED · status: new
- failure scenario: Machine Settings `$11=0.0105` → GRBL stores it, `$$` prints `0.011` → "Controller did not report $11=0.0105 after re-read"
  and qualification marked failed. `$26=300` (uint8) → GRBL applies a truncated/wrapped value (AVR: 44) with `ok` → same "failed" message
  though the controller changed. Also fractional `$30/$31` (printed with 0 decimals).
- kerfdesk evidence: `src/ui/state/grbl-settings-actions.ts:381-392` (only numeric/sign/$32 checks), `:284-299` (exact re-read equality, then throw);
  `src/core/controllers/grbl/grbl-setting-write.ts:86-95`.
- upstream evidence: settings.c:229 `uint8_t int_value = trunc(value);`, report.c:94-103, config.h:146-147 (3 / 0 decimals).
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L193-L303
- reproduction: `src/__audit_repro__/GP/settings-write-precision.test.ts` — FAILS (sent, then "did not report").
- fix (local): validate per setting type before sending (uint8 ids: integer 0-255, `$0` ≥ 3; floats ≤ 3 decimals; `$30/$31` integers), or compare the re-read at GRBL's printed precision.

### GP-6 — Work-Z recovery stores the `$#` G54 Z (inches when `$13=1`) as `offsetZMm` and shows it as mm
- severity: low · verdict: CONFIRMED (traced) · status: new
- kerfdesk evidence: `src/ui/state/work-z-recovery-actions.ts:67` (`offsetZMm: after.offset.z`, no reportInches scaling); `src/ui/laser/WorkZRecoveryControl.tsx:48,144-146`.
- upstream evidence: report.c:261 `report_util_axis_values(coord_data)` → print.c:175-181 `printFloat_CoordValue` converts to inches under BITFLAG_REPORT_INCHES.
- reproduction: traced only. fix (local): scale by 25.4 when `controllerSettings.reportInches === true`.

### GP-7 — Home's 120 s budget assumes `<Home|...>` replies keep it alive; stock GRBL answers no `?` during homing
- severity: low · verdict: CONFIRMED (traced) · status: new (overlaps Home track)
- kerfdesk evidence: `src/ui/state/laser-home-action.ts:43-50,150-160` (comment + 'non-idle-status-activity' 120 s).
- upstream evidence: limits.c:320 "No time to run protocol_execute_realtime() in this loop."; motion_control.c:239; wiki Interface: "it will immediately (exception: while homing) respond".
- failure: a homing cycle > 120 s (large/slow `$25`) is reported as failed while GRBL keeps homing. fix (local): budget from `$130-$132`/`$24/$25`, or document.

### GP-8 — Error/alarm table wording that misleads against the upstream meaning
- severity: low · verdict: CONFIRMED (traced) · status: new
- ALARM:4 detail "started while the probe was already triggered" is wrong for G38.4/G38.5 (there it means NOT triggered; CSV row 4).
- error:7 detail "Settings were reset to defaults; verify with $$" — 1.1h also emits it when a G54-G59/G28/G30 slot read fails
  (gcode.c:45-47, 509, 543, 614-616; report.c:251 in `$#`), and settings.c:166-170 then re-zeroes that coordinate slot: the work
  offset changed, which `$#` shows, not `$$`.
- ALARM:1/2 actions omit the mandatory soft reset (see GP-2). error:11 "80 characters" is 79 non-space, non-comment characters
  (protocol.c:141 `char_counter >= (LINE_BUFFER_SIZE-1)`). error:14 is never emitted by 1.1h (grep; wiki: Grbl-Mega only).
- kerfdesk evidence: `src/core/controllers/grbl/alarm-codes.ts:76-82`, `src/core/controllers/grbl/error-codes.ts:41-45,60-65,73`.
- upstream: `doc/csv/error_codes_en_US.csv`, `doc/csv/alarm_codes_en_US.csv` at the pinned revision.
- fix (local): reword the four entries.

## Checked and correct (so far)
- Status fields: state/substate (Hold:0/1, Door:0-3), MPos/WPos per `$10`, Bf, Ln, F/FS, Pn (X,Y,Z,P,D decoded; R,H,S ignored by design), WCO, Ov, A (report.c:466-654); order-independent parse; canonical number grammar matches printFloat (print.c).
- WCO/Ov omitted on most frames (REPORT_WCO/OVR_REFRESH_*, report.c:602-649): wcoCache/ovCache/accessoryCache persist; WPos = MPos − cached WCO; Ov-without-A = all off (report.c:627-648).
- `$13`: status positions/feed normalised ×25.4; `$$` values stay mm (report.c:183-225).
- Classification: ok, error:N, ALARM:N (acks nothing), `[MSG|GC|PRB|HLP|VER|OPT|echo|G54..|TLO:]` as messages, `$N=` settings, `$N0=` listing and `>line:ok` startup echoes are not acks, banner = reboot boundary (main.c re-init).
- Failed probe prints `ALARM:4/5`, `[PRB:...:0]`, then `ok` (motion_control.c:273-316, gcode.c:1132): the zeroed ledger routes that `ok` to an empty stream (no-op).
- `$J=` built only with G90/G91, G21, X/Y/Z, F (gcode.c:853-857), sent only after fresh Idle or during the Frame's own JOG; error:15 handled (ADR-361).
- Probe cycles: G38.2 semantics, G10 L20 P0 unaffected by G91 (gcode.c:539-560 vs default case 580-600), corner geometry arithmetic verified; send-response per line.
- EEPROM writes (`$x=`, G10 L2/L20) are always owned send-response exchanges; no job program contains G10/G28.1/G30.1 (Interface wiki "EEPROM Issues").
- `$I` VER/OPT parse: option order matches report.c:375-446; RX 128 → window 120 (serial.c RX_RING_BUFFER = 129).
- Bytes > 0x7F refused for queued lines (serial.c:156); KerfDesk job lines carry no user text (full-line `;` comments are not streamed; sanitized comments); CR/LF: `\n` only.

## Still to check
- WCO-less window right after connect without a board reset (zero-WCO default) — judged guarded by the Frame permit's wcoCache comparison (framed-run.ts sameAxes null≠value).
- Report-units window after a reset before `$$` re-reads `$13` — qualification starts `$$` within 50 ms of the first Idle; judged too narrow to report.
