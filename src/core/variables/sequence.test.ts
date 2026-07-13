import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA, type ProjectVariableData } from '../scene';
import { advanceVariableSequence, resolveVariableSequence } from './sequence';

describe('variable production sequence', () => {
  it('wraps Next and Previous across configured CSV and serial ranges', () => {
    const end = data({ recordIndex: 3, serialValue: 13 });
    const next = advanceVariableSequence(end, 'next');
    expect(next).toMatchObject({ recordIndex: 1, serialValue: 10 });
    expect(advanceVariableSequence(next, 'previous')).toMatchObject({
      recordIndex: 3,
      serialValue: 13,
    });
  });

  it('resets both currents and keeps serial unbounded when no end is configured', () => {
    const variables: ProjectVariableData = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      recordIndex: 2,
      serialValue: 99,
      csv: csv(5),
      sequence: {
        recordStartIndex: 1,
        recordEndIndex: 4,
        serialStartValue: 20,
        advanceBy: 2,
      },
    };
    expect(advanceVariableSequence(variables, 'reset')).toMatchObject({
      recordIndex: 1,
      serialValue: 20,
    });
    expect(advanceVariableSequence(variables, 'next')).toMatchObject({
      recordIndex: 4,
      serialValue: 101,
    });
    expect(advanceVariableSequence({ ...variables, serialValue: 20 }, 'previous')).toMatchObject({
      serialValue: 20,
    });
  });

  it('enters the configured range predictably from stale current values', () => {
    const stale = data({ recordIndex: 99, serialValue: 99 });
    expect(advanceVariableSequence(stale, 'next')).toMatchObject({
      recordIndex: 1,
      serialValue: 10,
    });
    expect(advanceVariableSequence(stale, 'previous')).toMatchObject({
      recordIndex: 3,
      serialValue: 13,
    });
  });

  it('stays inside a long CSV production range over ten thousand advances', () => {
    let variables: ProjectVariableData = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      recordIndex: 100,
      serialValue: 1_000,
      csv: csv(1_000),
      sequence: {
        recordStartIndex: 100,
        recordEndIndex: 899,
        serialStartValue: 1_000,
        serialEndValue: 9_999,
        advanceBy: 7,
      },
    };
    for (let index = 0; index < 10_000; index += 1) {
      variables = advanceVariableSequence(variables, 'next');
      expect(variables.recordIndex).toBeGreaterThanOrEqual(100);
      expect(variables.recordIndex).toBeLessThanOrEqual(899);
      expect(variables.serialValue).toBeGreaterThanOrEqual(1_000);
      expect(variables.serialValue).toBeLessThanOrEqual(9_999);
    }
    expect(variables).toMatchObject({ recordIndex: 500, serialValue: 8_000 });
  });

  it('clamps stale persisted ranges to the embedded CSV', () => {
    const variables = data({
      sequence: {
        recordStartIndex: 99,
        recordEndIndex: 120,
        serialStartValue: 5,
        serialEndValue: 3,
        advanceBy: 0,
      },
    });
    expect(resolveVariableSequence(variables)).toEqual({
      recordStartIndex: 3,
      recordEndIndex: 3,
      serialStartValue: 5,
      serialEndValue: 5,
      advanceBy: 1,
    });
  });
});

function data(overrides: Partial<ProjectVariableData>): ProjectVariableData {
  return {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    csv: csv(4),
    sequence: {
      recordStartIndex: 1,
      recordEndIndex: 3,
      serialStartValue: 10,
      serialEndValue: 13,
      advanceBy: 1,
    },
    ...overrides,
  };
}

function csv(count: number) {
  return {
    sourceName: 'jobs.csv',
    headers: ['name'],
    records: Array.from({ length: count }, (_, index) => [`Job ${index + 1}`]),
  };
}
