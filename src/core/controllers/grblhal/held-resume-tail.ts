// grblHAL builds before 20260928 can keep the tail of a held move (ADR-684).
//
// A hold that completes inside the last ~90 ms of the last planned block
// clears the step control, so segment preparation finishes that block and the
// planner discards it. Cycle start then finds no planner block and the
// controller goes Idle short of the block's end. The prepared segments stay in
// the segment buffer, each with its own laser PWM, and run when the next
// motion starts (grblHAL core issue #1024, fixed in Build 20260928 by
// 451a539c6). Core 04a5edcf (GRBL_BUILD 20231005, the Falcon A1 Pro's
// published build) has the same code; a simulator run on it fired the beam
// during the next Frame (live-loops audit LL1-P1-1).
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/changelog.md#L89-L95
// https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/state_machine.c#L485-L492
// https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/stepper.c#L408-L421

/** The first grblHAL build that keeps a held block until it has run. */
export const GRBLHAL_HELD_TAIL_FIX_BUILD = 20260928;

const VERSION_LINE = /^\[VER:\d+\.\d+[a-z]?\.(\d{8})[:\]]/;

export const HELD_RESUME_TAIL_MESSAGE =
  'Resume ended with the controller Idle before it moved again. grblHAL builds before 20260928 can keep the rest of the paused move and run it, at its laser power, when the next motion starts (grblHAL issue #1024), so the job’s last line may also be short. Reset the controller (Ctrl-X) before the next Frame, jog or job, and home it if it asks. A reset also ends the current Frame, so Frame the job again before Start. Any Frame, jog or job clears this warning, because it runs whatever was held.';

/** The build date a `$I` `[VER:` line reports, or null when none does. */
export function reportedGrblBuildDate(lines: ReadonlyArray<string>): number | null {
  for (const line of lines) {
    const match = VERSION_LINE.exec(line.trim());
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

/** Whether this grblHAL can be holding a paused move's tail: true unless its
 * `$I` reports a build with the fix. Not grblHAL: false. */
export function grblHalMayHoldResumeTail(args: {
  readonly grblHal: boolean;
  readonly buildInfoLines: ReadonlyArray<string>;
}): boolean {
  if (!args.grblHal) return false;
  const build = reportedGrblBuildDate(args.buildInfoLines);
  return build === null || build < GRBLHAL_HELD_TAIL_FIX_BUILD;
}
