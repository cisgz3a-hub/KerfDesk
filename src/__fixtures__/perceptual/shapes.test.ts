import { describe, expect, it } from 'vitest';
import type { RawImageData } from '../../core/trace';
import { PERCEPTUAL_FIXTURES } from './shapes';
import type { PerceptualFixture } from './shapes';

const RGBA_CHANNELS = 4;
const PAPER = 255;

function imageIsInk(image: RawImageData, x: number, y: number): boolean {
  return (image.data[(y * image.width + x) * RGBA_CHANNELS] ?? PAPER) === 0;
}

function truthCount(fixture: PerceptualFixture): number {
  let count = 0;
  for (const v of fixture.truth.data) count += v;
  return count;
}

function byName(name: string): PerceptualFixture {
  const found = PERCEPTUAL_FIXTURES.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no fixture named ${name}`);
  return found;
}

describe('PERCEPTUAL_FIXTURES', () => {
  it('exposes the expected named fixtures', () => {
    expect(PERCEPTUAL_FIXTURES.map((f) => f.name)).toEqual([
      'solid-square',
      'filled-disc',
      'ring-annulus',
      'plus-stroke',
      'square-glyph',
    ]);
  });

  // The load-bearing invariant: the ground-truth mask must equal exactly the
  // set of black pixels in the source. If this drifts, every IoU measured
  // against these fixtures is meaningless.
  it.each(PERCEPTUAL_FIXTURES)('$name: source is binary and truth matches its ink', (fixture) => {
    const { image, truth, width, height } = fixture;
    expect(image.data).toHaveLength(width * height * RGBA_CHANNELS);
    expect(truth.data).toHaveLength(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = (y * width + x) * RGBA_CHANNELS;
        const r = image.data[base] ?? PAPER;
        const g = image.data[base + 1] ?? PAPER;
        const b = image.data[base + 2] ?? PAPER;
        const a = image.data[base + 3] ?? PAPER;
        // Pure black or pure white, fully opaque, greyscale.
        expect(a).toBe(255);
        expect(r === g && g === b).toBe(true);
        expect(r === 0 || r === 255).toBe(true);
        // Truth bit agrees with the rendered ink.
        expect(truth.data[y * width + x] === 1).toBe(imageIsInk(image, x, y));
      }
    }
  });
});

describe('fixture ground-truth areas', () => {
  it('solid-square inks exactly the 64×64 interior', () => {
    // rect(32,32,96,96): pixel centres in [32,96] are x,y ∈ [32,95] = 64.
    expect(truthCount(byName('solid-square'))).toBe(64 * 64);
  });

  it('plus-stroke inks exactly its two bars minus the overlap', () => {
    // 16×96 vertical + 96×16 horizontal − 16×16 shared core.
    expect(truthCount(byName('plus-stroke'))).toBe(16 * 96 + 96 * 16 - 16 * 16);
  });

  it('square-glyph inks the wall but not the hole', () => {
    // 72×72 outer − 24×24 hole.
    const glyph = byName('square-glyph');
    expect(truthCount(glyph)).toBe(72 * 72 - 24 * 24);
    // Dead centre is inside the hole → background.
    expect(glyph.truth.data[64 * glyph.width + 64]).toBe(0);
  });

  it('filled-disc inks approximately πr²', () => {
    const area = Math.PI * 48 * 48;
    const count = truthCount(byName('filled-disc'));
    expect(count).toBeGreaterThan(area * 0.97);
    expect(count).toBeLessThan(area * 1.03);
  });

  it('ring-annulus inks approximately π(R²−r²) and leaves the hole empty', () => {
    const ringArea = Math.PI * (50 * 50 - 26 * 26);
    const ring = byName('ring-annulus');
    const count = truthCount(ring);
    expect(count).toBeGreaterThan(ringArea * 0.96);
    expect(count).toBeLessThan(ringArea * 1.04);
    // Centre well inside the inner radius is background.
    expect(ring.truth.data[64 * ring.width + 64]).toBe(0);
  });
});
