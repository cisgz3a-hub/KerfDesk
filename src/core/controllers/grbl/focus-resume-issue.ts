import { scanGcodeWords, stripInlineComments } from '../../gcode/word-scan';

const FOCUS_MARKER =
  /(?:^|\n)\s*; Focus Test Z offset -?\d+(?:\.\d+)? mm from starting focus(?:\r?\n|$)/;

/** The sealed artifact owns this evidence, not the currently edited project.
 * A zero-only selection has the marker but emits no relative Z displacement.
 * For displaced samples even restart at line 1 cannot recover the old datum.
 */
export function focusResumeIssue(gcode: string): string | null {
  if (!FOCUS_MARKER.test(gcode) || !hasRelativeZMotion(gcode)) return null;
  return 'Focus Test recovery cannot reconstruct the original starting Z focus after interruption, including restart from line 1. Restore the physical starting focus, then review the whole job through ordinary Frame and Start.';
}

function hasRelativeZMotion(gcode: string): boolean {
  let relative = false;
  let motion = false;
  for (const line of gcode.split('\n')) {
    const words = scanGcodeWords(stripInlineComments(line));
    const codes = words.filter((word) => word.letter === 'G').map((word) => word.value);
    for (const code of codes) {
      if (code === 90 || code === 91) relative = code === 91;
      if (code >= 0 && code <= 3) motion = true;
      if (code === 80) motion = false;
    }
    // Coordinate assignment is not a displacement, even with modal G1 active.
    if (codes.includes(92)) continue;
    if (relative && motion && words.some((word) => word.letter === 'Z' && word.value !== 0)) {
      return true;
    }
  }
  return false;
}
