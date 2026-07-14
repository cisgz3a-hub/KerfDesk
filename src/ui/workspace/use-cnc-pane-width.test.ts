import { describe, expect, it } from 'vitest';
import {
  clampPaneWidth,
  DEFAULT_PANE_WIDTH_PX,
  MAX_PANE_WIDTH_PX,
  MIN_PANE_WIDTH_PX,
} from './use-cnc-pane-width';

describe('clampPaneWidth', () => {
  it('keeps an in-range width, rounded to a whole pixel', () => {
    expect(clampPaneWidth(300.6)).toBe(301);
  });

  it('clamps below the minimum', () => {
    expect(clampPaneWidth(MIN_PANE_WIDTH_PX - 50)).toBe(MIN_PANE_WIDTH_PX);
  });

  it('clamps above the maximum', () => {
    expect(clampPaneWidth(MAX_PANE_WIDTH_PX + 500)).toBe(MAX_PANE_WIDTH_PX);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampPaneWidth(Number.NaN)).toBe(DEFAULT_PANE_WIDTH_PX);
    expect(clampPaneWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PANE_WIDTH_PX);
  });
});
