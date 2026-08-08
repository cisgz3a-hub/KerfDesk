import { describe, expect, it } from 'vitest';
import type { ReliefObject } from '../scene';
import { canonicalBase64ByteLength } from './depth-map-base64';
import { depthMapToHeightmap } from './depth-map-to-heightmap';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

function source(
  samples: ReadonlyArray<number>,
  overrides: Partial<ReliefDepthMap> = {},
): ReliefDepthMap {
  return {
    schemaVersion: 1,
    width: samples.length,
    height: 1,
    bitDepth: 8,
    samplesBase64: Buffer.from(samples).toString('base64'),
    polarity: 'light-is-high',
    ...overrides,
  };
}

describe('depthMapToHeightmap', () => {
  it('maps the full 8-bit range to physical depth with explicit polarity', () => {
    const high = depthMapToHeightmap(source([0, 255]), {
      targetWidthMm: 2,
      reliefDepthMm: 5,
      mmPerCell: 1,
    });
    const deep = depthMapToHeightmap(source([0, 255], { polarity: 'light-is-deep' }), {
      targetWidthMm: 2,
      reliefDepthMm: 5,
      mmPerCell: 1,
    });

    expect(high.kind).toBe('ok');
    expect(deep.kind).toBe('ok');
    if (high.kind !== 'ok' || deep.kind !== 'ok') return;
    expect([...high.heightmap.depth]).toEqual([-5, 0]);
    expect([...deep.heightmap.depth]).toEqual([0, -5]);
  });

  it('decodes 16-bit samples in network byte order without reducing them to 8-bit', () => {
    const map = depthMapToHeightmap(
      source([], {
        width: 3,
        bitDepth: 16,
        samplesBase64: Buffer.from([0x00, 0x00, 0x80, 0x00, 0xff, 0xff]).toString('base64'),
        polarity: 'light-is-deep',
      }),
      { targetWidthMm: 3, reliefDepthMm: 6, mmPerCell: 1 },
    );

    expect(map.kind).toBe('ok');
    if (map.kind !== 'ok') return;
    expect(map.heightmap.depth[0]).toBe(0);
    expect(map.heightmap.depth[1]).toBeCloseTo(-3.000_046, 5);
    expect(map.heightmap.depth[2]).toBe(-6);
  });

  it('uses the highest overlapping source surface when the CAM grid is coarser', () => {
    const map = depthMapToHeightmap(source([0, 255]), {
      targetWidthMm: 1,
      reliefDepthMm: 5,
      mmPerCell: 1,
    });

    expect(map.kind).toBe('ok');
    if (map.kind !== 'ok') return;
    expect(map.heightmap.widthCells).toBe(1);
    expect([...map.heightmap.depth]).toEqual([0]);
  });

  it('preserves source aspect under physical XY scaling', () => {
    const map = depthMapToHeightmap(source([0, 64, 128, 255], { width: 2, height: 2 }), {
      targetWidthMm: 10,
      reliefDepthMm: 4,
      targetScaleX: 2,
      targetScaleY: 0.5,
      mmPerCell: 1,
    });

    expect(map).toMatchObject({ kind: 'ok', widthMm: 20, heightMm: 5 });
  });

  it('rejects a sample payload whose exact byte length does not match its declaration', () => {
    const map = depthMapToHeightmap(source([0], { width: 2 }), {
      targetWidthMm: 2,
      reliefDepthMm: 5,
    });
    expect(map).toMatchObject({ kind: 'error', reason: expect.stringMatching(/length/) });
  });

  it('returns a compile-integrity error for a malformed in-memory payload type', () => {
    const malformed = { ...source([0]), samplesBase64: 7 } as unknown as ReliefDepthMap;
    const map = depthMapToHeightmap(malformed, { targetWidthMm: 1, reliefDepthMm: 1 });

    expect(map).toMatchObject({ kind: 'error', reason: expect.stringMatching(/base64 string/) });
  });
});

describe('canonicalBase64ByteLength', () => {
  it('accepts canonical padding and rejects aliases with non-zero unused bits', () => {
    expect(canonicalBase64ByteLength('AA==')).toBe(1);
    expect(canonicalBase64ByteLength('AAA=')).toBe(2);
    expect(canonicalBase64ByteLength('AB==')).toBeNull();
    expect(canonicalBase64ByteLength('AAB=')).toBeNull();
  });
});
