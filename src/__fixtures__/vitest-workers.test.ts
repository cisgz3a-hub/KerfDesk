import { describe, expect, it } from 'vitest';

import { vitestMaxWorkers } from './vitest-workers';

// D-S02-003: pin the CI-only worker throttle so a future edit can't silently
// oversubscribe the 2-vCPU CI runner (which flakes on `onTaskUpdate` RPC
// starvation) or throttle dev boxes.

describe('vitestMaxWorkers', () => {
  it('uses a single worker on CI to keep a core free for the orchestrator', () => {
    expect(vitestMaxWorkers({ CI: 'true' })).toBe(1);
  });

  it('uses four workers locally when CI is unset', () => {
    expect(vitestMaxWorkers({})).toBe(4);
  });

  it('treats an empty CI value as local — some shells export CI=""', () => {
    expect(vitestMaxWorkers({ CI: '' })).toBe(4);
  });

  it('treats any non-empty CI string as CI (the non-empty contract)', () => {
    expect(vitestMaxWorkers({ CI: '1' })).toBe(1);
    expect(vitestMaxWorkers({ CI: 'anything' })).toBe(1);
  });
});
