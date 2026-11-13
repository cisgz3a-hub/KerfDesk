## ADR-215 Amendment 3 - CNC recovery keeps the Work Z record a reset voided (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13
**Fixes:** CNC audit v3 N5-P1-1 (P1), reproduced by the auditor on the kinematic GRBL simulator
and by the refuter through the rendered `CncPassRecoveryWizard`
(`docs/audits/2026-11-13-cnc-v3/N5-cnc-machine-run.md`). Amends Amendment 2 (rolling audit v4
H3-P1-1) and ADR-215 decision 2 (retained position).

### Context

Amendment 2 made recovery refuse unless Work Z was set for the recovery program's own first bit,
but it passed whenever there was no Work Z record at all (`cncRecoveryStartBitIssue` returned
null on null evidence). Every controller reset voids that record
(`originUnknownAfterControllerReset`), and an Abort is a reset, so after an Abort the check never
ran.

At a bit-change hold the operator zeroes the new bit with Zero Z, which writes `G54 G92 Z0`, or
with the touch plate, which writes `G10 L20 P0`. Stock GRBL and FluidNC clear G92 at the Abort's
soft reset; grblHAL keeps it (`gcode.c:787`); a G54 survives everywhere. So with a Start zero in
G54 and the hold zeroed with Zero Z, the reset put the work offset back to the one archived at
Start, and "Position retained" (decision 2) passed. The repros:

- Abort at the V-bit hold: the default pass was the end mill's pocket (Amendment 4), and the V-bit
  recut 112 pocket lines on the end mill's zero, gouging the floor up to 2.25 mm.
- Abort at a 1/4" hold: the 1/8" passes ran with the 1/4" bit, 1.81 mm too deep.
- Continue, a plain Pause, then Abort: the 1/4" operation recut 1.81 mm too deep.
- A probe-zeroed hold refused "retained" (its G54 moved), but "re-zeroed" ran the previous bit's
  passes with the new bit.

The only warning, "No work zero is set", appears word for word in every recovery after an Abort,
the safe ones included, and names neither bit nor zero.

### Decision

1. **A reset keeps what it voided.** When a reset voids a current Work Z record, the store keeps
   it as `workZBeforeReset` (`src/ui/state/work-z-before-reset.ts`): the record (bit and source),
   how it was set (Zero Z is `g92`; the probe and the controller read-back are a `work-offset`),
   whether the reset cleared that G92 (yes unless the active or detected controller is grblHAL;
   unknown firmware counts as clearing), and the reference epoch the reset left. It is valid only
   while that epoch stands, so a bit-change hold, homing, a reconnect or a console offset change
   voids it. Consecutive resets carry it forward.
2. **Recovery reads it** (`src/ui/laser/cnc-recovery-work-z.ts`), for both position paths and both
   recovery flows:
   - a live record is checked as in Amendment 2;
   - a zero the controller kept is checked against the recovery's first bit the same way, and a
     mismatch refuses;
   - a G92 the reset cleared refuses: "The controller reset when the job stopped, and the reset
     cleared the Zero Z (G92) set for … Load …, choose it under Bit in the spindle …, then touch it
     to the stock top and Zero Z, or probe, before starting recovery." Zeroing again clears it;
   - no record at all, once the run had reached a bit change (the acknowledged lines or the next
     line hold a tool-change M0), refuses: the bit in the spindle and its zero are unknown. Before
     any bit change the no-work-zero warning stands, as before.
   These are recovery refusals, made before the claim and before any controller write, not
   ordinary Start policy gates (ADR-565, ADR-228).
3. **"Position retained" needs the zero too.** The retained check refuses a G92 the reset cleared
   ("the work offset now matches the run's start only because that zero is gone") and a missing
   record after a bit change. The wizard disables the option with that reason, and the wire-
   boundary re-check uses the same function.
4. **The confirmation names the bits.** "START CNC PASS RECOVERY?" lists "Recovery starts with:",
   "Bit in the spindle:" and "Z zero on record:" (which bit, set by Zero Z (G92), the touch-plate
   probe or the controller read-back, and whether the controller kept it through the reset).
5. **The generic warning says what is true.** Where the controller kept the zero, the recovery
   warnings replace "No work zero is set" with a note naming the zero and its bit.

### Consequences

- grblHAL keeps a hold's G92 through the reset, so its re-zeroed recovery runs on the kept zero
  after the bit check. Its retained path is still refused by the work-offset comparison, as before.
- A run that never reached a bit change and has no record behaves as before.
- Regression tests: `src/ui/laser/cnc-recovery-after-reset.simulator.test.tsx` (Abort at a hold
  zeroed with Zero Z and with the probe, on the GRBL simulator through the real rail, Frame, Start
  and recovery flow) and `src/ui/state/work-z-before-reset.test.ts`. Both simulator cases fail on
  main.
- Not hardware-tested.
