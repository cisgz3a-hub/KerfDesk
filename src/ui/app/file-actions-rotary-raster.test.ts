import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, SAVE_TARGET_NAME } from '../../__fixtures__/file-actions';
import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('handleSaveGcode rotary raster emission', () => {
  it('writes non-empty bytes and advances after a default rotary raster export', async () => {
    const project = rotaryRasterSaveProject();
    const written: string[] = [];
    const write = vi.fn<SaveTarget['write']>(async (data) => {
      if (typeof data !== 'string') throw new Error('expected text G-code');
      written.push(data);
    });
    const target: SaveTarget = { displayName: SAVE_TARGET_NAME, write };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: mockPlatform({ save: pickFileForSave }),
      project,
      savedName: null,
      pushToast,
      advanceVariablesAfter,
    });

    expect(alert).not.toHaveBeenCalled();
    expect(pickFileForSave).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toBe('');
    expect(advanceVariablesAfter).toHaveBeenCalledWith(project, 'successful-export');
    expect(pushToast).toHaveBeenCalledWith(`Saved G-code to ${SAVE_TARGET_NAME}`, 'success');
  });

  it('keeps legacy permission input byte-neutral', async () => {
    const project = rotaryRasterSaveProject();
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: SAVE_TARGET_NAME,
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    for (const legacyRotaryRaster of [false, true]) {
      localStorage.setItem(
        'kerfdesk.experimental-laser-features.v1',
        JSON.stringify({ rotary: true, rotaryRaster: legacyRotaryRaster }),
      );
      await handleSaveGcode({
        platform: mockPlatform({ save: pickFileForSave }),
        project,
        savedName: null,
        pushToast,
        advanceVariablesAfter,
      });
    }

    expect(alert).not.toHaveBeenCalled();
    expect(pickFileForSave).toHaveBeenCalledTimes(2);
    expect(written).toHaveLength(2);
    expect(written[0]).not.toBe('');
    expect(written[1]).toBe(written[0]);
    expect(advanceVariablesAfter).toHaveBeenCalledTimes(2);
    expect(pushToast.mock.calls.filter(([, kind]) => kind === 'success')).toHaveLength(2);
  });
});
