import { describe, expect, it } from 'vitest';
import { EXECUTABLE_PLAN_CORPUS } from '../../__fixtures__/executable-plan-corpus';
import { buildExecutablePlan, type ExecutablePlanV1 } from '../../core/execution-plan';
import { verifyExecutablePlanParity } from './executable-plan-parity';

describe('verifyExecutablePlanParity', () => {
  for (const fixture of EXECUTABLE_PLAN_CORPUS) {
    it(`accepts ${fixture.name}`, () => {
      const built = buildExecutablePlan(fixture.gcode, {
        machineKind: fixture.machineKind,
        controller: fixture.controller,
      });
      expect(built.kind).toBe('ok');
      if (built.kind !== 'ok') return;

      const parity = verifyExecutablePlanParity(built.plan, fixture.gcode, {
        deterministicRebuild: true,
      });
      expect(parity.ok, parity.checks.map((check) => check.detail).join('\n')).toBe(true);
      expect(parity.checks.every((check) => check.ok)).toBe(true);
    });
  }

  it('leaves the second full build out of the default check set', () => {
    const fixture = EXECUTABLE_PLAN_CORPUS[0];
    if (fixture === undefined) throw new Error('corpus is empty');
    const built = buildExecutablePlan(fixture.gcode, {
      machineKind: fixture.machineKind,
      controller: fixture.controller,
    });
    if (built.kind !== 'ok') throw new Error('fixture did not build');

    const lean = verifyExecutablePlanParity(built.plan, fixture.gcode);
    const full = verifyExecutablePlanParity(built.plan, fixture.gcode, {
      deterministicRebuild: true,
    });

    expect(lean.ok).toBe(true);
    expect(lean.checks.some((check) => check.name === 'deterministic-rebuild')).toBe(false);
    expect(full.checks.some((check) => check.name === 'deterministic-rebuild')).toBe(true);
  });

  it('detects a lexical carrier change', () => {
    const fixture = EXECUTABLE_PLAN_CORPUS[0];
    if (fixture === undefined) throw new Error('corpus is empty');
    const built = buildExecutablePlan(fixture.gcode, {
      machineKind: fixture.machineKind,
      controller: fixture.controller,
    });
    if (built.kind !== 'ok') throw new Error('fixture did not build');
    const tampered: ExecutablePlanV1 = {
      ...built.plan,
      compatibility: { ...built.plan.compatibility, exactProgram: `${fixture.gcode}; changed` },
    };

    const parity = verifyExecutablePlanParity(tampered, fixture.gcode);

    expect(parity.ok).toBe(false);
    expect(parity.checks.find((check) => check.name === 'byte-exact-serialization')?.ok).toBe(
      false,
    );
  });

  it('detects a semantic endpoint change', () => {
    const fixture = EXECUTABLE_PLAN_CORPUS[0];
    if (fixture === undefined) throw new Error('corpus is empty');
    const built = buildExecutablePlan(fixture.gcode, {
      machineKind: fixture.machineKind,
      controller: fixture.controller,
    });
    if (built.kind !== 'ok') throw new Error('fixture did not build');
    const first = built.plan.motions[0];
    if (first === undefined) throw new Error('fixture has no motions');
    const firstEnd = first.pointsMm.at(-1);
    if (firstEnd === undefined) throw new Error('fixture motion has no endpoint');
    const tampered: ExecutablePlanV1 = {
      ...built.plan,
      motions: [
        {
          ...first,
          pointsMm: [...first.pointsMm.slice(0, -1), { ...firstEnd, x: firstEnd.x + 1 }],
        },
        ...built.plan.motions.slice(1),
      ],
    };

    const parity = verifyExecutablePlanParity(tampered, fixture.gcode);

    expect(parity.ok).toBe(false);
    expect(parity.checks.find((check) => check.name === 'clean-room-endpoint-sequence')?.ok).toBe(
      false,
    );
  });
});
