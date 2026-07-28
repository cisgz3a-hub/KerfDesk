import { describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { handleOpenGcodeInspector, openGcodeFileInInspector } from './gcode-open-action';

describe('openGcodeFileInInspector', () => {
  it('reads one accepted file and opens the existing Inspector callback', async () => {
    const openInspector = vi.fn();
    const pushToast = vi.fn();
    const text = vi.fn(async () => 'G21\nG1 X10');

    await openGcodeFileInInspector({ name: 'part.nc', size: 15, text }, openInspector, pushToast);

    expect(text).toHaveBeenCalledTimes(1);
    expect(openInspector).toHaveBeenCalledWith('part.nc', 'G21\nG1 X10');
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports a read failure without opening the Inspector', async () => {
    const openInspector = vi.fn();
    const pushToast = vi.fn();

    await openGcodeFileInInspector(
      {
        name: 'broken.gcode',
        size: 10,
        text: vi.fn(async () => {
          throw new Error('read failed');
        }),
      },
      openInspector,
      pushToast,
    );

    expect(openInspector).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('broken.gcode: read failed', 'error');
  });

  it('applies the shared 64 MB G-code limit before reading', async () => {
    const openInspector = vi.fn();
    const pushToast = vi.fn();
    const text = vi.fn(async () => 'G21');

    await openGcodeFileInInspector(
      { name: 'huge.tap', size: 64 * 1024 * 1024 + 1, text },
      openInspector,
      pushToast,
    );

    expect(text).not.toHaveBeenCalled();
    expect(openInspector).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'huge.tap exceeds the 64 MB G-code import limit.',
      'error',
    );
  });
});

describe('handleOpenGcodeInspector', () => {
  it('keeps the picker extension contract while delegating file handling', async () => {
    const file = { name: 'picked.tap', size: 12, text: async () => 'G21' };
    const pickFilesForOpen = vi.fn(async () => [file]);
    const platform = mockPlatform({ open: pickFilesForOpen });
    const openInspector = vi.fn();

    await handleOpenGcodeInspector(platform, openInspector, vi.fn());

    expect(pickFilesForOpen).toHaveBeenCalledWith({
      accept: ['.nc', '.gcode', '.tap'],
      multiple: false,
    });
    expect(openInspector).toHaveBeenCalledWith('picked.tap', 'G21');
  });
});
