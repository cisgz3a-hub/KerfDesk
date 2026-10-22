import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { reviewExternalProgram } from './external-program-review';
import { externalProgramBaseline, normalizeExternalProgram } from './normalize-external-program';

// Controller audit v4 E4-P2-3 (ADR-630 Amendment 5): stock GRBL and FluidNC
// ignore M1, so the review must not promise a hold there; grblHAL holds.

const HOLD =
  "The controller holds there until the machine's own cycle start is pressed; KerfDesk's Resume does not release a stop the program asked for.";

function warnings(file: string, kind?: ControllerKind): ReadonlyArray<string> {
  const normalized = normalizeExternalProgram(
    file,
    externalProgramBaseline(kind ?? 'grbl-v1.1'),
    kind,
  );
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const { gcode } = normalized.program;
  const model = buildGcodeRenderModel(gcode, { machineKind: 'laser' });
  if (model.kind !== 'ok') throw new Error(model.reason);
  const context = { machineKind: 'laser' as const, laserMaxPowerS: 1000 };
  return reviewExternalProgram(
    gcode,
    model.model,
    kind === undefined ? context : { ...context, controllerKind: kind },
  ).warnings;
}

const STOPS = (stop: string) => `G0 X0 Y0\nG1 X5 F100\n${stop}\nG1 X10\nM5\n`;

describe('program stops in the Run review (ADR-630 Amendment 5)', () => {
  it.each([
    ['grbl-v1.1', 'Stock GRBL'],
    ['fluidnc', 'FluidNC'],
  ] as const)('says %s runs straight through M1', (kind, name) => {
    const found = warnings(STOPS('M1'), kind);
    expect(found).toContain(
      `The program asks for an optional stop (M1), which ${name} ignores: the program does not stop there and runs straight on. Use M0 where it must stop.`,
    );
    expect(found.join('\n')).not.toContain('holds there');
  });

  it('reads M01 as M1, and an absent kind as a legacy GRBL caller', () => {
    expect(warnings(STOPS('M01')).join('\n')).toContain('which Stock GRBL ignores');
  });

  it('says grblHAL holds at M1 unless optional stop is turned off', () => {
    expect(warnings(STOPS('M1'), 'grblhal')).toContain(
      `The program stops with M1. ${HOLD} grblHAL skips M1 while optional stop is turned off on the controller.`,
    );
  });

  // Marlin's reader names its own M0/M1 lines (marlin-program-reader.ts).
  it.each(['grbl-v1.1', 'grblhal', 'fluidnc', 'smoothieware'] as const)(
    'says %s holds at M0',
    (kind) => {
      expect(warnings(STOPS('M0'), kind)).toContain(`The program stops with M0. ${HOLD}`);
    },
  );

  it('names the hold and the ignored stop apart when a FluidNC program has both', () => {
    const found = warnings(`${STOPS('M0')}${STOPS('M1')}`, 'fluidnc');
    expect(found).toContain(`The program stops with M0. ${HOLD}`);
    expect(found.join('\n')).toContain('which FluidNC ignores');
  });

  // Only the GRBL family was re-read for the audit; Smoothieware keeps the
  // wording it had.
  it('keeps the earlier wording where M1 is not known to be ignored', () => {
    expect(warnings(`${STOPS('M0')}${STOPS('M1')}`, 'grblhal')[0]).toMatch(
      /^The program stops with M0 or M1\./,
    );
    expect(warnings(STOPS('M1'), 'smoothieware')).toContain(`The program stops with M1. ${HOLD}`);
  });

  it('says nothing for a program without M0 or M1', () => {
    for (const end of ['M30', 'M10']) {
      const found = warnings(STOPS(end), 'fluidnc').join('\n');
      expect(found).not.toContain('stops with');
      expect(found).not.toContain('optional stop');
    }
  });
});
