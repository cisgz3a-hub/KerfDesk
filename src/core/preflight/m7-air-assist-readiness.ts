import type { GrblBuildInfo } from '../controllers/grbl/build-info';

export type M7AirAssistReadiness =
  | { readonly kind: 'not-required' }
  | { readonly kind: 'supported' }
  | { readonly kind: 'unknown'; readonly message: string }
  | { readonly kind: 'unsupported'; readonly message: string };

export const M7_AIR_ASSIST_UNSUPPORTED_MESSAGE =
  'This job uses M7, but the current stock-GRBL build reports no M7 mist-coolant support ([OPT] does not include M). Select M8/None for laser air assist or flood/none for CNC coolant, or install firmware compiled with ENABLE_M7.';

export const M7_AIR_ASSIST_UNVERIFIED_MESSAGE =
  'This job uses M7, but KerfDesk could not verify M7 support from a current stock-GRBL $I response. Confirm that this controller accepts M7 before running; unsupported firmware rejects the command and interrupts the job.';

/**
 * Detect an M7 word in executable G-code. Comments are removed first, and
 * numeric word parsing distinguishes M7/M07/M7.0 from M70. Numbered and
 * combined blocks remain visible (for example `N10 G1 X5 M7`).
 */
export function gcodeUsesM7(gcode: string): boolean {
  return gcode.split(/\r?\n/).some((line) => executableWords(line).some(isM7Word));
}

export function evaluateM7AirAssistReadiness(
  gcode: string,
  buildInfo: GrblBuildInfo | null,
  buildInfoIsCurrent: boolean,
): M7AirAssistReadiness {
  if (!gcodeUsesM7(gcode)) return { kind: 'not-required' };
  if (!buildInfoIsCurrent || buildInfo === null) {
    return { kind: 'unknown', message: M7_AIR_ASSIST_UNVERIFIED_MESSAGE };
  }
  return buildInfo.optionCodes.includes('M')
    ? { kind: 'supported' }
    : { kind: 'unsupported', message: M7_AIR_ASSIST_UNSUPPORTED_MESSAGE };
}

function executableWords(line: string): ReadonlyArray<string> {
  let executable = '';
  let parenthesisDepth = 0;
  for (const character of line) {
    if (character === ';' && parenthesisDepth === 0) break;
    if (character === '(') {
      parenthesisDepth += 1;
      continue;
    }
    if (character === ')' && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
      continue;
    }
    if (parenthesisDepth === 0) executable += character;
  }
  // GRBL removes ASCII whitespace before parsing words, so `M 7`, `M\t07.0`,
  // and `M(comment)7` are the same executable word as `M7`. Normalize only
  // after comments have been removed so comment text cannot create a command.
  return (
    executable.replace(/[\t\n\v\f\r ]+/g, '').match(/[A-Za-z][+-]?(?:\d+(?:\.\d*)?|\.\d+)/g) ?? []
  );
}

function isM7Word(word: string): boolean {
  return word[0]?.toUpperCase() === 'M' && Number(word.slice(1)) === 7;
}
