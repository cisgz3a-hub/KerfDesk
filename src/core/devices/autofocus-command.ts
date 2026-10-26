// What the Auto-focus button may send (ADR-400 Amendments 1 and 2, audits
// 13-P1-1 and controller v3 D2).
//
// The command is one line from Machine Setup, a machine profile or a project
// file, and one press sends it with no Frame and no Start review. It must
// therefore be a focus routine, never a burn, an XY move or a settings write:
// the same rule the positioning-light commands follow (positioning-light.ts).
// The accepted forms are the ones machines document for focusing:
//   - a GRBL-family `$HZ` vendor macro or Z-only homing (`$HZ1` is Creality's
//     Falcon A1 Pro autofocus; grblHAL and FluidNC home Z alone with `$HZ`);
//   - a Z-only probe that alarms when it misses, `G38.2` or `G38.4`, with a Z
//     target and its own feed of at most MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN.
//     F is modal: without it GRBL probes at the feed the last job left set.
// `G30` is refused: it does not focus on any firmware KerfDesk drives.
// Every M-code is refused. Firmware M-codes switch the beam, air, fans and
// motors or change machine settings, and no machine KerfDesk knows documents
// one for focusing, so no list of "safe" codes could be trusted; a documented
// vendor focus form is added here with its source. Everything else is refused
// with its reason. Empty stays valid: it disables Auto-focus.

import type { ControllerCommandSet, ControllerKind } from './device-profile';

const FALCON_COMMAND_SET: ControllerCommandSet = 'creality-falcon-a1-pro';

export const MAX_AUTOFOCUS_COMMAND_LENGTH = 100;

/** The fastest feed an Auto-focus probe may touch at: KerfDesk's own Z and
 *  surface probes first touch at 150 mm/min (DEFAULT_Z_PROBE_PARAMS
 *  .seekFeedMmPerMin in core/controllers/grbl/probe.ts) before a slower
 *  re-touch. An Auto-focus probe touches once. */
export const MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN = 150;

// The beam, spindle, coolant/air, Marlin vacuum/blower, grblHAL/FluidNC outputs
// and fans (fan 0 can be a fan-wired laser): refused with the beam reason.
const BEAM_M_CODES: ReadonlySet<number> = new Set([
  3, 4, 5, 7, 8, 9, 10, 11, 62, 63, 64, 65, 66, 67, 68, 106, 107,
]);
// G38.2 and G38.4 alarm when they reach the target without a contact change;
// G38.3 and G38.5 stop there without an error, as a plain Z move would.
const ALARMING_PROBE_G_CODES: ReadonlySet<number> = new Set([38.2, 38.4]);
const SILENT_PROBE_G_CODES: ReadonlySet<number> = new Set([38.3, 38.5]);
const WORD_LINE_RE = /^(?:[A-Z][+-]?(?:\d+\.?\d*|\.\d+))+$/;
const WORD_RE = /([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/g;

const ACCEPTED_FORMS =
  'Auto-focus accepts one focus command: a vendor macro such as $HZ1, or a Z-only probe with its own feed such as G38.2 Z-10 F100.';
const PROBE_TARGET_REASON = 'A G38 probe needs a Z target, for example G38.2 Z-10 F100.';
const PROBE_FEED_MISSING_REASON =
  'A G38 probe needs its own feed, for example G38.2 Z-10 F100. Without F the controller probes at the speed the last job left set.';
const PROBE_FEED_RANGE_REASON = `A G38 probe feed must be above 0 and at most ${MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN} mm/min, the speed KerfDesk's own probes first touch at.`;
const SILENT_PROBE_REASON =
  'G38.3 and G38.5 stop without an error when they never touch, so a missed probe would end as a plain Z move. Use G38.2, which alarms when it reaches its target without touching.';
const G30_REASON =
  "G30 is not a focus command: on GRBL-family controllers it moves to a stored position, Marlin's moves the head by the probe's XY offset, and Smoothieware's returns to where it started (with a Z word it rewrites the Z coordinate instead). Use a probe such as G38.2 Z-10 F100.";
const M_CODE_REASON =
  'Auto-focus cannot send an M-code: M-codes switch the motors, outputs or machine settings, and no supported machine uses one to focus. Send it from the Console instead.';
const MOTION_REASON =
  'Auto-focus cannot move the head: G0-G3 moves and X, Y or rotary axis words are not focus commands.';
const BEAM_REASON =
  'Auto-focus cannot switch the laser, spindle or air (M3, M4, M5, M7-M9, M106/M107) or set power with S above 0.';
const SETTING_WRITE_REASON =
  'Auto-focus cannot write controller settings. Change settings in the Console or Machine Settings, where KerfDesk asks first.';

type Word = { readonly letter: string; readonly value: number };

/** The controller the command goes to: its firmware family and, when it has
 *  one, the vendor command contract it runs under. */
export type AutofocusController = {
  readonly kind: ControllerKind;
  readonly commandSet?: ControllerCommandSet | undefined;
};

/** Why `command` cannot be the Auto-focus command, or null. Without a
 *  controller only the controller-independent rules apply. */
export function autofocusCommandIssue(
  command: string,
  controller?: AutofocusController,
): string | null {
  const trimmed = command.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_AUTOFOCUS_COMMAND_LENGTH) {
    return `Auto-focus command must be at most ${MAX_AUTOFOCUS_COMMAND_LENGTH} characters.`;
  }
  if (/[^\x20-\x7e]/.test(trimmed)) {
    return 'Auto-focus command must be one line of plain ASCII text.';
  }
  const compact = trimmed.replaceAll(/[ \t]/g, '').toUpperCase();
  if (compact.startsWith('$')) return systemCommandIssue(compact, controller);
  if (!WORD_LINE_RE.test(compact)) return ACCEPTED_FORMS;
  const words = [...compact.matchAll(WORD_RE)].map(
    (match): Word => ({ letter: match[1] ?? '', value: Number(match[2]) }),
  );
  return wordsIssue(words);
}

/** The issue for a machine profile's own controller. A profile without a
 *  controller kind connects with the stock GRBL driver (select-controller-driver). */
export function profileAutofocusIssue(profile: {
  readonly autofocusCommand: string;
  readonly controllerKind?: ControllerKind | undefined;
  readonly controllerCommandSet?: ControllerCommandSet | undefined;
}): string | null {
  return autofocusCommandIssue(profile.autofocusCommand, {
    kind: profile.controllerKind ?? 'grbl-v1.1',
    commandSet: profile.controllerCommandSet,
  });
}

/** The project value KerfDesk keeps: a refused command is dropped (Auto-focus
 *  is then set up again), never trusted. The check here does not depend on the
 *  controller, so a later controller change cannot make Save rewrite the
 *  value; the button applies the controller's own rules before it sends. */
export function normalizeAutofocusCommand(value: unknown): string {
  return typeof value === 'string' && autofocusCommandIssue(value) === null ? value : '';
}

function systemCommandIssue(
  compact: string,
  controller: AutofocusController | undefined,
): string | null {
  if (compact.startsWith('$J=')) return MOTION_REASON;
  if (compact.includes('=')) return SETTING_WRITE_REASON;
  const home = /^\$HZ(\d*)$/.exec(compact);
  if (home === null) return ACCEPTED_FORMS;
  if (controller === undefined || controller.commandSet === FALCON_COMMAND_SET) return null;
  // grblHAL and FluidNC home Z alone with `$HZ`; a numbered `$HZ1` is
  // Creality's vendor macro. Stock GRBL enters its homing state on `$H`, then
  // answers a suffix it was not built for with error:3 and stays there until a
  // reset; Smoothieware's shell runs any `$H...` as a full homing cycle and
  // Marlin has no `$` commands (controller audit 2026-09-25 CG-9).
  if (controller.kind === 'grblhal' || controller.kind === 'fluidnc') {
    return home[1] === ''
      ? null
      : `${compact} is the Creality Falcon A1 Pro's autofocus macro. Choose the Falcon A1 Pro machine profile, or use $HZ to home Z on grblHAL and FluidNC.`;
  }
  if (controller.kind === 'grbl-v1.1') {
    return `Stock GRBL starts homing on ${compact} and then refuses it with error:3, which leaves the controller stuck until a reset. Choose the Falcon A1 Pro machine profile if this is a Falcon.`;
  }
  return `${compact} is a GRBL-family command; this controller does not run it as a focus command.`;
}

function wordsIssue(words: ReadonlyArray<Word>): string | null {
  const letters = words.map((word) => word.letter);
  if (new Set(letters).size !== letters.length) return ACCEPTED_FORMS;
  if (words.some((word) => /[XYABCUVW]/.test(word.letter))) return MOTION_REASON;
  if (words.some((word) => word.letter === 'S' && word.value !== 0)) return BEAM_REASON;
  const commands = words.filter((word) => word.letter === 'G' || word.letter === 'M');
  const [first] = commands;
  if (commands.length !== 1 || first === undefined || words[0] !== first) return ACCEPTED_FORMS;
  return first.letter === 'G' ? probeIssue(first.value, words) : mCodeIssue(first.value);
}

function probeIssue(code: number, words: ReadonlyArray<Word>): string | null {
  if (code >= 0 && code <= 3) return MOTION_REASON;
  // GRBL-family G30 goes to a stored position; Marlin 2.1.x shifts XY by the
  // probe offset and lifts; Smoothieware's returns to its start, or with Z
  // runs G92 (controller audit v3 D2-P3-4).
  if (code === 30) return G30_REASON;
  if (SILENT_PROBE_G_CODES.has(code)) return SILENT_PROBE_REASON;
  if (!ALARMING_PROBE_G_CODES.has(code)) return ACCEPTED_FORMS;
  const parameters = words.slice(1);
  if (parameters.some((word) => word.letter !== 'Z' && word.letter !== 'F')) return ACCEPTED_FORMS;
  if (!parameters.some((word) => word.letter === 'Z')) return PROBE_TARGET_REASON;
  // F is modal: an F-less probe runs at the last job's feed, capped only by
  // $112, and overruns contact by v^2/2a (controller audit v3 D2-P3-3).
  const feed = parameters.find((word) => word.letter === 'F');
  if (feed === undefined) return PROBE_FEED_MISSING_REASON;
  return feed.value > 0 && feed.value <= MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN
    ? null
    : PROBE_FEED_RANGE_REASON;
}

function mCodeIssue(code: number): string {
  return BEAM_M_CODES.has(Math.trunc(code)) ? BEAM_REASON : M_CODE_REASON;
}
