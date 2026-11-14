// Tools audit T1, T32-P1-1: after Prepare Stamp's Apply the source artwork
// kept burning under the stamp and engraved away the raised face the stamp
// leaves standing (54-100 % of it on main eeac725e8). Apply now keeps the
// source with Output off (ADR-570 Amendment 2). Also T32-P3-1 (the stamp
// burned as full-power dots) and rolling v3 H5-P3-3 (the stamp operation took
// the photo's import-time 10 lines/mm, not its operation's).
// The oracle is the job's own G-code, decoded here, against a per-cell face
// mask computed from the source pixels, not from the tool's face mask.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../../core/scene';
import {
  assembleBitmapAsync,
  type BitmapConversionOptions,
  type ConvertibleVector,
} from '../raster/bitmap-assembly';
import { lumaToBase64 } from '../raster/luma-bitmap';
import {
  applyStamp,
  burn,
  evenOdd,
  faceBurn,
  faceGrid,
  operation,
  stampProject,
} from './stamp-burn.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// jsdom has no workers: run the real assembly in-thread behind the transport.
vi.mock('../raster/convert-bitmap-worker-client', () => ({
  convertBitmapInWorker: (
    vectors: ReadonlyArray<ConvertibleVector>,
    options: BitmapConversionOptions,
    id: string,
  ) =>
    assembleBitmapAsync(
      vectors,
      async (raster) => ({
        dataUrl: 'data:image/png;base64,AA==',
        lumaBase64: lumaToBase64(raster.luma),
      }),
      id,
      options,
    ),
}));

beforeEach(() => resetStore());

// An asymmetric "F" and "T" photo, 30 x 15 mm at 0.1 mm pixels.
const W = 300;
const H = 150;
function photoLuma(): Uint8Array {
  const luma = new Uint8Array(W * H).fill(255);
  const dark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) luma[y * W + x] = 0;
  };
  dark(20, 20, 45, 130);
  dark(45, 20, 110, 45);
  dark(45, 65, 95, 88);
  dark(150, 20, 280, 40);
  dark(240, 40, 260, 130);
  return luma;
}
function photo(luma: Uint8Array): RasterImage {
  return {
    kind: 'raster-image',
    id: 'SRC',
    source: 'logo.png',
    pixelWidth: W,
    pixelHeight: H,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 15 },
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 30 },
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 10,
    dataUrl: 'data:image/png;base64,AA==',
    lumaBase64: lumaToBase64(luma),
    operationIds: ['SRCOP'],
  };
}

describe('Prepare Stamp Apply leaves the raised face unburned (T32-P1-1)', () => {
  it.each([true, false])('photo source, mirror %s: 0 % of the face burns', async (mirror) => {
    const luma = photoLuma();
    const before = stampProject([photo(luma)], [operation('SRCOP', 'image', { linesPerMm: 10 })]);
    const grid = faceGrid({ minX: 40, minY: 30, maxX: 70, maxY: 45 }, 0.1, (x, y) => {
      const i = Math.floor((x - 40) / 0.1);
      const j = Math.floor((y - 30) / 0.1);
      return (luma[j * W + (mirror ? W - 1 - i : i)] ?? 255) <= 127;
    });
    // Control: the source alone burns its own art, which overlaps the face.
    expect(faceBurn(burn(before), grid).burnedShare).toBeGreaterThan(0.5);
    const { after } = await applyStamp(before, ['SRC'], { mirror });
    const measured = faceBurn(burn(after), grid);
    expect(measured.burnedShare).toBeLessThan(0.01);
    // The source object is kept, with its operation's Output off.
    expect(after.scene.objects.find((object) => object.id === 'SRC')).toBeDefined();
    expect(after.scene.layers.find((layer) => layer.id === 'SRCOP')?.output).toBe(false);
  });

  it('vector source on a shared Fill: other artwork keeps burning, the source does not', async () => {
    const ring = square('RING', 20, 20, 20, 4);
    const other = square('OTHER', 80, 20, 10, 0);
    const before = stampProject([ring, other], [operation('FILL', 'fill')]);
    const rings = [rect(20, 20, 20), rect(24, 24, 12)];
    const face = faceGrid({ minX: 20, minY: 20, maxX: 40, maxY: 40 }, 0.1, (x, y) =>
      evenOdd(x, y, rings),
    );
    // Control: the Fill hatches the ring (its rows cross over half the 0.1 mm cells).
    expect(faceBurn(burn(before), face).burnedShare).toBeGreaterThan(0.5);
    const { after } = await applyStamp(before, ['RING']);
    expect(faceBurn(burn(after), face).burnedShare).toBeLessThan(0.01);
    const otherArea = faceGrid({ minX: 80, minY: 20, maxX: 90, maxY: 30 }, 0.1, () => true);
    expect(faceBurn(burn(after), otherArea).burnedShare).toBeGreaterThan(0.5);
    const fill = after.scene.layers.find((layer) => layer.id === 'FILL');
    expect(fill?.output).toBe(true);
    const copy = after.scene.layers.find((layer) => layer.name === 'FILL (stamp source)');
    expect(copy).toMatchObject({ mode: 'fill', output: false });
    expect(after.scene.objects.find((object) => object.id === 'RING')?.operationIds).toEqual([
      copy?.id,
    ]);
  });

  it('one Undo step restores the source burning exactly as before', async () => {
    const before = stampProject([photo(photoLuma())], [operation('SRCOP', 'image')]);
    await applyStamp(before, ['SRC']);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});

describe('the stamp operation burns the height map it shows', () => {
  it('Grayscale: the shoulder burns at graded power, not one full-power level (T32-P3-1)', async () => {
    const before = stampProject([photo(photoLuma())], [operation('SRCOP', 'image')]);
    const { after, stamp } = await applyStamp(before, ['SRC'], { taperMm: 1 });
    const stampOperation = after.scene.layers.find((layer) =>
      stamp.operationIds?.includes(layer.id),
    );
    expect(stampOperation?.ditherAlgorithm).toBe('grayscale');
    const levels = new Set(burn(after).map((move) => move.s));
    expect(levels.size).toBeGreaterThan(5);
  });

  it("burns at the photo operation's lines/mm, not the import-time 10 (H5-P3-3)", async () => {
    const before = stampProject(
      [photo(photoLuma())],
      [operation('SRCOP', 'image', { linesPerMm: 25 })],
    );
    const { after, stamp } = await applyStamp(before, ['SRC']);
    const stampOperation = after.scene.layers.find((layer) =>
      stamp.operationIds?.includes(layer.id),
    );
    expect(stampOperation?.linesPerMm).toBe(25);
  });
});

type Pt = { x: number; y: number };
const rect = (x0: number, y0: number, s: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x0 + s, y: y0 },
  { x: x0 + s, y: y0 + s },
  { x: x0, y: y0 + s },
  { x: x0, y: y0 },
];
function square(id: string, x: number, y: number, size: number, wall: number): SceneObject {
  const polylines = [{ points: rect(x, y, size), closed: true }];
  if (wall > 0) polylines.push({ points: rect(x + wall, y + wall, size - 2 * wall), closed: true });
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['FILL'],
    paths: [{ color: '#000000', polylines }],
  } as unknown as SceneObject;
}
