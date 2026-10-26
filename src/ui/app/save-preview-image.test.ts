import { describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { installChromiumSavePicker } from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import { saveWorkspacePreviewImage } from './save-preview-image';

describe('saveWorkspacePreviewImage', () => {
  it('writes the composed workspace layers under the project name', async () => {
    const write = vi.fn(async () => undefined);
    const pickFileForSave = vi.fn(async () => ({ displayName: 'sign-preview.png', write }));
    const png = new Blob(['png'], { type: 'image/png' });
    const layers = [document.createElement('canvas'), document.createElement('canvas')];
    const encode = vi.fn(async () => png);

    await saveWorkspacePreviewImage({
      platform: { pickFileForSave } as unknown as PlatformAdapter,
      savedName: 'sign.lf2',
      pushToast: vi.fn(),
      findLayers: () => layers,
      encode,
    });

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'sign-preview.png',
      extensions: ['.png'],
    });
    expect(encode).toHaveBeenCalledWith(layers);
    expect(write).toHaveBeenCalledWith(png);
  });

  it('asks for the workspace when there is nothing to capture', async () => {
    const pushToast = vi.fn();
    const pickFileForSave = vi.fn();
    await saveWorkspacePreviewImage({
      platform: { pickFileForSave } as unknown as PlatformAdapter,
      savedName: null,
      pushToast,
      findLayers: () => [],
    });
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('workspace'), 'warning');
  });
});

describe('Save Preview Image over an existing file (ADR-656, audit 19-P2-1)', () => {
  it('keeps the old file when the PNG cannot be made, without opening the picker', async () => {
    const disk = new Map([['sign-preview.png', 'previous preview']]);
    const picker = installChromiumSavePicker(disk);
    const pushToast = vi.fn();
    try {
      await saveWorkspacePreviewImage({
        platform: webAdapter,
        savedName: 'sign.lf2',
        pushToast,
        findLayers: () => [document.createElement('canvas')],
        encode: async () => {
          throw new Error('The workspace is too large to capture.');
        },
      });
    } finally {
      picker.restore();
    }
    expect(picker.picks()).toBe(0);
    expect(disk.get('sign-preview.png')).toBe('previous preview');
    expect(pushToast).toHaveBeenCalledWith(
      'Could not save the preview image: The workspace is too large to capture.',
      'error',
    );
  });
});
