// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImagesToVectorFiles, type RawImageData } from '../../core/trace';
import type { BatchTraceFormat } from '../../core/trace/batch-trace';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import { writeTracedDrawing } from '../../io/vector-formats/traced-drawing';

// Golden bytes for Multi-File Trace's default output (rank 33 acceptance):
// the hashes were taken on the batch's base commit 7a644d486, before paper
// pages, per-side margins, the Size row, streaming writes and per-file skips,
// and must not move. A change here changes files users already export.

function ringImage(): RawImageData {
  const width = 64;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - 24, y - 24);
      const ink = (r > 9 && r < 17) || (x > 44 && x < 58 && y > 8 && y < 40);
      if (ink) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { width, height, data };
}

const LINE_ART = TRACE_PRESETS['Line Art'];

const FORMATS: ReadonlyArray<BatchTraceFormat> = ['svg', 'pdf', 'eps', 'dxf', 'geojson'];

async function defaultHashes(page?: {
  readonly fit: 'artwork';
  readonly marginMm: number;
}): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const format of FORMATS) {
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'ring.png',
          image: ringImage(),
          physicalSizeMm: { widthMm: 6.4, heightMm: 4.8 },
          ...(LINE_ART === undefined ? {} : { options: LINE_ART }),
        },
      ],
      { writeDrawing: writeTracedDrawing, writeDxf: tracedLayersToDxf },
      { format, ...(page === undefined ? {} : { page }) },
    );
    const text = result.files[0]?.text ?? '';
    hashes[format] = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  }
  return hashes;
}

const IMAGE_PAGE_GOLDEN: Record<string, string> = {
  svg: '2bc0ca008144ee89',
  pdf: 'dfbda31d90fa0f8d',
  eps: '74886c87d1a15575',
  dxf: '21e38ecf282a0e51',
  geojson: '714361673f2b5059',
};
const ARTWORK_PAGE_GOLDEN: Record<string, string> = {
  svg: 'c60afbf2f79b8203',
  pdf: 'e60dc51bfb34b07c',
  eps: 'c270b2ce9031f66b',
  dxf: 'edcb205044d485c2',
  geojson: '61a1cad1befbdf0f',
};

describe('Multi-File Trace default output is byte-identical to the base commit', () => {
  it('writes the image page unchanged in every format', async () => {
    expect(await defaultHashes()).toEqual(IMAGE_PAGE_GOLDEN);
  });

  it('writes the fitted page with a shared margin unchanged in every format', async () => {
    expect(await defaultHashes({ fit: 'artwork', marginMm: 1.5 })).toEqual(ARTWORK_PAGE_GOLDEN);
  });
});
