import type { ControllerKind } from '../devices/device-profile';
import { stripInlineComments } from '../gcode';
import { iterateLines } from '../util';

/** The controller family a generated laser program was emitted for. */
export type LaserSourceFamily = 'grbl-family' | 'marlin-inline' | 'marlin-fan' | 'smoothieware';

const FAMILY_LABELS: Record<Exclude<LaserSourceFamily, 'grbl-family'>, string> = {
  'marlin-inline': 'Marlin (inline laser mode)',
  'marlin-fan': 'Marlin (fan-controlled laser)',
  smoothieware: 'Smoothieware',
};

// Every native prelude the emitters write sits within the first lines of the
// program, before any motion: Smoothieware opens with its `fire off` shell
// command and M221 power modes, Marlin inline with `M5 I` / `M3 I`, and the
// fan dialect with M106 / M107 instead of per-move S words.
const DETECTION_LINE_LIMIT = 64;

/** Classify a program by its native prelude without parsing the whole text. */
export function detectLaserSourceFamily(sourceGcode: string): LaserSourceFamily {
  let inspected = 0;
  for (const raw of iterateLines(sourceGcode)) {
    const line = stripInlineComments(raw).toUpperCase();
    if (line === '') continue;
    const family = lineFamily(line);
    if (family !== null) return family;
    inspected += 1;
    if (inspected >= DETECTION_LINE_LIMIT) break;
  }
  return 'grbl-family';
}

function lineFamily(line: string): LaserSourceFamily | null {
  if (line === 'FIRE OFF' || /^M221\b/.test(line)) return 'smoothieware';
  if (/^M10[67]\b/.test(line)) return 'marlin-fan';
  // A bare I flag belongs to Marlin's laser mode commands only; GRBL carries
  // an I word solely as a numeric arc offset on G2/G3.
  if (/^M[345]\b.*\bI\b/.test(line)) return 'marlin-inline';
  return null;
}

/** Null when the transformer can read and re-emit the program faithfully. */
export function unsupportedLaserSourceMessage(family: LaserSourceFamily): string | null {
  if (family === 'grbl-family') return null;
  return `This job was generated for ${FAMILY_LABELS[family]}. Painted second passes currently support programs generated for GRBL, grblHAL and FluidNC.`;
}

/** Profiles whose generated programs the transformer accepts; the UI uses this
 * to withhold the darkening offer instead of leading to a refusal. */
export function laserSecondPassSupportsController(kind: ControllerKind | undefined): boolean {
  return kind === undefined || kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc';
}
