import { describe, expect, it } from 'vitest';
import { parseOptionalJobInterruption, type JobInterruption } from './job-interruption';

// ADR-215 Amendment 1: the position-lost mark survives storage, and a value
// other than `true` is a corrupt record, not a silent "position kept".
describe('parseOptionalJobInterruption position loss', () => {
  const lost: JobInterruption = {
    kind: 'cancelled',
    message: 'Stopped by the operator (Abort).',
    positionLost: true,
  };

  it('keeps the mark through a storage round trip', () => {
    const stored: unknown = JSON.parse(JSON.stringify(lost));
    expect(parseOptionalJobInterruption(stored)).toEqual({ interruption: lost });
  });

  it('reads a record written before the mark existed as unmarked', () => {
    expect(parseOptionalJobInterruption({ kind: 'cancelled', message: 'x' })).toEqual({
      interruption: { kind: 'cancelled', message: 'x' },
    });
  });

  it('rejects any other value', () => {
    for (const positionLost of [false, 'yes', 1, null]) {
      expect(parseOptionalJobInterruption({ ...lost, positionLost })).toBeNull();
    }
  });
});
