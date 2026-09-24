import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../scene';
import { advanceVariableSequence } from './sequence';
import { advanceVariableSequenceBy } from './sequence-offset';

describe('copy sequence offsets', () => {
  it('matches independent repeated Next across record/serial bounds, stride and stale positions', () => {
    for (const current of [0, 1, 2, 7, 10, Number.MAX_SAFE_INTEGER - 2]) {
      for (const stride of [1, 2, 7, Number.MAX_SAFE_INTEGER]) {
        for (const serialEndValue of [undefined, 12]) {
          const start = {
            ...DEFAULT_PROJECT_VARIABLE_DATA,
            recordIndex: current,
            serialValue: current,
            csv: { sourceName: 'rows.csv', headers: ['n'], records: [['A'], ['B'], ['C']] },
            sequence: {
              recordStartIndex: 1,
              recordEndIndex: 2,
              serialStartValue: 1,
              ...(serialEndValue === undefined ? {} : { serialEndValue }),
              advanceBy: stride,
            },
          };
          let expected = start;
          for (let steps = 0; steps < 12; steps += 1) {
            expect(advanceVariableSequenceBy(start, steps)).toEqual(expected);
            expected = advanceVariableSequence(expected, 'next') as typeof start;
          }
        }
      }
    }
  });
  it('handles a huge valid offset without allocating or iterating over every copy', () => {
    const result = advanceVariableSequenceBy(
      DEFAULT_PROJECT_VARIABLE_DATA,
      Number.MAX_SAFE_INTEGER,
    );
    expect(result.serialValue).toBe(Number.MAX_SAFE_INTEGER);
  });
});
