import { describe, expect, it } from 'vitest';
import { isTextCutTypeCompatible } from './text-layer-policy';

describe('CNC single-line text machining policy', () => {
  it('keeps open stroke fonts on path-following operations', () => {
    expect(isTextCutTypeCompatible('ems-decorous-script', 'engrave')).toBe(true);
    expect(isTextCutTypeCompatible('ems-decorous-script', 'profile-on-path')).toBe(true);
    expect(isTextCutTypeCompatible('ems-decorous-script', 'v-carve')).toBe(false);
    expect(isTextCutTypeCompatible('ems-decorous-script', 'pocket')).toBe(false);
    expect(isTextCutTypeCompatible('ems-decorous-script', 'profile-inside')).toBe(false);
  });

  it('does not restrict ordinary outline fonts', () => {
    expect(isTextCutTypeCompatible('roboto-regular', 'v-carve')).toBe(true);
    expect(isTextCutTypeCompatible('roboto-regular', 'pocket')).toBe(true);
  });
});
