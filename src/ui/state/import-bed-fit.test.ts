import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// The default project bed is 400 x 400 mm.
const BED_MM = 400;

function svgArt(id: string, widthMm: number, heightMm: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: widthMm, y: heightMm },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

function rasterArt(id: string, widthMm: number, heightMm: number): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function placedBox(id: string) {
  const object = useStore.getState().project.scene.objects.find((o) => o.id === id);
  if (object === undefined) throw new Error(`${id} was not imported`);
  return transformedBBox(object);
}

function expectInsideBed(id: string): void {
  const box = placedBox(id);
  expect(box.minX).toBeGreaterThanOrEqual(0);
  expect(box.minY).toBeGreaterThanOrEqual(0);
  expect(box.maxX).toBeLessThanOrEqual(BED_MM);
  expect(box.maxY).toBeLessThanOrEqual(BED_MM);
}

beforeEach(resetStore);
afterEach(resetStore);

describe('fresh import sizing', () => {
  it('keeps 400 mm art at 400 mm on a 400 mm bed, centered, with no scale report', () => {
    const outcome = useStore.getState().importSvgObject(svgArt('full', 400, 250));

    expect(outcome).toEqual({ kind: 'added' });
    expect(placedBox('full')).toEqual({ minX: 0, minY: 75, maxX: 400, maxY: 325 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('keeps 390 mm art at 390 mm', () => {
    const outcome = useStore.getState().importSvgObject(svgArt('near', 390, 100));
    const box = placedBox('near');

    expect(outcome).toEqual({ kind: 'added' });
    expect(box.maxX - box.minX).toBe(390);
    expect(box.maxY - box.minY).toBe(100);
    expectInsideBed('near');
  });

  it('scales 1000 mm art uniformly into the bed and reports the scale', () => {
    const outcome = useStore.getState().importSvgObject(svgArt('huge', 1000, 500));
    const box = placedBox('huge');

    expect(outcome.kind).toBe('added');
    if (outcome.kind !== 'added') return;
    expect(outcome.bedFit).toMatchObject({
      widthMm: 1000,
      heightMm: 500,
      bedWidthMm: BED_MM,
      bedHeightMm: BED_MM,
    });
    expect(outcome.bedFit?.scale).toBeCloseTo(0.36);
    expect(box.maxX - box.minX).toBeCloseTo(360);
    expect(box.maxY - box.minY).toBeCloseTo(180);
    expectInsideBed('huge');
  });

  it('lets one Undo restore the original size and a second remove the import', () => {
    useStore.getState().importSvgObject(svgArt('huge', 1000, 500));

    useStore.getState().undo();
    const restored = placedBox('huge');
    expect(restored.maxX - restored.minX).toBe(1000);
    expect(restored.maxY - restored.minY).toBe(500);
    expect((restored.minX + restored.maxX) / 2).toBe(BED_MM / 2);
    expect(useStore.getState().selectedObjectId).toBe('huge');

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);

    useStore.getState().redo();
    useStore.getState().redo();
    expect(placedBox('huge').maxX - placedBox('huge').minX).toBeCloseTo(360);
  });

  it('keeps the multi-import stagger when it scales oversize art', () => {
    useStore.getState().importSvgObject(svgArt('first', 1000, 1000), 0);
    useStore.getState().importSvgObject(svgArt('second', 1000, 1000), 1);

    expect(placedBox('second').minX - placedBox('first').minX).toBeCloseTo(10);
    expect(placedBox('second').minY - placedBox('first').minY).toBeCloseTo(10);
  });

  it('applies the same rule to bitmaps and reports the scale', () => {
    const kept = useStore.getState().importRasterImage(rasterArt('photo-fits', 400, 300));
    const scaled = useStore.getState().importRasterImage(rasterArt('photo-big', 1422.4, 1066.8));

    expect(kept).toEqual({ kind: 'added' });
    expect(placedBox('photo-fits').maxX - placedBox('photo-fits').minX).toBe(400);
    expect(scaled.kind === 'added' ? scaled.bedFit?.scale : undefined).toBeCloseTo(
      (0.9 * BED_MM) / 1422.4,
    );
    expectInsideBed('photo-big');
  });
});
