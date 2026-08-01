import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type ArrayPlacement,
  type ProjectVariableData,
} from '../scene';
import { planVariableBatchSequence } from './batch-sequence';

describe('planVariableBatchSequence', () => {
  it('binds each ordered placement to the current sequence value before advancing', () => {
    const placements = [placement(0), placement(10), placement(20)];
    const variables = productionData();

    const plan = planVariableBatchSequence(variables, placements);

    expect(plan.slots).toEqual([
      { slotIndex: 0, placement: placements[0], recordIndex: 2, serialValue: 11 },
      { slotIndex: 1, placement: placements[1], recordIndex: 1, serialValue: 13 },
      { slotIndex: 2, placement: placements[2], recordIndex: 3, serialValue: 11 },
    ]);
    expect(plan.nextVariables).toMatchObject({ recordIndex: 2, serialValue: 13 });
  });

  it('preserves circular placement details and input identity without mutation', () => {
    const pivot = Object.freeze({ x: 42, y: 24 });
    const placements = Object.freeze([
      Object.freeze({ dx: 3, dy: 4, rotationDeg: 90, pivot }),
      Object.freeze({ dx: -3, dy: -4, rotationDeg: 270, pivot }),
    ] satisfies ReadonlyArray<ArrayPlacement>);
    const variables = Object.freeze(productionData());

    const first = planVariableBatchSequence(variables, placements);
    const second = planVariableBatchSequence(variables, placements);

    expect(first).toEqual(second);
    expect(first.slots[0]?.placement).toBe(placements[0]);
    expect(first.slots[1]?.placement).toBe(placements[1]);
    expect(variables).toEqual(productionData());
  });

  it('adds no placement cap or rewrite', () => {
    const placements = Array.from({ length: 501 }, (_, index) => placement(index));

    const plan = planVariableBatchSequence(DEFAULT_PROJECT_VARIABLE_DATA, placements);

    expect(plan.slots).toHaveLength(501);
    expect(plan.slots[500]).toEqual({
      slotIndex: 500,
      placement: placements[500],
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

    const plan = planVariableBatchSequence(variables, [placement(0), placement(1)]);

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

  it('returns an unchanged cursor for an empty supplied placement list', () => {
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

function placement(dx: number): ArrayPlacement {
  return { dx, dy: dx / 2, rotationDeg: dx };
}
