import { describe, expect, it, vi } from 'vitest';
import { decodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import { prepareDepthMapPng, prepareReliefHeightfieldPng } from './depth-map-import-preparation';
import { makePng, streamingBlob, u16beBytes } from './png-incremental-decoder.test-support';

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

  it('builds the canonical U16 field, mapping, and digest before returning', async () => {
    const png = makePng({
      width: 2,
      height: 1,
      colorType: 0,
      rows: [[0, 255]],
    });
    const preparing = vi.fn();

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'depth.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
      onPreparing: preparing,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightfield).toMatchObject({
      kind: 'heightfield-v1',
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      mapping: {
        polarity: 'light-is-high',
        maxDepthMm: 5,
        aspect: 'preserve',
      },
      provenance: {
        sourceKind: 'depth-map',
        sourceName: 'depth.png',
        sourceBitDepth: 8,
      },
      digest: 'sha256:0bb01606935a260e822852dc9559c68436a61693c701f566cfab4790e3c1b656',
    });
    expect(result.heightfield).not.toHaveProperty('inclusionMask');
    const decoded = decodeCanonicalBase64(result.heightfield.samplesBase64);
    expect(decoded.kind === 'ok' ? [...decoded.bytes] : decoded).toEqual([0, 0, 255, 255]);
    expect(preparing).toHaveBeenCalledOnce();
  });

  it('binds exact grayscale tRNS matches into the canonical inclusion mask', async () => {
    const png = makePng({
      width: 4,
      height: 1,
      colorType: 0,
      rows: [[12, 127, 200, 127]],
      transparency: Uint8Array.of(0, 127),
    });

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'transparent.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightfield).toMatchObject({
      width: 4,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 25,
      samplesBase64: 'DAx/f8jIf38=',
      inclusionMask: {
        encoding: 'u8-base64-v1',
        samplesBase64: '/wD/AA==',
      },
      mapping: {
        inclusionThreshold: 255,
        outsideMask: 'excluded',
      },
      digest: 'sha256:f83b448b534af8c213a4a379f05d8d2620c3927b4d144520e5d0646cc909062a',
    });
    const decodedSamples = decodeCanonicalBase64(result.heightfield.samplesBase64);
    const decodedMask = decodeCanonicalBase64(
      result.heightfield.inclusionMask?.samplesBase64 ?? '',
    );
    expect(decodedSamples.kind === 'ok' ? [...decodedSamples.bytes] : decodedSamples).toEqual([
      12, 12, 127, 127, 200, 200, 127, 127,
    ]);
    expect(decodedMask.kind === 'ok' ? [...decodedMask.bytes] : decodedMask).toEqual([
      255, 0, 255, 0,
    ]);
  });

  it('preserves PNG16 codes exactly as canonical U16LE with a pinned digest', async () => {
    const codes = [0x0000, 0x0001, 0x00ff, 0x0100, 0x1234, 0x7fff, 0x8000, 0xffff];
    const png = makePng({
      width: 4,
      height: 2,
      colorType: 0,
      bitDepth: 16,
      rows: [u16beBytes(...codes.slice(0, 4)), u16beBytes(...codes.slice(4))],
      filters: [1, 4],
      transparency: Uint8Array.of(0x12, 0x34),
    });

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'exact-u16.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightfield).toMatchObject({
      width: 4,
      height: 2,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      samplesBase64: 'AAABAP8AAAE0Ev9/AID//w==',
      inclusionMask: { encoding: 'u8-base64-v1', samplesBase64: '/////wD///8=' },
      provenance: {
        sourceKind: 'depth-map',
        sourceName: 'exact-u16.png',
        sourceBitDepth: 16,
        sourcePolarity: 'light-is-high',
      },
      digest: 'sha256:c4f8f369dc15354d066ab2411b3a2dbc4e65c16b8ed914e1ca55c733448d8b8a',
    });
    const decoded = decodeCanonicalBase64(result.heightfield.samplesBase64);
    expect(decoded.kind === 'ok' ? [...decoded.bytes] : decoded).toEqual([
      0, 0, 1, 0, 255, 0, 0, 1, 52, 18, 255, 127, 0, 128, 255, 255,
    ]);
  });

  it('matches grayscale-16 transparency against the entire source code', async () => {
    const png = makePng({
      width: 4,
      height: 1,
      colorType: 0,
      bitDepth: 16,
      rows: [u16beBytes(0x1234, 0x1235, 0x0034, 0x1234)],
      transparency: Uint8Array.of(0x12, 0x34),
    });

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'transparent-u16.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const decodedMask = decodeCanonicalBase64(
      result.heightfield.inclusionMask?.samplesBase64 ?? '',
    );
    expect(decodedMask.kind === 'ok' ? [...decodedMask.bytes] : decodedMask).toEqual([
      0, 255, 255, 0,
    ]);
  });

  it('splits grayscale-alpha into exact samples and a required canonical mask', async () => {
    const png = makePng({
      width: 4,
      height: 2,
      colorType: 4,
      rows: [
        [0, 0, 1, 1, 127, 127, 255, 128],
        [12, 254, 64, 255, 128, 200, 200, 42],
      ],
      filters: [1, 4],
    });

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'exact-alpha.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightfield).toMatchObject({
      width: 4,
      height: 2,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      samplesBase64: 'AAABAX9///8MDEBAgIDIyA==',
      inclusionMask: { encoding: 'u8-base64-v1', samplesBase64: 'AAF/gP7/yCo=' },
      mapping: { inclusionThreshold: 255, outsideMask: 'excluded' },
      provenance: {
        sourceKind: 'depth-map',
        sourceName: 'exact-alpha.png',
        sourceBitDepth: 8,
        sourcePolarity: 'light-is-high',
      },
      digest: 'sha256:e4372aace9580e039467c5c6ef5303bcff2febe9d896891a83b43ba73f334b9f',
    });
    const decodedSamples = decodeCanonicalBase64(result.heightfield.samplesBase64);
    const decodedMask = decodeCanonicalBase64(
      result.heightfield.inclusionMask?.samplesBase64 ?? '',
    );
    expect(decodedSamples.kind === 'ok' ? [...decodedSamples.bytes] : decodedSamples).toEqual([
      0, 0, 1, 1, 127, 127, 255, 255, 12, 12, 64, 64, 128, 128, 200, 200,
    ]);
    expect(decodedMask.kind === 'ok' ? [...decodedMask.bytes] : decodedMask).toEqual([
      0, 1, 127, 128, 254, 255, 200, 42,
    ]);
  });

  it('retains an explicit all-opaque alpha mask', async () => {
    const png = makePng({
      width: 2,
      height: 1,
      colorType: 4,
      rows: [[17, 255, 240, 255]],
    });

    const result = await prepareReliefHeightfieldPng(streamingBlob(png), {
      sourceName: 'opaque-alpha.png',
      physicalWidthMm: 100,
      maxDepthMm: 5,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.heightfield.samplesBase64).toBe('ERHw8A==');
    expect(result.heightfield.inclusionMask).toEqual({
      encoding: 'u8-base64-v1',
      samplesBase64: '//8=',
    });
  });
});
