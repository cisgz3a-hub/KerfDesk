import { afterEach, describe, expect, it, vi } from 'vitest';

import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

const ROTARY_SAVE_NAME = 'rotary.gcode';

function mockPlatform(save: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

describe('handleSaveGcode rotary raster emission', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops before picker, write, advancement, and success when Labs permission is absent', async () => {
    const project = rotaryRasterSaveProject();
    const write = vi.fn<SaveTarget['write']>();
    const target: SaveTarget = { displayName: ROTARY_SAVE_NAME, write };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: mockPlatform(pickFileForSave),
      project,
      savedName: null,
      pushToast,
      advanceVariablesAfter,
    });

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(advanceVariablesAfter).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('Rotary image engraving is experimental and disabled'),
    );
  });

  it('writes non-empty rotary raster bytes and reports success with explicit permission', async () => {
    const project = rotaryRasterSaveProject();
    const written: string[] = [];
    const target: SaveTarget = {
      displayName: ROTARY_SAVE_NAME,
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text G-code');
        written.push(data);
      },
    };
    const pickFileForSave = vi.fn(async () => target);
    const advanceVariablesAfter = vi.fn();
    const pushToast = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: mockPlatform(pickFileForSave),
      project,
      savedName: null,
      allowRotaryRaster: true,
      pushToast,
      advanceVariablesAfter,
    });

    expect(alert).not.toHaveBeenCalled();
    expect(pickFileForSave).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toBe('');
    expect(advanceVariablesAfter).toHaveBeenCalledWith(project, 'successful-export');
    expect(pushToast).toHaveBeenCalledWith(`Saved G-code to ${ROTARY_SAVE_NAME}`, 'success');
  });
});
