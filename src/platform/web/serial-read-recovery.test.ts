import { describe, expect, it } from 'vitest';
import {
  createReadRecoveryBudget,
  MAX_READ_RECOVERIES_WITHOUT_DATA,
  recoverableReadErrorName,
} from './serial-read-recovery';

describe('which Web Serial read errors leave the port usable', () => {
  // https://serial.spec.whatwg.org/ (the `readable` attribute): these four
  // error the stream without setting [[readFatal]].
  it.each(['BufferOverrunError', 'BreakError', 'FramingError', 'ParityError'])(
    'recovers from a %s',
    (name) => {
      expect(recoverableReadErrorName(new DOMException('line error', name))).toBe(name);
    },
  );

  it('keeps every other ending fatal', () => {
    // A lost device (NetworkError), an unspecified OS error, a plain failure,
    // and anything that is not an error at all.
    expect(recoverableReadErrorName(new DOMException('lost', 'NetworkError'))).toBeNull();
    expect(recoverableReadErrorName(new DOMException('os', 'UnknownError'))).toBeNull();
    expect(recoverableReadErrorName(new Error('FramingError'))).toBeNull();
    expect(recoverableReadErrorName('FramingError')).toBeNull();
    expect(recoverableReadErrorName(null)).toBeNull();
  });
});

describe('read recovery budget', () => {
  it('stops recovering once fresh streams keep failing without a byte', () => {
    const budget = createReadRecoveryBudget();
    for (let i = 0; i < MAX_READ_RECOVERIES_WITHOUT_DATA; i += 1) expect(budget.admit()).toBe(true);
    expect(budget.admit()).toBe(false);
  });

  it('starts over whenever bytes arrive, so a noisy but live link is never dropped', () => {
    const budget = createReadRecoveryBudget(2);
    for (let i = 0; i < 50; i += 1) {
      expect(budget.admit()).toBe(true);
      budget.received();
    }
  });
});
