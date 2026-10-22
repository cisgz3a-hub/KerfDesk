// program-stops — what the Run review says about a program's M0 and M1
// (ADR-630 Amendment 5, controller audit v4 E4-P2-3). An external run sends
// both unchanged, so any hold is the controller's own. M0 holds on every
// controller. M1 is an optional stop: stock GRBL and FluidNC take it and do
// nothing, so the program runs straight on, while grblHAL holds unless its
// optional stop is turned off:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L251
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L633-L636
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c#L1826-L1827

import type { ControllerKind } from '../devices';

const IGNORES_M1: Partial<Record<ControllerKind, string>> = {
  'grbl-v1.1': 'Stock GRBL',
  fluidnc: 'FluidNC',
};

const GRBLHAL_SKIPS_M1 = ' grblHAL skips M1 while optional stop is turned off on the controller.';

/** The M0/M1 warnings for `kind`; an absent kind is a legacy GRBL caller. */
export function programStopWarnings(
  m: ReadonlySet<number>,
  kind: ControllerKind = 'grbl-v1.1',
): ReadonlyArray<string> {
  const ignoredBy = IGNORES_M1[kind];
  const optional = m.has(1);
  const holds = [m.has(0) ? 'M0' : null, optional && ignoredBy === undefined ? 'M1' : null].filter(
    (code) => code !== null,
  );
  const warnings: string[] = [];
  if (holds.length > 0) {
    warnings.push(
      `The program stops with ${holds.join(' or ')}. The controller holds there until the machine's own cycle start is pressed; KerfDesk's Resume does not release a stop the program asked for.` +
        (kind === 'grblhal' && optional ? GRBLHAL_SKIPS_M1 : ''),
    );
  }
  if (optional && ignoredBy !== undefined) {
    warnings.push(
      `The program asks for an optional stop (M1), which ${ignoredBy} ignores: the program does not stop there and runs straight on. Use M0 where it must stop.`,
    );
  }
  return warnings;
}
