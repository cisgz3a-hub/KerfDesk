# SAFETY Root-Cause Report: Laser Keeps Burning ~20s After a USB Cable Yank / Disconnect

**Date:** 2026-06-04
**Component:** LaserForge 2.0 (LF2) -- live tree at `C:/Users/Asus/LaserForge-2.0`
**Severity:** SAFETY / P0 (uncontrolled laser firing; risk of burn or fire)
**Transport in scope:** Web Serial / USB only (confirmed -- see Section 5)
**softwareFixable verdict:** `no-physical-yank-is-hardware` (software can SHRINK the burn window; it CANNOT stop the machine once the cable is gone)

---

## 1. BOTTOM LINE (read this if you read nothing else)

When you yank the USB cable mid-job, the laser keeps burning because GRBL has already received many lines of g-code ahead of where the head physically is, and **once the cable is gone there is no longer any wire over which software can send a stop command.** GRBL 1.1 has no "I lost my host, shut down" reflex. It simply keeps executing every motion it has already buffered -- in its serial receive buffer, in its internal motion-planner block buffer, and whatever the operating system had already pushed into the USB driver's transmit queue -- until that queued motion runs out. With LaserForge's default stream-ahead depth and default cut speed, that queued motion adds up to roughly the ~20 seconds you observed. The host (LaserForge) detects the disconnect almost instantly and correctly raises a safety banner, but detection is not the same as stopping: **it cannot reach across a severed cable to turn the laser off.**

Plain-language answer to the two questions:

- **Why ~20s?** Because that much *motion* was already queued downstream of the host (GRBL RX buffer + GRBL planner blocks + OS/driver TX queue) before the cable was pulled. The number is dominated by queued motion DURATION, not by serial transfer time.
- **Can software stop it?** **No -- not for a physical yank.** No command can travel a cable that is no longer connected. Software can only (a) reduce how far ahead it streams so less motion is pre-queued (shrinks the window), and (b) loudly tell you to hit the physical stop. A *true* stop on link-loss requires firmware (a GRBL-side host-loss watchdog, or a DTR-toggle hardware reset) or external hardware (E-stop / power cutoff). **Do not use a USB yank as a stop. Keep a hardware E-stop or power switch within reach.**

---

## 2. The Disconnect Sequence, Step by Step (with file:line)

Timeline of a physical cable yank during an active job:

**T = 0 ms -- cable physically pulled.**
The USB device disappears from the OS. At this instant, GRBL already holds g-code that the host streamed ahead of the head's real position (this is normal flow control -- see Section 3). Nothing the host does from here can reach the controller.

**T ~ <100 ms -- the browser fires the `disconnect` event.**
`src/platform/web/web-serial.ts:114-119` -- `handleDroppedConnection()` is the registered `disconnect` listener. It removes the listener, calls `void closeStreamsOnce()` (async, best-effort), then `fireClose()` synchronously. (Latency here is OS/driver detection time, typically tens of milliseconds; it is NOT the 0.5-2s some prior notes claimed -- see Section 7.)

**T ~ <100 ms -- the host tears down and marks state disconnected. NO stop command is attempted.**
`src/ui/state/laser-store.ts:241-249` -- the `onClose` handler runs `teardown()` then `set(buildPortClosePatch)`. It does **not** call `disconnectStopCommand()` and does **not** call `safeWrite()`.
`src/ui/state/laser-store-helpers.ts:80-97` -- `buildPortClosePatch()` is a *pure state patch*. It flips `connection` to `disconnected`, marks the streamer `disconnected` via `disconnectStreamer()` (`src/core/controllers/grbl/streamer.ts:186-188`, which only clears the host-side queue and sets status), clears caches, and -- if a job was active -- attaches `disconnectDuringJobNotice()`. It sends **zero** bytes to the device.

**Contrast -- the USER-initiated Disconnect button (NOT this path):**
`src/ui/state/laser-store.ts:270-296` -- `disconnect()` first computes `stopCommand = disconnectStopCommand(get())` and, if non-null, `await safeWrite(..., stopCommand, 'disconnect')` BEFORE tearing down.
`src/ui/state/laser-store-helpers.ts:32-35` -- `disconnectStopCommand()` returns `RT_SOFT_RESET` (`'\x18'`, Ctrl-X; `src/core/controllers/grbl/commands.ts:24`) for an active job, `RT_JOG_CANCEL` for a motion op, else `null`. **This soft-reset path only runs when the operator clicks Disconnect while the cable is still attached.** On a physical yank the cable is already gone, the `onClose` path runs instead, and even if a write were attempted it would throw because `port.writable`/the writer is dead (`web-serial.ts:124-126` -- `write()` only guards `ctx.writer === undefined`, then calls `ctx.writer.write()`, which rejects on a severed stream).

**T = 0 to ~20 s -- GRBL drains its queued motion, laser firing.**
GRBL keeps executing the lines it already had (RX buffer + planner blocks) plus anything the OS driver had already transmitted. The laser stays on across these moves because S-power is modal (Section 4). This is the ~20 seconds of continued burn.

**T ~ 20 s -- the machine stops on its own.**
GRBL runs out of queued motion. With no further bytes arriving (the host is gone), the planner empties and motion halts. The diode goes dark only when a buffered `M5`/`S0` happens to execute OR when motion simply ceases at the end of the queue -- whichever the buffered stream contained. There is no deliberate shutoff; it is exhaustion of the queue.

**Net:** detect (yes, fast) -> attempt halt (NO, by design, because the link is gone) -> GRBL executes its entire downstream queue -> stops when the queue is empty. The host's only action is a banner: `DISCONNECT_DURING_JOB_MESSAGE` (`src/ui/state/laser-safety-notice.ts:47-50`): *"USB connection was lost during an active job. The machine may still be moving from buffered commands. Use physical E-stop or power cutoff now if unsafe..."*

---

## 3. ROOT CAUSE + Buffer Math

### Single clearest statement of the mechanism

**The ~20s burn is queued motion executing downstream of a severed link, on a firmware (GRBL 1.1) that has no host-loss failsafe.** It is NOT a code defect in the disconnect handler and NOT a protocol bug. The host streams motion ahead of the head (required for smooth motion), the cable is pulled, and every pre-queued move runs to completion because (a) no stop can be transmitted over a dead cable and (b) GRBL never decides on its own to stop when the host vanishes.

### Where the ~20 seconds actually lives (ranked)

The burn duration is **motion duration of everything queued downstream of the host at the instant of the yank**, summed across three buffers. Ranked by contribution:

1. **GRBL's internal motion-planner block buffer (LARGEST contributor).** Stock GRBL 1.1 holds a ring of planned motion blocks (commonly ~15-16 blocks, build-dependent) SEPARATE from the serial RX buffer. These are fully parsed moves staged for execution. This is the buffer most responsible for multi-second continued motion, and it is invisible to the host -- LaserForge has zero visibility into planner depth (the streamer in `src/core/controllers/grbl/streamer.ts` models only the *serial* buffer, not the planner).

2. **The OS / USB-driver transmit (TX) queue (SECOND contributor).** `src/platform/web/web-serial.ts:124-126` -- `writer.write()` resolves when bytes are accepted into the OS/driver outbound queue, NOT when GRBL has received them. Crucially, `advanceStream` refills after every ack using **fire-and-forget** `void safeWrite(...)` (`src/ui/state/laser-line-handler.ts:179-180`), so the host keeps shoveling chunks toward the OS as fast as acks arrive. On Windows the driver TX buffer is typically several KB -- room for many more lines than GRBL's 120-byte RX window. Bytes sitting here at yank-time still feed GRBL for as long as the physical link survives the microseconds around the pull, and any already-handed-off bytes are downstream of the host's control.

3. **GRBL's serial RX buffer (SMALLEST contributor).** `src/core/controllers/grbl/streamer.ts:21` -- `DEFAULT_RX_BUFFER_BYTES = 120` (an 8-byte safety margin under GRBL's real 128-byte hardware RX buffer; this is a host-side flow-control choice, not GRBL's actual size). `step()` (`streamer.ts:97-132`) packs queued lines until 120 bytes are in flight. Real emitted cut lines are ~23-37 bytes each (`src/core/output/grbl-strategy.ts:53,59,61`), so the RX window alone holds only **~4-5 lines**. At the default cut speed that is only a few seconds -- the RX buffer by itself does NOT explain 20s.

### The arithmetic, honestly bounded

- Default cut speed: `LAYER_DEFAULTS.speed = 1500` mm/min = 25 mm/s (`src/core/scene/layer.ts:52`).
- RX buffer alone: ~4-5 lines. If those lines are short fill/cut segments, that is on the order of ~1-5 s -- not 20.
- To reach ~20 s you need the planner blocks and OS-queued lines on TOP of the RX window. ~15 planner blocks + several KB of OS-queued lines, at 25 mm/s over realistic segment lengths, lands in the multi-second-to-tens-of-seconds range. **~20s is consistent with this combined depth.**

**Honesty note (do not overstate):** The code does not let us compute an exact second-count -- planner depth and OS TX buffer size are not observable from LF2, and the burn time depends on the specific job's segment lengths and speeds. The defensible statement is: *the ~20s is dominated by GRBL planner blocks + OS TX-queued lines (with a small RX-buffer contribution), all executing as queued motion.* Any claim that pins it precisely to "the 120-byte buffer" (too small) or to serial transfer time (milliseconds) is wrong -- see Section 7.

---

## 4. Is the Laser ON During the Drain? (YES)

**Yes -- the laser fires at job power, not merely "armed at zero," during the buffered drain.** Mechanism, confirmed in the emitter:

- Preamble arms the laser at zero: `M3 S0` (`src/core/output/grbl-strategy.ts:38`). `M3` = constant-power laser mode; `M4` = dynamic-power mode for fills/raster (`grbl-strategy.ts:217-232`).
- The first cutting move asserts power: `G1 X.. Y.. F{feed} S{s}` where `s = round((power/100) * maxPowerS)` (`grbl-strategy.ts:59,27-29`). At default 30% power on a typical maxPowerS=1000 board, that is `S300`; the dimension's `S500` is illustrative of the same modal behavior.
- **S is MODAL.** Subsequent moves emit `G1 X.. Y..` with NO S word and inherit the last S (`grbl-strategy.ts:61`; verified pattern in `grbl-strategy.test.ts`). So every queued cutting move after the first burns at the active power until something changes it.

Therefore, if the cable is yanked after a cutting `S{s}` is buffered, the queued `G1` moves draining out of GRBL **all fire at that power**. Under `M3` (vector cut) the beam stays on even through corners. Under `M4` (fill) GRBL scales power with feed, so a stopped head goes dark -- but during continuous queued motion the beam is still on.

**What finally turns it off:** Only one of -- (a) a buffered `M5`/`S0` happening to be in the queue and executing (the postamble is `M5` then `G0 ... S0`, `grbl-strategy.ts:43`, but on a mid-job yank you almost never reach the postamble); or (b) motion simply ending when the planner queue empties. There is **no deliberate, host-driven laser-off** on a yank, because the host cannot transmit one. Documented residual: `DECISIONS.md:2069-2073` -- "GRBL does NOT halt... it discards the bad line and keeps executing the lines already in its ~120-byte RX buffer," and turning a currently-firing laser off requires a real-time hold/soft-reset that cannot be sent once the link is gone.

---

## 5. The FAILSAFE GAP (what does NOT exist)

Verified by reading the live `src/` and `electron/` trees (not just trusting prior greps):

- **No host-loss watchdog / deadman / heartbeat / keepalive.** Zero matches in `src/` or `electron/`. The streamer (`src/core/controllers/grbl/streamer.ts`) is a pure state machine with no timer; `inFlight`/`inFlightBytes` are tracked but never monitored for staleness. The only periodic timer is the 250 ms status poll (`src/ui/state/laser-store.ts:251-257`), which writes `?` and swallows failures (`.catch(() => undefined)`) -- it does NOT detect silence, validate that replies arrive, or trigger any halt.
- **No DTR/RTS line control.** No `setSignals`/`setControl` anywhere. `src/platform/web/web-serial.ts` never asserts modem control lines. This matters: the classic Arduino/GRBL hard-reset trick is to toggle DTR, which resets the MCU. LF2 does not do this, and a *physical yank* removes the wire anyway -- but its absence also means there is no DTR-reset failsafe even for soft drops.
- **No firmware-level loss-of-link detection in GRBL 1.1.** GRBL 1.1 executes queued planner moves regardless of serial link state once buffered. There is no built-in "host gone -> stop" behavior. (Confirmed against the documented behavior the codebase relies on; `DECISIONS.md` ADR-042 and the residual note both assume buffered motion continues.)
- **No software E-stop that works post-yank.** `RT_SOFT_RESET` exists and is correctly wired for the *user* Disconnect button (`laser-store.ts:273-283`) and for Stop (`laser-store.ts:419-425`), but none of these can reach a disconnected controller.
- **The only "failsafe" present is informational:** the `disconnect-during-job` safety banner (`src/ui/state/laser-safety-notice.ts:47-50`; `SafetyNoticeBanner` UI) telling the operator to use the physical E-stop. It is honest and correctly worded, but it is a message, not a stop.

**Verdict:** GRBL 1.1 + LaserForge 2.0 have **no host-loss failsafe.** The system's design explicitly accepts that buffered motion will continue after a yank and delegates the actual stop to the human + physical hardware.

---

## 6. The Honest Fix Space (prioritized)

> **Overriding truth for the operator:** For a PHYSICAL cable yank, **software alone cannot stop the machine.** No code change can transmit over a cable that is gone. Software can only *shrink* the burn window (by streaming less motion ahead) and *warn* you. Truly stopping on link-loss requires **firmware** (a GRBL host-loss watchdog, or a DTR-toggle reset on a wired-but-dropped link) or **hardware** (an E-stop / power cutoff you operate by hand).

### IMMEDIATE operational mitigation (do this now, zero code)
**[hardware]** Keep a hardware E-stop button or an accessible power switch (or a switched outlet / power strip) within arm's reach of the machine, and use THAT to stop a burn -- never the USB cable. Treat "yank the USB" as a non-stop. If your enclosure has a lid interlock, keep it wired. This is the only thing that reliably stops a runaway burn today.

### Code change that most reduces the window
**[software-reduces-window]** Lower the stream-ahead depth so far less motion is pre-queued downstream of the host at any instant. The single most effective knob is `DEFAULT_RX_BUFFER_BYTES` in `src/core/controllers/grbl/streamer.ts:21` (currently 120). Reducing it means fewer lines are ever in GRBL's RX buffer, so a yank leaves less queued there. Caveat #1: this does NOT touch GRBL's internal planner-block buffer or the OS TX queue, which (per Section 3) are the larger contributors -- so the window shrinks but does not vanish, and a "drip-feed" (one-line-ahead) sender can stutter motion / starve the planner on a real laser, which is its own safety/quality concern. Caveat #2: this is a safety-critical send-path change -- it needs tests for the failure mode and hardware verification on the Falcon A1 Pro before shipping. **It mitigates; it does not solve.**

### What software genuinely CANNOT do here
**[software-logical-only -- NONE that stop a physical yank]** There is no logical-only fix that stops the machine after the cable is physically gone. The existing `disconnectStopCommand()` soft-reset (`laser-store-helpers.ts:32-35`) is correct for the *user Disconnect* and *soft-drop-with-cable-still-attached* cases and should be kept, but it is inert for a true yank. (Optional hardening, still cannot stop a yank: have `advanceStream`'s fire-and-forget refill -- `laser-line-handler.ts:179-180` -- await/confirm rather than `void`, so the host stops shoveling into the OS TX queue the instant a write fails. This trims the OS-queue contribution to the window; it does not stop buffered motion.)

### Firmware path (true stop on link-loss)
**[firmware]** Add a host-loss watchdog in the GRBL/GrblHAL firmware: if no character is received for N milliseconds during motion, the controller issues its own feed-hold + spindle/laser-off. GrblHAL has plugin/real-time hooks that can implement this. This is the only *software-ish* mechanism that actually halts the laser when the host vanishes -- but it lives in firmware on the controller, not in LaserForge, and requires flashing + hardware verification.

### Hardware path (defense in depth)
**[hardware]** An independent hardware watchdog/relay that cuts laser power on loss of a heartbeat signal, and/or a lid interlock and E-stop in the laser power path. These stop the beam regardless of what firmware or host software does. For a diode laser that can ignite material, this is the recommended backstop.

**Recommended posture:** ship the window-reducing change *with* hardware verification, pursue the firmware watchdog as the real fix, and -- starting immediately -- operationally rely on a hardware E-stop, because that is the only thing that works today for a physical yank.

---

## 7. Ruled-Out / Not-the-Cause Appendix

These claims were evaluated and are **wrong or overstated**; do not let them mislead the diagnosis:

- **"The 120-byte RX buffer alone explains ~20s."** FALSE. ~120 bytes is ~4-5 cut lines (~23-37 B each), only a few seconds at 25 mm/s. The 20s comes from the GRBL *planner* block buffer + OS/driver TX queue ON TOP of the RX window (Section 3). The 120-byte figure is also a host-side margin, not GRBL's true 128-byte buffer.

- **"The buffer drains in ~10 ms at 115200 baud, so there's no real burn."** FALSE / category error. ~10 ms is the *serial transfer* time of 120 bytes. The burn is *motion execution* time of queued moves (seconds), an entirely different quantity. Serial speed is irrelevant to how long buffered motion takes to run.

- **"~20s = exactly 5 planner blocks / 20-30 buffered commands / a precise model."** UNSUPPORTED precision. Planner depth and OS TX size are not observable from LF2, and burn time depends on the job's segment lengths and speeds. The honest statement is a *range* consistent with ~20s, not a fixed block count. Both the "20-30 commands" and the "only 3-5 commands -> only 2-10s" framings overstate their certainty; the real answer combines RX + planner + OS queue.

- **"The disconnect event has 0.5-2s of latency, and 2-8 batches queue during that latency."** OVERSTATED. The `disconnect` event latency is OS-detection time, typically tens of milliseconds, not 0.5-2s. The real queuing is the *normal* ahead-streaming that exists at all times during a job, plus ack-driven refills (`laser-line-handler.ts:179-180`) reading whatever was already buffered -- not a function of a fictional 0.5-2s event delay. The underlying batching is real (ADR-042); the latency number is not.

- **"The `onClose` handler is synchronous and that race blocks an async stop."** NOT THE CAUSE. `onClose` (`laser-store.ts:241-249`) only does synchronous state cleanup and *deliberately attempts no write*. The async soft-reset lives in the separate user-`disconnect()` path. There is no thwarted async-stop race in the yank path; the design intentionally sends nothing because there is no link.

- **"`buildPortClosePatch` marking the streamer `disconnected` is what causes the burn."** NOT A CAUSE. That is a host-side UI/state change with zero effect on GRBL firmware motion. It correctly stops the host from sending MORE lines and raises the banner; it neither extends nor shortens the physical burn.

- **"Codex's `disconnectStopCommand()` (commit 9b9aa15) fixes the yank."** PARTIAL / NO for yank. It correctly sends `RT_SOFT_RESET` on *user-initiated* disconnect (cable still attached) and is the right call there. It does **not** fire on the `onClose` yank path, and a soft-reset cannot cross a severed cable regardless. It does not address the reported symptom.

- **"A WiFi/WebSocket transport is involved / has different semantics."** RULED OUT for this checkout. Direct `ls` of `electron/` shows NO `falcon-wifi/` directory (the CLAUDE.md description does not match this tree). The only transport wired into the app is Web Serial / USB (`src/platform/web/web-serial.ts` via `web-adapter.ts` `serial: webSerial`; Electron uses the same Web Serial path through the `select-serial-port` handler in `electron/main.ts`). No `WebSocket`/`net.Socket`/`dgram` exists in `src/` or `electron/`. The "Falcon"/"wifi" string hits are device-profile comments and test fixtures only. So the analysis above (USB yank, GRBL buffers, no host-loss failsafe) is the complete and correct picture for the live product.

---

### Verification provenance
All file paths cited are under `C:/Users/Asus/LaserForge-2.0`. The disabled LaserForge 1 tree at `C:/Users/Asus/LaserForge` (DO_NOT_USE) was not read or relied upon. Hardware behavior (exact planner depth, exact ~20s) is **Hardware verification needed** on the operator's Falcon A1 Pro before any send-path change is marked shipped.

---

## 8. Decision (2026-06-04): must work for ALL devices, or skip

Maintainer direction: any fix must apply to every supported GRBL device, not just the
Falcon. Applying that bar to the fix space in Section 6:

- **Firmware host-loss watchdog (GrblHAL / per-controller):** device- and firmware-specific
  (requires flashing a particular board; not all supported controllers can run it).
  **SKIP** - fails the all-devices bar.
- **Host-side stream-ahead reduction (`DEFAULT_RX_BUFFER_BYTES`):** device-agnostic, so it
  *meets* the bar, BUT it can only trim the small ~120-byte serial RX window (~1-3 s). It
  cannot shrink the controller's internal motion-planner buffer - the dominant reservoir -
  without deliberately starving it, which causes motion stutter / uneven burns on every
  device. Marginal safety gain for a safety-critical send-path change. **SKIP** (recommended;
  may revisit as an opt-in setting if hardware testing ever shows a clean win).
- **Stopping a PHYSICAL yank from host software:** impossible on ANY device - there is no link
  to transmit a stop over. Not buildable.

**Conclusion:** there is no device-agnostic *software* fix worth shipping for the physical
loss-of-link case. The device-agnostic safety that software CAN provide already exists and
works on any GRBL controller: the in-app **Stop** button issues `RT_SOFT_RESET` and the
**error/alarm** paths go terminal (P0-1, ADR-041), all while the link is alive; the
disconnect/write-failure **safety banner** (P0-3, P0-B) warns when it is not. The only
remaining gap - a true *physical* disconnect - is a hardware-layer problem identical on every
device, so the device-agnostic answer is operational: a **hardware E-stop / power cutoff /
interlock**, plus the existing warning. No host-software code change is taken for this report.
