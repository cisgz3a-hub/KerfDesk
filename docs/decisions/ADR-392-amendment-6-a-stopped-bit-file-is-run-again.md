## ADR-392 Amendment 6 - A stopped bit file is run again with the same bit (2026-10-28)

**Status:** Accepted. | **Date:** 2026-10-28
**Fixes:** rolling audit v5 J9-P3-1 (P2), confirmed by the auditor, an independent refuter and the
coordinator (`docs/audits/2026-10-27-rolling-v5/J9-fix-output.md`). The Frame-first contract
(PROJECT.md non-negotiable 21, ADR-565) is unchanged: Frame's existing Work Z requirement does the
refusing, and no new Start gate is added.

### Context

Amendment 5 ended a per-bit file's bit at the first Idle after an Abort, an alarm or a reset, with
the same end patch a completed file gets. Its Consequences say the X/Y origin then stays refused
"so re-running the same file keeps its X/Y zero". But the machine panel had one wording for every
end: "Bit 1 of 2 (…) has run. Change to bit 2, then Zero Z …". After an Abort part-way through
bit 1's file it told the operator the file had run and to move on to bit 2, which skips bit 1's
remaining paths. External runs keep no recovery record (ADR-630), so the file can only be run
again from its start. A file stopped by a rejected line (`errored`) got the same wording.

The end patch also kept the set only while later bits remained. A stopped last bit therefore ended
the set: no notice, and the X/Y hold was released before that file had run, although running it
again needs the same X/Y zero.

### Decision

1. **The set records whether the file finished.** `bitFileSequence` carries `finished`, true only
   when the streamer that ended was `done` (`bitFileRunEndPatch`,
   `src/ui/state/bit-file-sequence.ts`). Abort, an alarm, a reset (`cancelled`) and a rejected
   line (`errored`) leave it false. Work Z goes either way, as before.
2. **A stopped file holds the set, the last bit's too.** A file that did not finish keeps its set
   whatever its place in it, so Set and Reset origin and the XYZ corner probe stay refused until
   that file has run, or until **End bit sequence** or a new controller session ends the set. A
   finished file keeps the set only while later bits remain, as before.
3. **The panel says to run the file again.** For a file that did not finish, the machine panel
   reads: "Bit 1 of 2 (…) stopped before its file finished. Keep bit 1 in, Zero Z on the stock top
   or probe it, then run bit 1's file again from its start: Work Z from the stopped run no longer
   applies. The X/Y origin stays where it is until the last bit has run." It does not say "has
   run" or name the next bit. The X/Y refusal says the bit "stopped on this X/Y origin before its
   file finished", and that running that file again (and the later bits' files, when there are
   any) must cut on the same one. A finished file keeps the completed-file wording.

### Consequences

- After an Abort or alarm mid-file, the operator is led back to the same file with the same bit,
  re-zeroed, on the X/Y origin the earlier paths used. The next Frame still refuses until the new
  Z zero is set, as Amendment 5 left it.
- Running the file again repeats its earlier paths from the start. The panel says "from its
  start", and Frame and Start review the whole file as before.
- Tests:
  - `src/ui/gcode-inspector/external-run-bit-files.simulator.test.ts` (GRBL simulator, real
    external Start, `stopJob`, `unlockAlarm`): after Abort of bit 1 of 2 the notice says to run
    bit 1's file again and does not say "has run" or "Change to bit 2"; after Abort of bit 2 of 2
    the set holds with the re-run wording; a completed bit 1 keeps "has run. Change to bit 2".
  - `src/ui/state/bit-file-sequence.test.ts`: `done` moves the set on and ends it after the last
    bit; `cancelled` and `errored` hold it for a re-run, for bit 1 and for the last bit.
- Red check: with `main`'s `bit-file-sequence.ts`, the re-run and stopped-last-bit tests fail.
- Not hardware-tested.
