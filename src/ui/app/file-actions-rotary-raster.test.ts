import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, SAVE_TARGET_NAME } from '../../__fixtures__/file-actions';
import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { SaveTarget } from '../../platform/types';
import { handleSaveGcode } from './file-actions';

afterEach(() => vi.restoreAllMocks());

describe('handleSaveGcode rotary raster emission', () => {
  it('stops before write, advancement, and success when Labs permission is absent', async () => {
    const project = rotaryRasterSaveProject();
    const write = vi.fn<SaveTarget['write']>();
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

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(advanceVariablesAfter).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('Rotary image engraving is experimental and disabled'),
    );
  });

  it('does not reserve, create, or truncate the destination when preparation fails', async () => {
    const target: SaveTarget = { displayName: 'existing.gcode', write: vi.fn() };
    const reserveFileForSave = vi.fn(async () => target);
    const pickFileForSave = vi.fn(async () => {
      throw new Error('the destructive picker must not be used');
    });
    vi.spyOn(window, 'alert').mockReturnValue(undefined);

    await handleSaveGcode({
      platform: { ...mockPlatform({ save: pickFileForSave }), reserveFileForSave },
      project: rotaryRasterSaveProject(),
      savedName: null,
      pushToast: vi.fn(),
    });

    expect(reserveFileForSave).not.toHaveBeenCalled();
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(target.write).not.toHaveBeenCalled();
  });

  it('writes non-empty rotary raster bytes and reports success with explicit permission', async () => {
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

    await handleSaveGcode({
      platform: mockPlatform({ save: pickFileForSave }),
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
    expect(pushToast).toHaveBeenCalledWith(`Saved G-code to ${SAVE_TARGET_NAME}`, 'success');
  });
});
