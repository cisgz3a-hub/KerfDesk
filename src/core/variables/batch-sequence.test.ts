import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA, type ProjectVariableData } from '../scene';
import { planVariableBatchSequence } from './batch-sequence';

describe('planVariableBatchSequence', () => {
  it('binds each ordered slot to the current sequence value before advancing', () => {
    const variables = productionData();

    const plan = planVariableBatchSequence(variables, ['first', 'second', 'third']);

    expect(plan.slots).toEqual([
      { slotIndex: 0, recordIndex: 2, serialValue: 11 },
      { slotIndex: 1, recordIndex: 1, serialValue: 13 },
      { slotIndex: 2, recordIndex: 3, serialValue: 11 },
    ]);
    expect(plan.nextVariables).toMatchObject({ recordIndex: 2, serialValue: 13 });
  });

  it('is deterministic and does not retain or inspect seed geometry', () => {
    const staleGeometry = Object.freeze([
      Object.freeze({ dx: 3, dy: 4, rotationDeg: 90 }),
      Object.freeze({ dx: -3, dy: -4, rotationDeg: 270 }),
    ]);
    const replacementGeometry = Object.freeze([
      Object.freeze({ dx: 300, dy: 400 }),
      Object.freeze({ dx: -300, dy: -400 }),
    ]);
    const variables = Object.freeze(productionData());

    const first = planVariableBatchSequence(variables, staleGeometry);
    const second = planVariableBatchSequence(variables, replacementGeometry);

    expect(first).toEqual(second);
    expect(first.slots.every((slot) => !('placement' in slot))).toBe(true);
    expect(staleGeometry[0]?.dx).toBe(3);
    expect(variables).toEqual(productionData());
  });

  it('adds no second slot cap or rewrite', () => {
    const slotSeeds = Array.from({ length: 501 }, (_, index) => index);

    const plan = planVariableBatchSequence(DEFAULT_PROJECT_VARIABLE_DATA, slotSeeds);

    expect(plan.slots).toHaveLength(501);
    expect(plan.slots[500]).toEqual({
      slotIndex: 500,
      recordIndex: 0,
      serialValue: 501,
    });
    expect(plan.nextVariables.serialValue).toBe(502);
  });

  it('keeps serial-only record identity and inherited safe-integer behavior', () => {
    const variables: ProjectVariableData = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      recordIndex: 7,
      serialValue: Number.MAX_SAFE_INTEGER,
    };

    const plan = planVariableBatchSequence(variables, [undefined, undefined]);

    expect(
      plan.slots.map(({ recordIndex, serialValue }) => ({ recordIndex, serialValue })),
    ).toEqual([
      { recordIndex: 7, serialValue: Number.MAX_SAFE_INTEGER },
      { recordIndex: 7, serialValue: Number.MAX_SAFE_INTEGER },
    ]);
    expect(plan.nextVariables).toMatchObject({
      recordIndex: 7,
      serialValue: Number.MAX_SAFE_INTEGER,
    });
  });

  it('uses exact bounded arithmetic for maximum safe strides', () => {
    const variables: ProjectVariableData = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: {
        sourceName: 'jobs.csv',
        headers: ['name'],
        records: [['One'], ['Two'], ['Three']],
      },
      recordIndex: 2,
      serialValue: 2,
      sequence: {
        recordStartIndex: 0,
        recordEndIndex: 2,
        serialStartValue: 0,
        serialEndValue: 2,
        advanceBy: Number.MAX_SAFE_INTEGER,
      },
    };

    const plan = planVariableBatchSequence(variables, [undefined, undefined, undefined, undefined]);

    expect(plan.slots).toEqual([
      { slotIndex: 0, recordIndex: 2, serialValue: 2 },
      { slotIndex: 1, recordIndex: 0, serialValue: 0 },
      { slotIndex: 2, recordIndex: 1, serialValue: 1 },
      { slotIndex: 3, recordIndex: 2, serialValue: 2 },
    ]);
    expect(plan.nextVariables).toMatchObject({ recordIndex: 0, serialValue: 0 });
  });

  it('returns an unchanged cursor for an empty supplied slot list', () => {
    const variables = productionData();

    const plan = planVariableBatchSequence(variables, []);

    expect(plan.slots).toEqual([]);
    expect(plan.nextVariables).toBe(variables);
  });
});

function productionData(): ProjectVariableData {
  return {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    csv: {
      sourceName: 'jobs.csv',
      headers: ['name'],
      records: [['One'], ['Two'], ['Three'], ['Four']],
    },
    recordIndex: 2,
    serialValue: 11,
    sequence: {
      recordStartIndex: 1,
      recordEndIndex: 3,
      serialStartValue: 10,
      serialEndValue: 13,
      advanceBy: 2,
    },
  };
}
