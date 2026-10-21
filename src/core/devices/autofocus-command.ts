// What the Auto-focus button may send (ADR-400 Amendment 1, audit 13-P1-1).
//
// The command is one line from Machine Setup, a machine profile or a project
// file, and one press sends it with no Frame and no Start review. It must
// therefore be a focus routine, never a burn, an XY move or a settings write:
// the same rule the positioning-light commands follow (positioning-light.ts).
// The accepted forms are the ones machines document for focusing:
//   - a GRBL-family `$HZ` vendor macro or Z-only homing (`$HZ1` is Creality's
//     Falcon A1 Pro autofocus; grblHAL and FluidNC home Z alone with `$HZ`);
//   - a Z-only probe, `G38.2`-`G38.5` with a Z target and an optional feed;
//   - Marlin's and Smoothieware's single Z probe `G30` at the current XY.
// Every M-code is refused. Firmware M-codes switch the beam, air, fans and
// motors or change machine settings, and no machine KerfDesk knows documents
// one for focusing, so no list of "safe" codes could be trusted; a documented
// vendor focus form is added here with its source. Everything else is refused
// with its reason. Empty stays valid: it disables Auto-focus.

import type { ControllerCommandSet, ControllerKind } from './device-profile';

const FALCON_COMMAND_SET: ControllerCommandSet = 'creality-falcon-a1-pro';

export const MAX_AUTOFOCUS_COMMAND_LENGTH = 100;

// The beam, spindle, coolant/air, Marlin vacuum/blower, grblHAL/FluidNC outputs
// and fans (fan 0 can be a fan-wired laser): refused with the beam reason.
const BEAM_M_CODES: ReadonlySet<number> = new Set([
  3, 4, 5, 7, 8, 9, 10, 11, 62, 63, 64, 65, 66, 67, 68, 106, 107,
]);
const PROBE_G_CODES: ReadonlySet<number> = new Set([38.2, 38.3, 38.4, 38.5]);
const WORD_LINE_RE = /^(?:[A-Z][+-]?(?:\d+\.?\d*|\.\d+))+$/;
const WORD_RE = /([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/g;

const ACCEPTED_FORMS =
  'Auto-focus accepts one focus command: a vendor macro such as $HZ1, a Z-only probe such as G38.2 Z-10 F100, or Marlin or Smoothieware G30.';
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
  return wordsIssue(words, controller?.kind);
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

function wordsIssue(words: ReadonlyArray<Word>, kind: ControllerKind | undefined): string | null {
  const letters = words.map((word) => word.letter);
  if (new Set(letters).size !== letters.length) return ACCEPTED_FORMS;
  if (words.some((word) => /[XYABCUVW]/.test(word.letter))) return MOTION_REASON;
  if (words.some((word) => word.letter === 'S' && word.value !== 0)) return BEAM_REASON;
  const commands = words.filter((word) => word.letter === 'G' || word.letter === 'M');
  const [first] = commands;
  if (commands.length !== 1 || first === undefined || words[0] !== first) return ACCEPTED_FORMS;
  return first.letter === 'G' ? probeIssue(first.value, words, kind) : mCodeIssue(first.value);
}

function probeIssue(
  code: number,
  words: ReadonlyArray<Word>,
  kind: ControllerKind | undefined,
): string | null {
  if (code >= 0 && code <= 3) return MOTION_REASON;
  const parameters = words.slice(1);
  if (parameters.some((word) => word.letter !== 'Z' && word.letter !== 'F')) return ACCEPTED_FORMS;
  if (parameters.some((word) => word.letter === 'F' && !(word.value > 0))) return ACCEPTED_FORMS;
  if (PROBE_G_CODES.has(code)) {
    return parameters.some((word) => word.letter === 'Z')
      ? null
      : 'A G38 probe needs a Z target, for example G38.2 Z-10 F100.';
  }
  if (code !== 30) return ACCEPTED_FORMS;
  // On GRBL-family firmware G30 is "go to the stored G30 position", an XY move.
  return kind === undefined || kind === 'marlin' || kind === 'smoothieware'
    ? null
    : 'On GRBL-family controllers G30 moves to a stored position; it is not a focus probe.';
}

function mCodeIssue(code: number): string {
  return BEAM_M_CODES.has(Math.trunc(code)) ? BEAM_REASON : M_CODE_REASON;
}
