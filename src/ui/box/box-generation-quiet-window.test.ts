import { describe, expect, it } from 'vitest';
import { BOX_GENERATION_QUIET_WINDOW_MS, isImmediateDispatch } from './box-generation-quiet-window';

describe('isImmediateDispatch', () => {
  it('dispatches a request that supersedes nothing immediately', () => {
    expect(isImmediateDispatch({ isRetry: false, hasSupersededLiveWork: false })).toBe(true);
  });

  it('holds a request that superseded live work behind the quiet window', () => {
    expect(isImmediateDispatch({ isRetry: false, hasSupersededLiveWork: true })).toBe(false);
  });

  it('never delays an operator retry, even when it superseded live work', () => {
    expect(isImmediateDispatch({ isRetry: true, hasSupersededLiveWork: true })).toBe(true);
  });
});

describe('BOX_GENERATION_QUIET_WINDOW_MS', () => {
  it('stays short enough that a settled edit previews without a felt wait', () => {
    expect(BOX_GENERATION_QUIET_WINDOW_MS).toBeGreaterThan(0);
    expect(BOX_GENERATION_QUIET_WINDOW_MS).toBeLessThanOrEqual(250);
  });
});
