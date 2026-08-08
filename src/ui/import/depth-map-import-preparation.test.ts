import { describe, expect, it } from 'vitest';
import { prepareDepthMapPng } from './depth-map-import-preparation';
import { makePng, streamingBlob } from './png-incremental-decoder.test-support';

describe('prepareDepthMapPng', () => {
  it('embeds every grayscale pixel without resampling', async () => {
    const png = makePng({
      width: 3,
      height: 2,
      colorType: 0,
      rows: [
        [0, 1, 2],
        [127, 128, 255],
      ],
      filters: [1, 4],
    });

    const result = await prepareDepthMapPng(streamingBlob(png));

    expect(result).toEqual({
      kind: 'ok',
      depthMap: {
        schemaVersion: 1,
        width: 3,
        height: 2,
        bitDepth: 8,
        samplesBase64: Buffer.from([0, 1, 2, 127, 128, 255]).toString('base64'),
        polarity: 'light-is-high',
      },
    });
  });

  it('does not reinterpret an ordinary RGB PNG as relief depth', async () => {
    const png = makePng({ width: 1, height: 1, rows: [[10, 20, 30]] });
    await expect(prepareDepthMapPng(streamingBlob(png))).rejects.toThrow(/grayscale PNG/);
  });
});
