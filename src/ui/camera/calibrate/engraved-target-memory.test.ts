import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rememberEngravedTarget,
  rememberedEngravedTarget,
  type EngravedTarget,
} from './engraved-target-memory';

const falcon = { name: 'Falcon A1 Pro', profileId: 'creality-falcon-a1-pro' };
const target: EngravedTarget = {
  area: { x: 20, y: 20, width: 360, height: 360 },
  bedWidthMm: 400,
  bedHeightMm: 400,
  layoutMm: 20,
  engravedAt: '2026-09-29T08:00:00.000Z',
};

beforeEach(() => localStorage.clear());

describe('engraved target memory', () => {
  it('remembers the target per machine and per kind of camera', () => {
    rememberEngravedTarget(falcon, false, target);
    expect(rememberedEngravedTarget(falcon, false)).toEqual(target);
    expect(rememberedEngravedTarget(falcon, true)).toBeNull();
    expect(rememberedEngravedTarget({ name: 'Other laser' }, false)).toBeNull();
    const square = { ...target, area: { x: 180, y: 180, width: 40, height: 40 }, layoutMm: 40 };
    rememberEngravedTarget(falcon, true, square);
    expect(rememberedEngravedTarget(falcon, true)).toEqual(square);
    expect(rememberedEngravedTarget(falcon, false)).toEqual(target);
  });

  it('keeps a target when the bed size of the profile changes', () => {
    rememberEngravedTarget(falcon, false, target);
    expect(rememberedEngravedTarget({ ...falcon, bedWidth: 380 } as typeof falcon, false)).toEqual(
      target,
    );
  });

  it('forgets nothing it cannot read, and trusts nothing malformed', () => {
    localStorage.setItem('kerfdesk.camera.engraved-targets.v1', '{not json');
    expect(rememberedEngravedTarget(falcon, false)).toBeNull();
    localStorage.setItem(
      'kerfdesk.camera.engraved-targets.v1',
      JSON.stringify({ [falcon.profileId]: { bed: { ...target, area: { x: 0, y: 0 } } } }),
    );
    expect(rememberedEngravedTarget(falcon, false)).toBeNull();
  });

  it('carries on without storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberEngravedTarget(falcon, false, target)).not.toThrow();
    setItem.mockRestore();
    expect(rememberedEngravedTarget(falcon, false)).toBeNull();
  });
});
