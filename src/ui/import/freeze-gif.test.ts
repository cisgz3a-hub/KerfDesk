import { afterEach, describe, expect, it, vi } from 'vitest';
import { freezeGif, isGif } from './freeze-gif';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('GIF source and luma frame ownership', () => {
  it('encodes one fixed bitmap frame and releases it, retaining the displayed source name', async () => {
    const close = vi.fn();
    const bitmap = { width: 2, height: 1, close };
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const encoded = new Blob(['PNG pixels'], { type: 'image/png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(encoded),
    );
    const original = new File(['GIF89a'], 'animation.gif', { type: 'image/gif' });
    const result = await freezeGif(original);
    expect(decode).toHaveBeenCalledExactlyOnceWith(original);
    expect(close).toHaveBeenCalledOnce();
    expect(result.name).toBe('animation.gif');
    expect(result.type).toBe('image/png');
    expect(result.size).toBe(encoded.size);
    expect(isGif(result)).toBe(false);
  });
  it('releases the decoded frame when PNG encoding fails', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 1, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(null),
    );
    await expect(freezeGif(new File([], 'bad.gif'))).rejects.toThrow('encode GIF');
    expect(close).toHaveBeenCalledOnce();
  });
});
