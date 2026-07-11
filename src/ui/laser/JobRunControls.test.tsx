import { describe, expect, it } from 'vitest';
import { shouldShowOverrides } from './JobRunControls';

describe('shouldShowOverrides', () => {
  it('mounts the override controls only during an active job on a capable controller', () => {
    // GRBL-family (hasOverrides true) while streaming or paused → mounted.
    expect(shouldShowOverrides(true, false, true)).toBe(true);
    expect(shouldShowOverrides(false, true, true)).toBe(true);
  });

  it('never mounts overrides when no job is active', () => {
    expect(shouldShowOverrides(false, false, true)).toBe(false);
  });

  it('never mounts overrides on a controller without realtime overrides (CTL-01)', () => {
    // Marlin/Smoothieware/Ruida (hasOverrides false): the controls must stay
    // hidden even mid-job so the corrupting 0x90–0x9D byte is never requested.
    expect(shouldShowOverrides(true, false, false)).toBe(false);
    expect(shouldShowOverrides(false, true, false)).toBe(false);
  });
});
