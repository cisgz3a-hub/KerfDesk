// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { tiffDocument } from '../../__fixtures__/tiff-document';
import type { ColoredPath } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import { batchRasterAtMaxEdge, decodeBatchRasterFile } from './batch-raster-decode';
import { buildMultiFileTraceExports } from './multi-file-trace-action';

const SQUARE_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    },
  ],
};

function pbmFile(): File {
  return new File([new TextEncoder().encode('P1\n4 2\n1100\n0011\n')], 'scan.pbm');
}

describe('Multi-File Trace TIFF and Netpbm inputs (rank 22)', () => {
  it('traces a TIFF and a PBM in one batch to two exports', async () => {
    const tiff = new File([tiffDocument([{}])], 'scan.tif', { type: 'image/tiff' });
    const traced: RawImageData[] = [];
    const trace = vi.fn(async (image: RawImageData) => {
      traced.push(image);
      return [SQUARE_PATH];
    });
    const readDensity = vi.fn(async () => null);
    const batch = await buildMultiFileTraceExports([tiff, pbmFile()], { trace, readDensity });

    expect(batch.files.map((file) => file.filename)).toEqual([
      'scan-trace.svg',
      'scan-2-trace.svg',
    ]);
    expect(batch.skipped).toEqual([]);
    expect(traced.map((image) => [image.width, image.height])).toEqual([
      [2, 3],
      [4, 2],
    ]);
    // The TIFF's own resolution sizes it (100 x 200 DPI); Netpbm has none.
    expect(batch.files.map((file) => file.densitySource)).toEqual(['embedded', 'default']);
    expect(batch.files[0]?.text).toContain(`width="${(2 * 25.4) / 100}mm"`);
    expect(readDensity).not.toHaveBeenCalled();
  });

  it('resamples a decode to the planned max edge like the browser loader', async () => {
    const raster = await decodeBatchRasterFile(pbmFile());
    expect(raster).not.toBeNull();
    if (raster === null) return;
    const capped = batchRasterAtMaxEdge(raster, 2);
    expect([capped.width, capped.height]).toEqual([2, 1]);
    expect(batchRasterAtMaxEdge(raster).data).toEqual(raster.rgba);
    expect(await decodeBatchRasterFile(new File([], 'photo.png'))).toBeNull();
  });

  it('skips a corrupt TIFF as a decode failure', async () => {
    const broken = new File([new Uint8Array([1, 2, 3])], 'broken.tiff');
    const batch = await buildMultiFileTraceExports([broken, pbmFile()], {
      trace: async () => [SQUARE_PATH],
    });
    expect(batch.files.map((file) => file.filename)).toEqual(['scan-trace.svg']);
    expect(batch.skipped[0]?.sourceName).toBe('broken.tiff');
    expect(batch.skipped[0]?.reason).toBe('decode-failed');
  });
});
