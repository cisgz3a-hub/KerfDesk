import { describe, expect, it } from 'vitest';
import { cancel, createStreamer, markErrored, step } from '../../core/controllers/grbl';
import { variableStreamOutcome } from './variable-stream-advancement';

describe('variable stream advancement outcome', () => {
  it('accepts only a completed stream released after controller settle', () => {
    const started = step(createStreamer('G1 X1')).state;
    const done = { ...started, status: 'done' as const };
    expect(variableStreamOutcome(started, done)).toBe('pending');
    expect(variableStreamOutcome(done, null)).toBe('successful');
  });

  it('rejects cancellation, error, and disconnect transitions', () => {
    const started = step(createStreamer('G1 X1')).state;
    expect(variableStreamOutcome(started, cancel(started))).toBe('pending');
    expect(variableStreamOutcome(cancel(started), null)).toBe('failed');
    expect(variableStreamOutcome(started, markErrored(started))).toBe('failed');
    expect(variableStreamOutcome(started, null)).toBe('failed');
  });
});
