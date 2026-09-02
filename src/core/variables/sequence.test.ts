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

  it('wraps bounded sequences exactly across the full safe-integer domain', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const cases = [
      { start: 0, end: maximum, current: 0, advanceBy: 1, direction: 'next', expected: 1 },
      {
        start: 0,
        end: maximum,
        current: 2,
        advanceBy: 1,
        direction: 'previous',
        expected: 1,
      },
      { start: 0, end: 2, current: 2, advanceBy: maximum, direction: 'next', expected: 0 },
      {
        start: 0,
        end: 2,
        current: 0,
        advanceBy: maximum,
        direction: 'previous',
        expected: 2,
      },
      {
        start: maximum - 2,
        end: maximum,
        current: maximum,
        advanceBy: maximum,
        direction: 'next',
        expected: maximum - 2,
      },
      {
        start: maximum,
        end: maximum,
        current: maximum,
        advanceBy: maximum,
        direction: 'next',
        expected: maximum,
      },
    ] as const;

    for (const testCase of cases) {
      const result = advanceVariableSequence(
        serialData(testCase.current, testCase.start, testCase.end, testCase.advanceBy),
        testCase.direction,
      );
      expect(result.serialValue).toBe(testCase.expected);
    }
  });

  it('matches an exact oracle for accepted safe-integer ranges and strides', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const starts = [0, 1, 17, maximum - 100, maximum - 2];
    const widths = [0, 1, 2, 50, 100];
    const steps = [1, 2, 3, 17, maximum - 1, maximum];

    for (const start of starts) {
      for (const width of widths) {
        const end = start + width;
        if (!Number.isSafeInteger(end)) continue;
        const validCurrents = [start, start + Math.floor(width / 2), end];
        const staleCurrents = [
          ...(start > 0 ? [start - 1] : []),
          ...(end < maximum ? [end + 1] : []),
        ];
        for (const advanceBy of steps) {
          for (const direction of ['next', 'previous'] as const) {
            for (const current of [...validCurrents, ...staleCurrents]) {
              const result = advanceVariableSequence(
                serialData(current, start, end, advanceBy),
                direction,
              );
              expect(result.serialValue).toBe(
                exactBoundedAdvance(current, direction, start, end, advanceBy),
              );
              expect(Number.isSafeInteger(result.serialValue)).toBe(true);
              expect(result.serialValue).toBeGreaterThanOrEqual(start);
              expect(result.serialValue).toBeLessThanOrEqual(end);
            }
          }
          for (const current of validCurrents) {
            const next = advanceVariableSequence(
              serialData(current, start, end, advanceBy),
              'next',
            );
            expect(advanceVariableSequence(next, 'previous').serialValue).toBe(current);
          }
        }
      }
    }
  });

  it('keeps existing unbounded serial overflow and floor behavior', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const variables: ProjectVariableData = {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      serialValue: maximum,
      sequence: {
        recordStartIndex: 0,
        recordEndIndex: 0,
        serialStartValue: maximum - 1,
        advanceBy: 1,
      },
    };

    expect(advanceVariableSequence(variables, 'next').serialValue).toBe(maximum);
    expect(
      advanceVariableSequence({ ...variables, serialValue: maximum - 1 }, 'next').serialValue,
    ).toBe(maximum);
    expect(
      advanceVariableSequence({ ...variables, serialValue: maximum - 1 }, 'previous').serialValue,
    ).toBe(maximum - 1);
    expect(advanceVariableSequence(variables, 'reset').serialValue).toBe(maximum - 1);
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

function serialData(
  serialValue: number,
  serialStartValue: number,
  serialEndValue: number,
  advanceBy: number,
): ProjectVariableData {
  return {
    ...DEFAULT_PROJECT_VARIABLE_DATA,
    serialValue,
    sequence: {
      recordStartIndex: 0,
      recordEndIndex: 0,
      serialStartValue,
      serialEndValue,
      advanceBy,
    },
  };
}

function exactBoundedAdvance(
  current: number,
  direction: 'next' | 'previous',
  start: number,
  end: number,
  advanceBy: number,
): number {
  if (current < start || current > end) return direction === 'next' ? start : end;
  const exactStart = BigInt(start);
  const span = BigInt(end) - exactStart + 1n;
  const delta = direction === 'next' ? BigInt(advanceBy) : -BigInt(advanceBy);
  const offset = BigInt(current) - exactStart + delta;
  return Number(exactStart + (((offset % span) + span) % span));
}
