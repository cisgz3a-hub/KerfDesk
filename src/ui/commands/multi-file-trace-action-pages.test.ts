import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { runMultiFileTrace, type MultiFileTraceFile } from './multi-file-trace-action';

// Nothing about a page is lost silently: artwork cropped by a paper page and
// the ignored pages of a multi-page TIFF are both named in the batch notice.

const SQUARE_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
  ],
};

const files = (...names: string[]): MultiFileTraceFile[] =>
  names.map((name) => ({ name, size: 1 }) as MultiFileTraceFile);

function raster(pageCount?: number) {
  return {
    width: 4,
    height: 4,
    rgba: new Uint8ClampedArray(64),
    // 4 px at 1 px/mm is a 4 mm square.
    sizeMm: { widthMm: 4, heightMm: 4 },
    ...(pageCount === undefined ? {} : { pageCount }),
  };
}

describe('Multi-File Trace page notices', () => {
  it('names the files whose artwork runs past the paper edge', async () => {
    const pushToast = vi.fn();
    await runMultiFileTrace(files('big.tif', 'small.tif'), pushToast, {
      decodeRaster: async (file) =>
        file.name === 'big.tif' ? { ...raster(), sizeMm: { widthMm: 40, heightMm: 40 } } : raster(),
      trace: async () => [SQUARE_PATH],
      output: { page: { fit: 'paper', paperMm: { width: 20, height: 20 } } },
      write: async () => true,
    });
    const [text, kind] = pushToast.mock.calls[0] ?? [];
    expect(text).toContain('The artwork runs past the page edge in big.tif;');
    expect(text).not.toContain('small.tif;');
    expect(kind).toBe('warning');
  });

  it('says when only page 1 of a multi-page TIFF was traced', async () => {
    const pushToast = vi.fn();
    await runMultiFileTrace(files('scan.tif', 'one.tif'), pushToast, {
      decodeRaster: async (file) => (file.name === 'scan.tif' ? raster(3) : raster()),
      trace: async () => [SQUARE_PATH],
      write: async () => true,
    });
    const [text, kind] = pushToast.mock.calls[0] ?? [];
    expect(text).toContain('Only page 1 was traced of scan.tif (3 pages).');
    expect(text).not.toContain('one.tif');
    expect(kind).toBe('success');
  });
});
