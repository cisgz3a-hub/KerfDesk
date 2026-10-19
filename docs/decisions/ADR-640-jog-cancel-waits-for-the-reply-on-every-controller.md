## ADR-640 - Jog cancel waits for the reply on every controller (2026-10-19)

**Status:** Accepted. Amends ADR-375 finding 6 (M-6): the wait before the jog-cancel byte applies
to every driver, not only grblHAL. | **Date:** 2026-10-19

### Context

The maintainer's Falcon A1 sometimes stopped working after quick presses of a jog arrow, with a
red message asking for a reconnect. KerfDesk has no Falcon A1 profile, and a Falcon set up with the
Falcon-compatible profile connects with the stock GRBL driver. That driver has the jog-cancel byte,
so pressing an arrow for 250 ms starts a hold jog toward the travel edge, and letting go sends
`0x85`.

Creality's Falcon firmware is grblHAL-based: an A1 Pro reports grblHAL's `$398` planner setting.
grblHAL answers `0x85`, in any state, by discarding every line it has received but not parsed, and
never answers those lines
([protocol.c L896-L899](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899)).
ADR-375 made Cancel wait for owed replies before the byte, but only on the grblHAL driver. grblHAL
greets as "Grbl 1.1f" at COMPATIBILITY_LEVEL 1 and up (audit HF-8), so the banner does not reveal
it. On the GRBL driver, a release that landed just after the `$J=` went out discarded that line. Its
`ok` never came, Cancel gave up after 8 s with "Cancel is waiting for the previous motion command
acknowledgement. Reconnect if the controller does not respond", and the jog owner stayed.

That owner could not be cleared. The automatic release needs every owed reply settled. Disconnect
and Connect are locked while any motion owner exists, so the message asked for a reconnect the
operator could not perform, and only ABORT MOTION, a soft reset, got out. The GRBL simulator with
`jogCancelFlushesInput` reproduces both halves through the real JogPad, with that exact message.
Which profile the reporting machine used was not checked.

### Decision

1. **Every driver with a jog-cancel byte waits for the reply.** Cancel waits for the last line to
   leave the transport (within the 8 s cancel bound), then at most 250 ms for every owed reply, and
   then writes `0x85`, on stock GRBL, grblHAL and FluidNC alike. Stock GRBL and FluidNC act on the
   byte only while jogging, which they enter when they parse the `$J=`
   ([serial.c L159-L162](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162)),
   so a byte that overtook the line was ignored there anyway and the jog stopped only on the
   re-send after a fresh Jog report. The `jogCancelDropsUnparsedLines` driver flag is removed,
   because no driver kind can promise the byte flushes nothing. The Falcon vendor command set, which
   has no jog-cancel byte, is unchanged.
2. **A missing reply no longer locks the connection.** When a cancelled motion owner has no Cancel
   settling it, still owes a reply, and the controller reports Idle, Disconnect and Connect stay
   available (`motionOwnerAwaitsMissingReply`). The owner itself stays, as before, because the
   reply may still arrive, and only a new serial session proves it will not; a reconnect already
   resolves an ambiguous reply ledger elsewhere (laser-safe-write). While the controller reports
   motion, the lock stays and Cancel and ABORT MOTION remain the controls.
3. **The message says what to do.** Cancel's failure now reads "The controller did not answer the
   last motion command within 8 seconds. Once the machine has stopped, Disconnect and connect again
   to clear it; use ABORT MOTION to stop it now."

### Alternatives

- **Detect grblHAL behind a GRBL banner and switch only then.** The banner does not reveal it, and
  probing for grblHAL-only commands would add traffic to every connect for a wait that costs stock
  GRBL nothing.
- **Release the owner in place by proving the reply was dropped.** A line with visible output, such
  as `$G`, written after the cancel would prove that every older unanswered line was discarded,
  because replies come in order. That changes the shared acknowledgement ledger that job streaming
  also uses, so it is left for a separate decision.
- **Add a Falcon A1 profile on the vendor command set.** That would avoid `0x85` on that machine,
  but it would remove the hold jog and still leave other grblHAL boards on GRBL profiles exposed.

### Consequences

- On every GRBL-family controller, a release or Cancel writes `0x85` after the reply to the line
  just sent, at most 250 ms after that line left the transport. On an idle controller this is a
  serial round trip.
- After a lost reply, the operator can disconnect and reconnect without ABORT MOTION. On GRBL-family
  controllers Disconnect still sends its soft reset, so a work origin set with G92 is cleared, and a
  machine with homing enabled starts locked in Alarm.
- No new refusal. Not seen on hardware: the evidence is the operator's report and the simulator.

### Verification

`src/ui/laser/JogPad.hold-release-flush.test.tsx` replays the report through the real JogPad: a
Falcon-compatible profile against a flushing firmware, released just after the hold jog went out.
`src/ui/state/laser-motion-release.test.ts` runs the grblHAL cancel case against a board that greets
as GRBL, checks that a Cancel which never gets its reply leaves Disconnect to clear the owner, and
pins when `motionOwnerAwaitsMissingReply` holds. `src/ui/laser/ControllerConnectionControls.test.ts`
and `src/core/controllers/grbl-family-drivers.test.ts` pin the connection controls and the shared
jog-cancel byte.
