import { describe, expect, it } from 'vitest';
import { ownedClipImage } from '../../__fixtures__/owned-image-clip';
import type { RasterImage } from '../../core/scene';
import { matchSvgSourceComponents } from './svg-fragment-reimport';

function pagedImage(sourceAssetId: string, lumaAssetId: string): RasterImage {
  const { dataUrl, lumaBase64: _luma, ...source } = ownedClipImage();
  if (dataUrl === undefined) throw new Error('Missing fixture pixels');
  return {
    ...source,
    transform: source.svgImport?.transform ?? source.transform,
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId,
      lumaAssetId,
      sourceMimeType: 'image/png',
      sourceByteLength: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').length,
      lumaByteLength: 16,
      naturalWidth: 4,
      naturalHeight: 4,
      sampledWidth: 4,
      sampledHeight: 4,
      thumbnail: { mimeType: 'image/png', dataUrl, width: 4, height: 4 },
    },
  };
}

describe('page-backed SVG source identity boundary', () => {
  it('does not infer stable content identity from identical metadata with new asset owners', () => {
    const previous = pagedImage('original-bytes', 'original-luma');
    const decodedAgain = pagedImage('decoded-again-bytes', 'decoded-again-luma');
    expect(previous.imageAsset?.thumbnail).toEqual(decodedAgain.imageAsset?.thumbnail);
    expect(previous.imageAsset?.sourceByteLength).toBe(decodedAgain.imageAsset?.sourceByteLength);
    // The repository has no stable source digest. A new owner may hold the same
    // source bytes, but matching cannot prove that from dimensions or a thumbnail.
    expect(matchSvgSourceComponents([previous], [decodedAgain])).toEqual([undefined]);
  });
});
