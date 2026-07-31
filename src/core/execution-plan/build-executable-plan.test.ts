import { describe, expect, it } from 'vitest';
import { EXECUTABLE_PLAN_CORPUS } from '../../__fixtures__/executable-plan-corpus';
import { buildExecutablePlan } from './build-executable-plan';
import { serializeExecutablePlan } from './serialize-executable-plan';

describe('buildExecutablePlan adversarial corpus', () => {
  for (const fixture of EXECUTABLE_PLAN_CORPUS) {
    it(fixture.name, () => {
      const result = buildExecutablePlan(fixture.gcode, {
        machineKind: fixture.machineKind,
        controller: fixture.controller,
      });

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.plan.motions.map((motion) => motion.intent)).toEqual(fixture.expected.intents);
      expect(result.plan.motions.map((motion) => motion.mode)).toEqual(fixture.expected.modes);
      expect(result.plan.terminal.positionMm).toEqual(fixture.expected.finalPosition);
      expect(result.plan.terminal.programEnded).toBe(fixture.expected.programEnded);
      expect(result.plan.source.lineEnding).toBe(fixture.expected.lineEnding);
      expect(result.plan.source.utf8ByteLength).toBe(
        new TextEncoder().encode(fixture.gcode).length,
      );
      expect(serializeExecutablePlan(result.plan)).toBe(fixture.gcode);

      const second = buildExecutablePlan(fixture.gcode, {
        machineKind: fixture.machineKind,
        controller: fixture.controller,
      });
      expect(second).toEqual(result);
    });
  }

  it('reports empty output as unavailable', () => {
    expect(buildExecutablePlan('', { machineKind: 'laser', controller: 'grbl' })).toEqual({
      kind: 'unavailable',
      reason: 'no-program',
    });
  });

  it('fails closed when the Inspector skips invalid motion', () => {
    const result = buildExecutablePlan('G21\nG90\nG2 X10 Y0\n', {
      machineKind: 'cnc',
      controller: 'grbl-cnc',
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.issues[0]?.code).toBe('skipped-motion');
  });
});
