import { describe, expect, it } from 'vitest';

import { vitestMaxWorkers } from './vitest-workers';

// D-S02-003: pin the CI-only worker throttle so a future edit can't silently
// oversubscribe a 2-vCPU CI runner (which flakes on `onTaskUpdate` RPC
// starvation) or throttle dev boxes.

describe('vitestMaxWorkers', () => {
  it('uses a single worker on a 2-core CI runner to keep a core free for the orchestrator', () => {
    expect(vitestMaxWorkers({ CI: 'true' }, 2)).toBe(1);
  });

  it('uses half the cores on larger CI runners', () => {
    expect(vitestMaxWorkers({ CI: 'true' }, 4)).toBe(2);
    expect(vitestMaxWorkers({ CI: 'true' }, 5)).toBe(2);
    expect(vitestMaxWorkers({ CI: 'true' }, 8)).toBe(4);
  });

  it('never drops below one worker on CI', () => {
    expect(vitestMaxWorkers({ CI: 'true' }, 1)).toBe(1);
  });

  it('uses four workers locally when CI is unset', () => {
    expect(vitestMaxWorkers({}, 2)).toBe(4);
    expect(vitestMaxWorkers({}, 16)).toBe(4);
  });

  it('treats an empty CI value as local — some shells export CI=""', () => {
    expect(vitestMaxWorkers({ CI: '' }, 8)).toBe(4);
  });

  it('treats any non-empty CI string as CI (the non-empty contract)', () => {
    expect(vitestMaxWorkers({ CI: '1' }, 2)).toBe(1);
    expect(vitestMaxWorkers({ CI: 'anything' }, 2)).toBe(1);
  });
});
