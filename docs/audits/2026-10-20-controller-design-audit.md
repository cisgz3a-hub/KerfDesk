# Controller design audit — how a sender should drive a controller, and where KerfDesk differs

Status: research plus read-only source audit. No hardware was operated and no controller code was
changed. Audited: `origin/main` at `9c6e6a3d8`, with open PRs #1287 (external G-code runs,
ADR-630), #1304 (ADR-642) and #1305 (ADR-640) taken into account. Prepared: 2026-10-20.

Correction, 2026-10-22: D-2's Idle timeout was already 10 seconds at the audited
commit, not 90. Ordered consumption is not evidence of a lost reply's success.
D-3 now includes Marlin's trailing resend acknowledgement, and D-7 no longer
infers a boot lock from missing alarm history. These correct the research;
they do not implement or authorize the proposals below.

This is the fifth controller audit of October. It does not repeat the earlier ones:

- `2026-10-16-controller-pipeline-audit.md` and `2026-10-16-controller-reconnect-audit.md`
  (transport, ownership and reconnect faults, all repaired);
- `2026-10-19-controller-behaviour-audit.md` (F-1 to F-10; F-1 to F-3 fixed by ADR-639);
- `2026-10-20-controller-protocol-audit.md` (P-1 to P-6; P-1, P-5 and P-6 fixed by ADR-644);
- ADR-610 with Amendments 1 and 2, ADR-611 with Amendment 1, ADR-639, ADR-640 (open in #1305)
  and ADR-644.

What is new here: a design reference for how controllers and mature senders behave, with
LightBurn's documented behaviour next to five open-source senders read from their source, and
seven findings (D-1 to D-7) that the earlier audits did not raise. Section 4 lists what is still
open from the earlier audits, re-checked on `9c6e6a3d8`.

Tags used below: **[inferred]** marks reasoning not proven by source or test; **[forum]** marks a
LightBurn claim that rests on a LightBurn staff forum post rather than its documentation.

## 1. How controllers work, and how a sender should drive them

### 1.1 GRBL 1.1 (the reference most firmware copies)

**Replies.** Every line gets exactly one `ok` or `error:N`, an empty line included; on `error:N`
GRBL "did not execute anything inside that message" ([interface]). `ALARM:N`, `[MSG:…]`, `[GC:…]`,
settings lines and the welcome banner are pushed without answering a line ([interface]).

**Welcome banner.** `Grbl 1.1h ['$' for help]` "always prints upon startup and after a reset" and
means GRBL "has completed re-initializing all its systems" ([interface]). A sender should treat it
as a reset boundary: every reply still owed is gone.

**Streaming.** Send-response is "the most fool-proof and simplest method". Character counting
fills the 128-byte RX buffer and is "recommended with reservation": after an error, lines already
in the buffer still run, and "a GUI won't be able to control this". The documented mitigation is
to vet a program with `$C` check mode first ([interface]). EEPROM writes (`G10 L2`, `G10 L20`,
`G28.1`, `G30.1`, `$x=`, `$I=`, `$Nx=`, `$RST=`) disable interrupts and must not be streamed with
character counting ([interface]).

**Errors.** "If a g-code line is parsed and generates an error response message, a GUI should
stop the stream immediately" ([interface]).

**Status.** Poll `?` at no more than 5 Hz. One position vector is sent; `WPos = MPos - WCO`.
`Bf:` is mainly for debugging: "Do not use this buffer data to control streaming". A `?` is not always
answered: duplicates are ignored, a soft reset clears a pending query, and there is no report
during homing or a critical limit alarm ([interface]). States: `Idle, Run, Hold, Jog, Alarm, Door,
Check, Home, Sleep`; `Hold:0` means the hold is complete, `Hold:1` means "Reset will throw an
alarm" ([interface]).

**Synchronising.** `G4 P0.01` empties the planner before the next task ([interface]).

**Realtime bytes** ([commands]). `?`, `~`, `!` (Idle, Run, Jog only), Ctrl-X, `0x84` safety door,
`0x85` jog cancel, `0x90`–`0x9D` overrides, `0x9E` spindle stop (Hold only), `0xA0`/`0xA1` coolant.

**Stopping and position.** Ctrl-X "immediately halts and safely resets"; when the machine is not
moving, "position is retained and re-homing is not required"; when it is moving, GRBL "will throw
an alarm to indicate position may be lost" ([commands]). In code, `mc_reset` kills the steppers
"only if in any motion state, i.e. cycle, actively holding, or homing" and raises `ALARM:3`
([motion_control.c]). A completed feed hold keeps position. With `DISABLE_LASER_DURING_HOLD` (on
by default) GRBL switches the laser off once a feed hold has stopped ([config.h]).

**Alarms and unlock.** In Alarm, GRBL locks out all G-code. `$X` "should only be used in
emergency situations. The position has likely been lost" ([commands]). With homing enabled and
`HOMING_INIT_LOCK` (default), GRBL boots into Alarm ([commands], [config.h]). After a hard or soft
limit, `[MSG:Reset to continue]`: only a reset is accepted ([interface]). `$SLP` exits only by
reset, into Alarm ([commands]).

**Startup blocks and check mode.** `$N` lines run at every power-up and reset (after homing when
homing is on) and never in Alarm; storing motion there needs care ([commands]). `$C` parses every
line without moving; turning it off performs an automatic soft reset ([commands]).

### 1.2 grblHAL

- Same protocol, larger RX ring reported in `[OPT:…,blocks,rx]` (`report_build_info`,
  [grblHAL report.c] lines 911-1114).
- grblHAL's sender guide says relying on the welcome banner on connect "is no longer possible"
  (native USB and network boards do not reboot on open). It recommends listening about 250 ms,
  then sending `0x87` for a complete report, and asking `$I+` for the extended identification
  ([grblHAL senders]).
- At the default `COMPATIBILITY_LEVEL 0`, plain `$I` already prints the extended form, including
  `[NEWOPT:…]` and `[FIRMWARE:grblHAL]` ([grblHAL report.c] lines 921-923, 1033, 1114).
- `\r\n` counts as one terminator; status is queued during homing unless `$10` bit 12 is set; a
  refused line's error stays latched until an empty line (earlier audits, HF-7, ADR-400).

### 1.3 FluidNC

- Its serial channel requires an `ok` before the next line, so character counting is not part of
  its protocol ([FluidNC Serial.cpp] lines 17-27).
- It answers `?` while homing, numbers alarms differently above 9, boots a homing machine into
  `ALARM:14`, and processes `$G` in order on the job channel in any state (ADR-610 Amendment 1,
  2026-10-20 protocol audit §1.3).

### 1.4 Marlin

- One `ok` per line. A line that starts with `N<n>` must carry a `*<checksum>` and follow the last
  number; otherwise Marlin answers `Error:` and `Resend: <n>` and does not run the line. A line
  without `N` is accepted with no check ([Marlin queue.cpp] `get_serial_commands`,
  [Marlin M110]). With `ADVANCED_OK` the reply names the line: `ok N<n> P<planner> B<buffer>`.
- `echo:busy:` keepalives while a command blocks ([Marlin M113]); `M400` waits for the planner;
  `M114` is the projected position; `M410` quickstops; `M112` kills until reset or power cycle
  ([Marlin M400], [Marlin M114], [Marlin M410], [Marlin M112]).
- 3D-printer hosts send numbered, checksummed lines and replay on `Resend:`: Printrun
  ([printcore.py] `_send`, lines 638-642; resend at 587-589) and OctoPrint while printing a file
  or streaming ([OctoPrint comm.py] `_checksum_enabled`, lines 5001-5008).

### 1.5 Smoothieware

`?`, `!`, `~` and Ctrl-X work in `grbl_mode`; Ctrl-X halts rather than reboots, and `M999` clears
the halt ([Smoothie console]). Covered in depth by the 2026-09-25 audit (SM-1 to SM-9).

### 1.6 Ruida

Ruida controllers run jobs from their own memory. LightBurn drives them live over USB or over
Ethernet (UDP) ([LB Ruida]). KerfDesk exports `.rd` files only and has no live Ruida link
(2026-10-16 pipeline audit), so there is no streaming or recovery path to audit here.

### 1.7 How established senders behave

LightBurn is from its documentation and changelog, with staff forum posts where the docs are
silent. The other five were read from source at pinned commits (UGS `75b3800`, bCNC `40e3163`,
CNCjs `747ffcd`, LaserGRBL `1f9337b`, Candle `v1.1.8` and nightly `c04e6f2`); file and function
names are in Sources.

| Behaviour | LightBurn | UGS | bCNC | CNCjs | LaserGRBL | Candle | KerfDesk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Connect | Newlines, `$I` for `[OPT:]` buffer size; `$$` only with "Fetch Settings on Connect"; DTR toggle [forum] | Wait 2 s, `?` ×10, `$I $$ $G`; Ctrl-X only if unresponsive | DTR pulse, `\n\n`; `$# $G` at Idle | `?` until a reply, then `$$` | Ctrl-X (default), `?`, `$$ $I` | Ctrl-X, drop lines until banner, `$$ $#` | Listen 250 ms, `?`, wait for Idle, `$$`, `$I` (stock GRBL only), `$G` |
| Stream window | Character counting, size from `[OPT:]`, else 128; Synchronous option | 128 | 127 | 120, grows from `Bf:` | 127, grows from `Bf:`/`[OPT:]` | 127 | 120, grows from `Bf:`/`[OPT:]`; one line at a time on FluidNC, Marlin, Smoothieware |
| `error:N` in a job | Not documented | Pause (`!`) | Stop sending | Pause; ignore option | Count and continue | `!`, then Ignore or Abort dialog | Stop and soft reset (P-2) |
| Lost `ok` | Stays Busy [inferred] | None | None | None | Fake `ok` after 10 s if `Bf:` empty | None | Job tail: ordered `$G` probe (ADR-610); mid-job: 10 s with fresh Idle, 90 s while Run (D-2) |
| Stop | Ctrl-X, then laser off [forum, changelog] | `!`, wait for Hold with MPos still, then Ctrl-X | `!`, 1 s, Ctrl-X, `$X`, restore modal state | `!`, 500 ms, Ctrl-X (force) | Clear queue, `M5` | 1.1.8: `!`, wait, Ctrl-X, restore offsets | Ctrl-X at once for its own job (D-1); hold first for motion it does not own |
| After a reset | Auto-unlocks on `[MSG:'$H'\|'$X' to unlock]`; optional Auto-Home [forum, docs] | Nothing re-read | `$X`, modal restore | Nothing | Ends job | Restore modal + G92 | `M5 M9`, re-read `$$ $I $G` (D-5), no auto-unlock |
| Status poll | About 0.5 s idle, not during a job [forum] | 200 ms | 125 ms | 250 ms | 500 ms default | 250 ms (1.1.8) | 250 ms active, 1 s idle |
| Silence | Not documented | Re-poll after 20 ticks | None | Re-poll after 5 s | "Stopped responding" after ≥5 s | None | "Not responding" after 8 s; mid-job 2 s heartbeat resets |
| Alarm | Console only; docs: re-home after `ALARM:3` | `$X`/`$H`, blocks start | `$X`/`$H` | `$X`/`$H` | `$X`/`$H` | `$X`/`$H` | Banner with Unlock, Home or Reset by alarm class |
| Reconnect | At app start on the same port; manual "right-click Devices" | Close only | Close only | One auto-connect at load | Close only | Every 1 s | On USB connect events, paused after Disconnect (ADR-639); job kept for recovery |
| Check mode | Not documented | `$C` toggle | `$C` toggle | — | — | `$C`, stream, reset, restore | Console `$C` only (D-6) |
| Jog | `$J=`; continuous jog to axis end, stop on release | `$J=` steps, `0x85` | `$J=`, no `0x85` | `G91 G0`, `0x85` | `$J=`, continuous + `0x85` | `$J=`, continuous + `0x85` | `$J=` + `0x85`; no queued steps (P-3) |

LightBurn sources: Stop sends Ctrl-X ([LB forum 62623], Oz, 2022-03-15); auto-unlock and
non-editable startup sequence ([LB forum 39167], Oz, 2021-04-23); Auto-Home on Startup and
Transfer Mode ([LB basic]); Fetch Settings and Check for Workpiece Offsets on Connect ([LB gcode]);
re-home after `ALARM:3` ([LB errors]); reconnect by right-clicking Devices ([LB connecting],
[LB laser window]); buffer size from `[OPT:]` ([LB forum 192109]); Stop now switches the laser
off ([LB 2.1 changelog]).

### 1.8 Design rules distilled

Each rule cites its source above. KerfDesk meets every rule except where a finding is named.

1. Match replies to lines in order; a banner ends every owed reply.
2. Use character counting only where the firmware documents it; send EEPROM writes alone.
3. Stop the stream on `error:N`. Character counting cannot stop lines already sent; `$C` vets a
   program beforehand (D-6, P-2).
4. Stop motion with a feed hold, then reset once the hold is complete, so the position survives
   (D-1). Reset at once only when the hold cannot be seen.
5. Never treat Idle alone as proof that a reply was lost; prove it with an ordered query
   (ADR-610). An ordered query proves consumption, not success; it cannot by itself
   justify continuing after a lost mid-job response (D-2).
6. Where the firmware offers transport integrity (Marlin line numbers and checksums), use it (D-3).
7. Identify the firmware explicitly; do not rely on a banner that native USB boards never print
   (D-4).
8. A soft reset does not change stored settings: re-read the modal state, not the settings (D-5).
9. Poll status at 5 Hz or less and keep polling in Hold, Door and Alarm. Outside a job, show
   silence as "not responding" rather than a fault. During a job, KerfDesk deliberately stops
   after 2 s of silence (ADR-212's fail-dark rule); no peer stops at all, and D-1 covers how
   that stop should be made.
10. Unlock only on the operator's word; offer homing (D-7).

## 2. Findings

| ID | Area | What KerfDesk does | What controllers and peers do | Severity | Recommended fix |
| --- | --- | --- | --- | --- | --- |
| D-1 | Stopping a running job | Abort of its own job, the stop after `error:N`, the 2 s heartbeat stop and the 90 s hold stop all send Ctrl-X at once on GRBL-family controllers (`laser-job-stop.ts:256`, `:304-329`; `laser-error-line.ts:228-237`; `laser-stream-heartbeat-containment.ts:52-77`, `:102-130`). | Ctrl-X while moving raises `ALARM:3` and loses position; after a completed hold it does not. UGS, bCNC, CNCjs and Candle 1.1.8 hold first. LightBurn sends Ctrl-X at once and tells users to re-home. | Correctness and UX, High. Maintainer decision (departs from LightBurn). | Reuse `unowned-motion-stop.ts`'s hold-then-reset (2 s bound) for owned stops; keep homing proof when the reset landed on a settled hold. ADR amending ADR-207, ADR-215 Amd 1 and ADR-212. Hardware check. |
| D-2 | Lost reply mid-job | The ordered `$G` proof runs only once every line is on the wire (`laser-lost-ack-reconcile.ts:205`). On FluidNC, Marlin and Smoothieware (one line at a time, `controller-streaming-mode.ts:8-12`) one lost reply stops the stream; after 10 s with fresh Idle (90 s while Run) KerfDesk ends the job with a reset or quickstop (`laser-stream-stall.ts:19`, `laser-stream-hold.ts:63`, `laser-stream-heartbeat-containment.ts:52-77`). | FluidNC answers `$G` in order in any state, so `[GC:` proves the owed line was read. Marlin numbered lines echo `ok N<n>` with `ADVANCED_OK`. No peer recovers this case except LaserGRBL (`Bf:`-based). | Correctness and UX, Medium. | Extend the ADR-610 Amendment 1 probe to a one-line stream after 1 s of fresh Idle (identified firmware); treat `[GC:` only as proof of consumption, never proof that the missing reply was successful; do not resume new motion on it alone. Marlin: D-3. Smoothieware: keep the timed rule. ADR-610 Amendment 3. |
| D-3 | Marlin transport integrity | Job lines go out as `<line>\n` with no `N` or checksum (`streamer.ts:62`; ADR-095 "no line-number replay in v1"); `Resend:` ends the job (`laser-error-line.ts:96-132`). | Marlin checks a checksum only on numbered lines and refuses a damaged one with `Resend:` without running it. Printrun and OctoPrint number and checksum. | Correctness, Medium [inferred frequency]. | `M110 N0` before a stream, `N<n> … *<cs>` on each line, own the full `Resend:` plus trailing `ok` exchange before retransmission (bounded retries), use `ok N<n>` when present. Count the prefix in the line-length limit. Hardware check. |
| D-4 | grblHAL identity | The generic grblHAL driver sends no `$I` (`grblhal/driver.ts:86-88`) and no `0x87`, so a board that printed no banner stays unidentified; a lost final reply then waits 15 s for the sustained-Idle rule (ADR-610 Amd 2). | grblHAL's guide says not to rely on the banner and recommends `$I+` and `0x87`; plain `$I` prints `[FIRMWARE:grblHAL]` at the default compatibility level. LightBurn reads `$I` on connect. | UX, Low-Medium. | Send `$I` (or `$I+`) once on the generic grblHAL driver, never the Falcon command sets; accept `[FIRMWARE:grblHAL]` as identification; take the RX size from `[OPT:]`. Fold in P-4's `0x87`. ADR-610 Amd 2 rejected this for lack of evidence; this is the evidence. |
| D-5 | Re-reads after a reset | Every banner, including after KerfDesk's own Abort or Disconnect reset, clears the settings snapshot and re-reads `$$`, `$I`, `$G` (`laser-line-handler.ts:401`, `:406`, `:445`). Each completed read pops the 8 s "Machine settings detected" toast, even when nothing changed (`laser-line-handler.ts:318`, `DetectedSettingsToast.tsx:18-31`, `:63`). The read waits for Idle (F-4), so after an `ALARM:3` Home falls back to the 30-minute backstop (`laser-home-action.ts:79-81`). | Settings live in EEPROM and survive a soft reset. UGS, CNCjs and LightBurn re-read nothing after a reset; LightBurn reads settings on connect only when asked. | UX, Medium (a routine read announces itself after every Abort). | After a reset KerfDesk sent on the same port, keep the `$$`/`$I` snapshot and re-read only `$G`. Keep today's invalidation for `$RST=`, setting writes and uncommanded banners. Toast only when the read found something new (F-5). |
| D-6 | Vetting an external program | `$C` is a Console command only (`grbl/console-command.ts:55`). With P-2's reset-on-error, a bad line in an external file costs the job (once #1287 merges). | GRBL documents `$C` as the answer to character counting's error reservation; UGS and Candle offer a check run. | UX, Low (conditional on #1287). | "Check on controller" for an external file: `$C`, stream, collect errors, `$C` off (automatic reset). Stock GRBL, grblHAL and FluidNC only. |
| D-7 | Alarm at connect | No "Home when connected" option and no automatic unlock (no match for auto-home or auto-unlock in `src/`). Every connect to a homing-enabled machine stops at the Alarm banner. | LightBurn offers Auto-Home on Startup and auto-unlocks when it sees `[MSG:'$H'\|'$X' to unlock]`. GRBL warns that `$X` may leave the position wrong. | UX, Low. | Add an opt-in per-machine "Home when connected", run only at a fresh Alarm or Idle with nothing else running. Do not copy the automatic unlock after a position-losing alarm; unknown alarm causes require explicit operator unlock; absent `ALARM:N` is not boot-lock evidence. |

### D-1 — KerfDesk-initiated stops of a running job reset mid-motion

**What happens.** `runStopJob` first checks for motion nothing in KerfDesk owns and, for that,
already does the right thing: jog cancel for a jog, feed hold then reset after `Hold:0` (bounded
to 2 s) for a run (`laser-job-stop.ts:98-108`, `unowned-motion-stop.ts:58-70`, ADR-375 C-2). For
KerfDesk's own job, GRBL-family drivers go straight to `stopWithOwnedReset`
(`laser-job-stop.ts:256`), which posts Ctrl-X before anything else
(`laser-disconnect-transaction.ts:166`). The automatic stops do the same: after `error:N`
(`laser-error-line.ts:228-237`), after 2 s without status while a job streams
(`laser-stream-heartbeat-containment.ts:102-130`, WORKFLOW F-B10), and after 90 s without
acknowledgements (`:52-77`).

**Consequence.** Unless the machine was already stopped, GRBL raises `ALARM:3` and the steppers
stop without deceleration. The operator then has to Unlock or Home, the banner handler drops
homing proof and the Frame (`laser-line-handler.ts:430-432`), and recovery records the position as
lost (ADR-215 Amendment 1). Pausing first and then aborting avoids all of that today (ADR-215
Amendment 1, "Consequences"), which shows the outcome is reachable.

**Peers.** UGS (`GrblController.cancelSendBeforeEvent` → `!`, then reset once a Hold report shows
MPos unchanged), bCNC (`Sender.stopRun` → `purgeController`), CNCjs (`gcode:stop` with `force`),
and Candle 1.1.8 (`on_cmdFileAbort_clicked`) hold before resetting. LightBurn does not: Stop sends
Ctrl-X [forum], and its error guide says to re-home after `ALARM:3` ([LB errors]).

**Trade-off.** During the hold's deceleration the beam stays under the planner: with M4 (KerfDesk's
default for GRBL lasers, `gcode-dialects.ts:97-99`) power falls with speed; with M3 it stays at the set power until the hold
completes and `DISABLE_LASER_DURING_HOLD` switches it off. At laser accelerations that is usually
well under a second [inferred]. An immediate reset switches the spindle output off first
([motion_control.c]). That is why this needs the maintainer's decision, and why it departs from
"copy LightBurn". The case for it: no alarm, no Unlock, no re-home and no Frame after an Abort,
which is the "no repeated prompts" outcome the maintainer asked for.

**Fix.** An ADR amending ADR-207, ADR-215 Amendment 1 and ADR-212's fail-dark stops: owned Abort
and the `error:N` stop send the hold (the safety-door byte on lasers, as Pause already does) and
reset once a fresh report shows `Hold:0` or `Door:0/1`, or after the existing 2 s bound. Keep the
immediate reset for app closing, homing, Smoothieware, drivers with no status query, and as the
second step of the heartbeat and hold stops (send the hold first there too; if the link is
half-dead it costs nothing). When the reset landed on a settled hold and no `ALARM:N` followed,
keep the homing proof; whether the Frame survives is a Frame-first policy question for the same
ADR. Hardware check on a stock GRBL and a Falcon: decel distance and beam-off timing in M3 and M4.

### D-2 — One lost reply can stall a one-line-at-a-time job

**What happens.** ADR-610 and its amendments finish a job whose last replies were lost, but only
once `queuedLineCount(streamer) === 0` (`laser-lost-ack-reconcile.ts:205`). FluidNC, Marlin and
Smoothieware always stream one line at a time (`controller-streaming-mode.ts:8-12`), so a reply
lost to a UART line error (the premise of ADR-375 and ADR-600) stops the stream on the spot. The
live bar names the wait after 3 s; with fresh Idle the hold watchdog expires after 10 s
(90 s applies while Run is reported), marks the job errored, raises the
safety notice and sends Ctrl-X (FluidNC) or the driver's stop lines (Marlin's quickstop,
Smoothieware's stop lines) (`laser-stream-hold.ts:63`, `laser-stream-heartbeat-containment.ts:52-77`). The machine had been
idle since the lost line. The missing response could have been an error, so the sender
cannot establish whether that block's modes or motion applied. These timeout values
are present in `laser-stream-hold.ts` at the original audited commit `9c6e6a3d8`.

On character-counted GRBL and grblHAL a lost reply mid-job does not stall at once; the host is one
line behind and the window is smaller until the tail probe resolves it [inferred from
`streamer.ts`; several losses in one job could still stall it].

**Research direction, not an implementation specification.** An ordered `$G` response
can establish that an earlier line was consumed. It cannot distinguish a lost `ok`
from a lost `error:N`. Stock GRBL rejects an erroneous block atomically: a lost
`G91 F-1` error leaves absolute mode active, so resuming a queued relative program
would change its path. Do not credit the response as successful and resume on this
evidence alone. Any mid-job recovery design needs evidence that resolves execution
state as well as response ownership. The existing tail-settlement rule does not
authorize a continuation that sends new motion. An `M114` report likewise describes
position, not the success of every preceding Marlin command. D-3's numbered replies
would improve transport correlation but still need explicit error handling.

### D-3 — Marlin lines carry no line number or checksum

**What happens.** Lines go to the wire as `<line>\n` (`streamer.ts:62`). ADR-095 made `Resend:` a
terminal error "no line-number replay in v1", and `handleResendLine` still ends the stream
(`laser-error-line.ts:96-132`). The 2026-10-20 protocol audit listed "no `N` or checksum" as
correct because Marlin accepts it; it does, but it then runs a damaged line as received.

**Why it matters.** KerfDesk's UART line-error detection (ADR-375, ADR-600) sees only bytes
arriving from the controller. A byte flipped on the way to a Marlin board, for example by laser
EMI, turns `G1 X12.5 S800` into another move or power, or into a rejected command. Marlin can
catch that, but only for numbered lines ([Marlin queue.cpp]). How often it happens depends on the
machine and cable [inferred].

**Fix.** Send `M110 N0` before a stream and `N<n> <line>*<xor>` for each job line. On
`Resend: <n>`, first consume the rejection exchange's trailing `ok`: Marlin
`queue.cpp::flush_and_request_resend` emits `Resend:` followed by `ok_to_send()`.
An immediate retransmission must not let that old `ok` acknowledge the new copy.
Only after owning the complete exchange should the sender retransmit the requested
line with bounded retries and retain today's terminal stop after them. Use
`ok N<n>` (with `ADVANCED_OK`) to match replies. Include the prefix in the line-length check
(Marlin's `MAX_CMD_SIZE`). Console lines can stay unnumbered. Hardware check on a Marlin laser
build.

### D-4 — grblHAL boards are never asked who they are

**What happens.** The generic grblHAL driver sets `buildInfoQuery: null` ("grblHAL extends `$I`;
do not treat a variant response as stock proof", `grblhal/driver.ts:86-88`), and nothing sends
`0x87` (P-4, still open). A native-USB grblHAL board prints no banner on open, so the session
stays unidentified. ADR-610 Amendment 2 then waits for 15 s of Idle before it probes a lost
final reply, instead of 1 s, and the RX window is learnt only from `Bf:` (ADR-331).

**Evidence.** ADR-610 Amendment 2 rejected an automatic `$I` because "sending a new automatic
query to them has no evidence behind it". grblHAL's own sender guide recommends `$I+` and `0x87`
on connect and warns that the banner cannot be relied on ([grblHAL senders]). Its `$I` prints the
extended report at the default compatibility level, ending in `[FIRMWARE:grblHAL]`
([grblHAL report.c] lines 921-923, 1114). LightBurn reads `$I` on connect for the buffer size
([LB forum 192109]). The Falcon reason does not apply: the Falcon command sets use their own
driver and keep `$I` off.

**Fix.** On the generic grblHAL driver only, send `$I` once in the handshake (`$I+` when the
banner showed a compatibility-level `Grbl 1.1f`), parse the extended report, accept
`[FIRMWARE:grblHAL]` as identification, and take the RX size from `[OPT:]`. Send `0x87` per P-4.
Amend ADR-610 Amendment 2's rejected alternative.

### D-5 — Settings are thrown away after every reset KerfDesk sends itself

**What happens.** `handleWelcomeLine` clears `controllerSettings` and `grblSettingsRows` and
restarts qualification for every banner (`laser-line-handler.ts:401`, `:406`, `:445`), including
the banner that follows KerfDesk's own Abort, error stop or Disconnect reset. The automatic re-read
waits for Idle (F-4, `machine-settings-read-readiness.ts:55-56`), so after an Abort that raised
`ALARM:3` the settings stay unread until the operator unlocks. Meanwhile Home is bounded by the
30-minute backstop instead of the `$$`-derived limit (`laser-home-action.ts:79-81`, ADR-400), and
the "Not responding" window for an owed reply uses the same backstop (ADR-610 Amendment 2).

When the read does complete, it sets `lastSettingsReadAt` (`laser-line-handler.ts:318`), and
`DetectedSettingsToast` (mounted in `MachineConnectionToolbar.tsx:16`) pushes an 8 s info toast
for every new read time (`DetectedSettingsToast.tsx:18-31`). With nothing to report, the text is
"Machine settings detected: controller settings were read successfully in Machine Setup." (`:63`).
So every connect and every Abort that reset the board ends with a toast about a routine read. That
is the "repeated re-read prompt" the maintainer asked to remove; ADR-611 quietened the toolbar
notices but not this toast (F-5 of the 2026-10-19 audit, still open).

**Peers.** GRBL stores settings in EEPROM; a soft reset reloads them unchanged ([commands]). UGS
returns early from its initializer after a reset and re-reads nothing; CNCjs re-reads nothing;
LightBurn reads settings on connect only with "Fetch Settings on Connect" ([LB gcode]).

**Fix.** When the banner closes a reset KerfDesk sent on this port (the owned reset boundary
already knows this), keep the `$$` and `$I` snapshot and re-read only `$G`, since the modal state
and active WCS do reset. Keep the full invalidation for uncommanded banners, `$RST=`, setting
writes and new connections. Separately, show the toast only when the read found profile updates
or review items that differ from the last read on this port; keep the plain "read successfully"
line in the log and the Controller info panel.

### D-6 — No check-mode run before an external program

**What happens.** Once #1287 lets operators run external G-code, a line the controller rejects
ends the job with a reset (P-2). `$C` exists only as a Console command
(`grbl/console-command.ts:55`).

**Peers and firmware.** GRBL names `$C` as the "interim solution" for character counting's error
reservation ([interface]). UGS (`toggleCheckMode`) and Candle (`on_cmdCheck_clicked`) offer a
check run.

**Fix.** For an external file on stock GRBL, grblHAL or FluidNC, offer "Check on controller":
`$C`, stream the file one line at a time, collect each `error:N` with its line, then `$C` again
(GRBL resets itself) and report. A warning, never a gate. Low priority until #1287 merges.

### D-7 — Connecting to a homing machine always stops at the Alarm banner

**What happens.** A machine with homing enabled boots into Alarm ([commands]); KerfDesk shows the
Alarm banner with Unlock and Home. There is no option to home on connect and no automatic unlock.

**LightBurn.** Auto-Home on Startup homes when the machine connects ([LB basic]); without it,
LightBurn unlocks by itself when it sees `[MSG:'$H'|'$X' to unlock]` [forum, Oz 2021-04-23].

**Fix.** Copy Auto-Home as an opt-in per machine, off by default: home once, on the first fresh
report of the session, only at Alarm or Idle with no job, Fire, motion or controller operation,
and never after a reconnect that interrupted a job. Do not copy the automatic unlock in general:
GRBL prints the same message after `ALARM:3`, where `$X` hides a lost position. If the maintainer
wants it, a separate design must first identify a boot lock using positive evidence.
An Alarm report with no `ALARM:N` line in this session is insufficient: the alarm
may predate the connection, or its pushed message may have been lost. Keep unlock
an explicit operator action when the cause is unknown. Stock GRBL's
`HOMING_INIT_LOCK` check is before the reinitialization loop in `main.c`; it does
not by itself force Alarm on every soft reset.

## 3. Checked and consistent with the rules

- Replies are matched in order; a banner (or FluidNC's, Smoothieware's and Marlin's equivalents)
  ends every owed reply and starts a new session (`laser-line-handler.ts:393-445`).
- Character counting only on GRBL and grblHAL, 120-byte default window, growth only from quiescent
  `Bf:` or `[OPT:]` evidence with grblHAL's clamped 65535 treated as 1024
  (`laser-rx-capacity-evidence.ts`). This uses `Bf:` as capacity evidence, not to pace the stream,
  which is what GRBL's warning is about.
- EEPROM lines stream alone (ADR-644). Settings, origin and probe writes wait for their reply.
- The status poll re-sends `?` every tick with at most one write in flight
  (`laser-status-poll-writer.ts`), so an unanswered `?` never stops polling.
- Job end is a `G4`/`M400` settle marker plus fresh Idle, as GRBL's synchronisation note
  describes (`laser-post-job-settle.ts`).
- Pause uses the safety-door byte, so the laser is off while paused; LightBurn uses `!` only for
  M4 jobs and otherwise drains the buffer with the beam under program control [forum].
- A lost final reply is proved with an ordered `$G`, not a timer (ADR-610 Amendments 1-2);
  LightBurn would stay Busy [inferred].
- Silence reads "Not responding" after 8 s of on-schedule polling, as a status, not a pop-up
  (ADR-611 Amendment 1).
- Background reconnect is quiet and respects Disconnect (ADR-639); a lost link during motion
  keeps the interrupted job for an explicit recovery and never resumes by itself.
- The display stays awake during a job (ADR-117, `use-active-job-wake-lock.ts`).
- Marlin Abort uses `M410` with `M107` first (`marlin/commands.ts`); LightBurn's Marlin Stop only
  stops sending [forum].

## 4. Still open from earlier audits (re-checked on `9c6e6a3d8`)

| ID (audit) | Still true on main | Note |
| --- | --- | --- |
| F-4 (10-19) | Automatic settings read requires Idle (`machine-settings-read-readiness.ts:55-56`) | Makes D-5 worse after an Abort. |
| F-5 (10-19) | "Machine settings detected" toast on every completed read, even with nothing new (`DetectedSettingsToast.tsx:18-31`, `:63`) | Toolbar phase notices were removed by ADR-611; the toast remains, and D-5 makes it follow every Abort too. |
| F-6 (10-19) | Every GRBL-family Disconnect sends Ctrl-X (`laser-disconnect-stop.ts:59-64`) | LightBurn's "right-click Devices" also resets the board when DTR is wired to reset [forum]. |
| F-7 (10-19) | One owed reply recommends Reconnect (`controller-recovery-status.ts:46`) | D-2's probe would also clear most of these. |
| F-8, F-9, F-10 (10-19) | `SerialPortGrants.allows` still matches by stored identity only (`electron/serial-port-grants.ts:109-114`); "Controller information unavailable" copy remains (`ControllerRecoveryToast.tsx:35`); worker handshake still 2 s (`worker-serial-connection.ts:55`) | Unchanged. |
| P-2 (10-20) | Any `error:N` in a job resets the controller (`laser-error-line.ts:207-237`) | D-1 changes how it stops; P-2 is whether to offer Resume. |
| P-3 (10-20) | Jog steps cannot queue while a jog runs | ADR-640 (#1305) touches jog cancel, not queueing. |
| P-4 (10-20) | No `0x87` anywhere in `src/` | Fold into D-4. |
| CS-02 (07-26) | `$N` is a Console command only; the handshake never reads startup blocks | A reset-based stop can still run uninspected startup lines. |
| CS-04 (07-26) | Marlin `M114` is parsed as `Idle` (`marlin/response.ts:105`) | Unchanged. |
| CS-05 (07-26) | Listed open by the 10-20 audit | Not re-verified here. |

## 5. Suggested order

1. **D-5 with F-5**: small store and UI change, no hardware risk; removes the settings toast and
   the backstop window that follow every Abort and connect. Closest to the maintainer's "quiet
   routine reads".
2. **D-1**: decide the stop policy (ADR), since it changes Abort, the `error:N` stop and the
   automatic stops together. Hardware check on stock GRBL and the Falcon before release.
3. **D-4 with P-4**: one handshake query and one realtime byte on generic grblHAL; unit- and
   simulator-testable.
4. **D-2**: ADR-610 Amendment 3 for FluidNC, reusing the existing probe and its simulator tests.
5. **D-3**: Marlin numbering and resend, simulator first, then a Marlin laser build.
6. **D-7**: opt-in Auto-Home, UI plus one guarded action.
7. **D-6**: after #1287 merges.
8. Earlier items: F-4 and F-7 (store), F-6 (ADR-212 amendment, pairs with D-1), P-2 (maintainer
   decision), P-3, CS-02, CS-04.

## Sources

Firmware:

- [interface]: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface
- [commands]: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- [config.h]: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h
  (`DISABLE_LASER_DURING_HOLD`, `HOMING_INIT_LOCK`, lines 583-587 for the former per ADR-375)
- [motion_control.c]: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386
  (`mc_reset`)
- GRBL hold completion: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L377-L381
- [grblHAL senders]: https://github.com/grblHAL/core/wiki/For-sender-developers (draft page,
  edited 2023-11-25)
- [grblHAL report.c]: https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L911-L1114
- [FluidNC Serial.cpp]: https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Serial.cpp#L17-L27
- [Marlin queue.cpp]: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp
  (`get_serial_commands`, `gcode_line_error`, `flush_and_request_resend`, `ok_to_send`)
- [Marlin M110]: https://marlinfw.org/docs/gcode/M110.html; [Marlin M113]: https://marlinfw.org/docs/gcode/M113.html;
  [Marlin M114]: https://marlinfw.org/docs/gcode/M114.html; [Marlin M400]: https://marlinfw.org/docs/gcode/M400.html;
  [Marlin M410]: https://marlinfw.org/docs/gcode/M410.html; [Marlin M112]: https://marlinfw.org/docs/gcode/M112.html
- [Smoothie console]: https://smoothieware.org/console-commands

Senders (source, pinned):

- UGS: https://github.com/winder/Universal-G-Code-Sender/blob/75b380036065378cf3cfe68962431f1354354447/ugs-core/src/com/willwinder/universalgcodesender/
  — `GrblController.java` (`cancelSendBeforeEvent`, `handleStatusString`, `initialize`),
  `GrblControllerInitializer.java`, `communicator/BufferedCommunicator.java`,
  `communicator/GrblCommunicator.java`, `utils/CommUtils.java`, `StatusPollTimer.java`
- bCNC: https://github.com/vlachoudis/bCNC/blob/40e31637a194e8238976994ab42822fbe74b0dd4/bCNC/
  — `Sender.py` (`open`, `serialIO`, `stopRun`), `controllers/_GenericController.py`
  (`purgeController`, `parseLine`), `controllers/GRBL1.py`
- CNCjs: https://github.com/cncjs/cncjs/blob/747ffcd5f208ad6556846196d12845c6e6a7fb72/src/
  — `server/controllers/Grbl/GrblController.js` (`open`, `gcode:stop`, `queryTimer`),
  `server/lib/Sender.js`
- LaserGRBL: https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs
  (`HandleMissingOK`, `DetectHang`, `AbortProgram`)
- Candle: https://github.com/Denvi/Candle/blob/v1.1.8/src/frmmain.cpp (`on_cmdFileAbort_clicked`,
  `on_cmdCheck_clicked`) and nightly https://github.com/Denvi/Candle/blob/c04e6f2565059aec00179e3a480e236ce9e4ee8b/src/candle/frmmain.cpp
- [printcore.py]: https://github.com/kliment/Printrun/blob/ecd260f14adf7e659eff92c4326240f0bb282e25/printrun/printcore.py#L638-L642
- [OctoPrint comm.py]: https://github.com/OctoPrint/OctoPrint/blob/9eb6ae3946ab89bf26a3f0aab44b2b6f88714b59/src/octoprint/util/comm.py#L5001-L5034

LightBurn:

- [LB laser window]: https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/
- [LB connecting]: https://docs.lightburnsoftware.com/2.0/GetStarted/ConnectingToLaser/
- [LB basic]: https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/
- [LB gcode]: https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/GCode/
- [LB errors]: https://docs.lightburnsoftware.com/2.1/Troubleshooting/GRBLErrors/
- [LB Ruida]: https://docs.lightburnsoftware.com/2.1/Guides/RuidaEthernet/
- [LB 2.1 changelog]: https://files.release.lightburnsoftware.com/LightBurn/RC/LightBurn-v2.1.00-RC-9/CHANGELOG
- [LB forum 62623] (Stop sends Ctrl-X): https://forum.lightburnsoftware.com/t/lightburn-doesnt-seem-to-handle-unresponsive-grbl-interface-when-on-hold-or-door/62623
- [LB forum 39167] (automatic unlock): https://forum.lightburnsoftware.com/t/how-to-change-the-startup-commands/39167
- [LB forum 192109] (buffer size from `[OPT:]`): https://forum.lightburnsoftware.com/t/192109
- Pause behaviour by laser mode: https://forum.lightburnsoftware.com/t/new-user-problem-with-pause-then-resume/22402
