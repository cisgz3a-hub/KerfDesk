// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIT_PHOTO_ASSETS } from './bit-photo-assets';
import { findTutorial } from './tutorial-catalog';
import { TUTORIAL_PHOTO_ASSETS } from './tutorial-photo-assets';
import { TUTORIAL_PHOTOS, tutorialPhotoUrl } from './tutorial-photos';

const IMAGE_ROOT = resolve(process.cwd(), 'public/tutorial-images');
const EXPECTED_BINDINGS = {
  registration: 'registration',
  'laser-cut': 'laser-line',
  'laser-fill': 'laser-fill',
  'laser-image': 'raster',
  'cnc-pocket': 'pocket',
  'cnc-vcarve': 'vcarve',
  box: 'box-result',
  'cnc-profile': 'profile-tabs',
  'cnc-tabs': 'profile-tabs',
} as const;

describe('tutorial picture assets', () => {
  it.each(Object.entries(BIT_PHOTO_ASSETS))(
    '%s has compact square WebP variants with correct hashes and dimensions',
    (id, asset) => {
      for (const [variant, width, budget] of [
        [asset.small, 320, 8 * 1024],
        [asset.large, 640, 16 * 1024],
      ] as const) {
        const bytes = readFileSync(join(IMAGE_ROOT, variant.file));
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
        expect(variant.file).toBe(`${id}-${width}-${digest}.webp`);
        expect(bytes.byteLength).toBe(variant.bytes);
        expect(bytes.byteLength).toBeLessThanOrEqual(budget);
        expect(webpDimensions(bytes)).toEqual({ width, height: width });
        expect(variant.width).toBe(width);
        expect(variant.height).toBe(width);
      }
    },
  );

  it.each(Object.entries(TUTORIAL_PHOTO_ASSETS))(
    '%s has real WebP variants matching dimensions, byte counts, hashes and transfer budgets',
    (id, asset) => {
      expect([1, 3]).toContain(asset.frames);
      for (const [variant, width, budget] of [
        [asset.small, 480, 32 * 1024],
        [asset.large, 960, 100 * 1024],
      ] as const) {
        const bytes = readFileSync(join(IMAGE_ROOT, variant.file));
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
        expect(variant.file).toBe(`${id}-${width}-${digest}.webp`);
        expect(bytes.byteLength).toBe(variant.bytes);
        expect(bytes.byteLength).toBeLessThanOrEqual(budget);
        expect(webpDimensions(bytes)).toEqual({ width: variant.width, height: variant.height });
        expect(variant.width).toBe(width);
        // Each cropped storyboard frame must fill the viewport's 2:1 aspect ratio.
        expect(variant.height).toBe((width / 2) * asset.frames);
        expect(tutorialPhotoUrl(variant.file)).toBe(
          `${import.meta.env.BASE_URL}tutorial-images/${variant.file}`,
        );
        expect(tutorialPhotoUrl(variant.file)).not.toMatch(/^(?:data|blob):/u);
      }
    },
  );

  it('binds each reviewed physical example to a real lesson and matching storyboard frame metadata', () => {
    expect(Object.keys(TUTORIAL_PHOTOS).sort()).toEqual(Object.keys(EXPECTED_BINDINGS).sort());
    const usedAssets = new Set<unknown>();
    for (const [id, assetId] of Object.entries(EXPECTED_BINDINGS)) {
      const tutorial = findTutorial(id);
      const photo = TUTORIAL_PHOTOS[id];
      if (tutorial === undefined || photo === undefined) throw new Error(`Missing binding: ${id}`);
      expect(photo.asset, id).toBe(TUTORIAL_PHOTO_ASSETS[assetId]);
      expect(photo.frames.length, id).toBe(photo.asset.frames);
      expect(new Set(photo.frames.map((frame) => frame.label)).size, id).toBe(photo.frames.length);
      usedAssets.add(photo.asset);
      for (const frame of photo.frames) {
        expect(frame.label.trim(), id).not.toBe('');
        expect(frame.caption.trim().length, id).toBeGreaterThan(20);
        expect(frame.alt.trim().length, id).toBeGreaterThan(20);
      }
      for (const step of tutorial.steps) {
        if (step.examplePhase !== undefined) expect([0, 1, 2], id).toContain(step.examplePhase);
      }
    }
    expect(usedAssets).toEqual(new Set(Object.values(TUTORIAL_PHOTO_ASSETS)));
  });

  it('ships only the referenced responsive files and keeps generated source frame counts aligned', () => {
    const expectedFiles = [
      ...Object.values(TUTORIAL_PHOTO_ASSETS),
      ...Object.values(BIT_PHOTO_ASSETS),
    ].flatMap((asset) => [asset.small.file, asset.large.file]);
    expect(readdirSync(IMAGE_ROOT).sort()).toEqual(expectedFiles.sort());
    const bitSources = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/tutorials/bit-image-sources.json'), 'utf8'),
    ) as readonly { readonly id: string }[];
    expect(bitSources.map((source) => source.id).sort()).toEqual(
      Object.keys(BIT_PHOTO_ASSETS).sort(),
    );
    const sources = JSON.parse(
      readFileSync(resolve(process.cwd(), 'docs/tutorials/generated-image-sources.json'), 'utf8'),
    ) as readonly { readonly id: string; readonly frames: number }[];
    expect(sources.map((source) => source.id).sort()).toEqual(
      Object.keys(TUTORIAL_PHOTO_ASSETS).sort(),
    );
    for (const [id, asset] of Object.entries(TUTORIAL_PHOTO_ASSETS))
      expect(sources.find((source) => source.id === id)?.frames, id).toBe(asset.frames);
  });
});

type Dimensions = { readonly width: number; readonly height: number };

// Read actual headers, independently of the generated manifest. Format references:
// https://developers.google.com/speed/webp/docs/riff_container
// https://datatracker.ietf.org/doc/html/rfc6386#section-9.1
// https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
function webpDimensions(bytes: Buffer): Dimensions {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.byteLength);
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    expect(start + length).toBeLessThanOrEqual(bytes.byteLength);
    const dimensions = imageChunkDimensions(type, bytes.subarray(start, start + length));
    if (dimensions !== undefined) return dimensions;
    offset = start + length + (length % 2);
  }
  throw new Error('WebP has no supported image dimensions');
}

function imageChunkDimensions(type: string, data: Buffer): Dimensions | undefined {
  if (type === 'VP8X') {
    expect(data[0]! & 2).toBe(0); // Storyboard files are static, not animated WebP.
    return { width: data.readUIntLE(4, 3) + 1, height: data.readUIntLE(7, 3) + 1 };
  }
  if (type === 'VP8 ') {
    expect(data.subarray(3, 6)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
    return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff };
  }
  if (type === 'VP8L') {
    expect(data[0]).toBe(0x2f);
    const packed = data.readUInt32LE(1);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  return undefined;
}
