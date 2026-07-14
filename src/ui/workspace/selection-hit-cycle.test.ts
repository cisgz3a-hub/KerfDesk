import { describe, expect, it } from 'vitest';
import { nextSelectionHit } from './selection-hit-cycle';

describe('nextSelectionHit', () => {
  const candidates = ['top', 'middle', 'bottom'];

  it('starts at the top when the current selection is not under the pointer', () => {
    expect(nextSelectionHit(candidates, 'elsewhere')).toBe('top');
  });

  it('advances through the hit stack and wraps around', () => {
    expect(nextSelectionHit(candidates, 'top')).toBe('middle');
    expect(nextSelectionHit(candidates, 'bottom')).toBe('top');
  });
});
