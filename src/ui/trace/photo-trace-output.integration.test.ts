import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import type { FillGroup, RasterGroup } from '../../core/job/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import {
  boundsFromColoredPaths,
  TRACE_PRESETS,
  traceImageToColoredPaths,
  type RawImageData,
} from '../../core/trace';
import {
  assembleBitmap,
  type BitmapConversionOptions,
  type ConvertibleVector,
} from '../raster/bitmap-assembly';
import { lumaToBase64 } from '../raster/luma-bitmap';
import { applyRasterizedTraceToExisting } from '../state/rasterized-trace-mutation';
import { applyTraceToExisting } from '../state/scene-mutations';
import { buildRasterTraceOutput } from './trace-raster-output';

// Exercise real geometry, placement, bitmap assembly and compiled pixel power.
// jsdom replaces only worker transport and PNG encoding, not rasterization.
vi.mock('../raster/convert-bitmap-worker-client', () => ({
  convertBitmapInWorker: (
    vectors: ReadonlyArray<ConvertibleVector>,
    options: BitmapConversionOptions,
    id: string,
  ) =>
    Promise.resolve(
      assembleBitmap(
        vectors,
        (raster) => ({
          dataUrl: 'data:image/png;base64,',
          lumaBase64: lumaToBase64(raster.luma),
        }),
        id,
        options,
      ),
    ),
}));

const TONES = [32, 80, 128, 176, 224] as const;
const WIDTH_PX = 192;
const BAND_HEIGHT_PX = 32;
const HEIGHT_PX = BAND_HEIGHT_PX * TONES.length;
const WIDTH_MM = 48;
const HEIGHT_MM = 40;
const BAND_HEIGHT_MM = HEIGHT_MM / TONES.length;
const OFFSET_MM = 10;
const BAND_INSET_MM = 2;

function toneBands(): RawImageData {
  const data = new Uint8ClampedArray(WIDTH_PX * HEIGHT_PX * 4);
  for (let y = 0; y < HEIGHT_PX; y += 1) {
    const tone = TONES[Math.floor(y / BAND_HEIGHT_PX)] ?? 255;
    for (let x = 0; x < WIDTH_PX; x += 1) {
      const offset = (y * WIDTH_PX + x) * 4;
      data.set([tone, tone, tone, 255], offset);
    }
  }
  return { width: WIDTH_PX, height: HEIGHT_PX, data };
}

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo-source',
    source: 'tonal-photo.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: WIDTH_PX,
    pixelHeight: HEIGHT_PX,
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: HEIGHT_MM },
    transform: { ...IDENTITY_TRANSFORM, x: OFFSET_MM, y: OFFSET_MM },
    color: '#000000',
    operationIds: ['photo-image'],
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function sourceProject(source: RasterImage): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' });
  return {
    ...base,
    scene: {
      objects: [source],
      layers: [createLayer({ id: 'photo-image', color: '#000000', mode: 'image' })],
    },
  };
}

async function photoTrace(image: RawImageData = toneBands()): Promise<TracedImage> {
  const preset = TRACE_PRESETS['Photo shading'];
  if (preset === undefined) throw new Error('Photo shading preset is missing');
  const paths = await traceImageToColoredPaths(image, { ...preset });
  return {
    kind: 'traced-image',
    id: 'photo-trace',
    source: 'tonal-photo.png',
    traceSourceId: 'photo-source',
    traceMode: 'filled-contours',
    tracePixelWidth: WIDTH_PX,
    tracePixelHeight: HEIGHT_PX,
    bounds: boundsFromColoredPaths(paths),
    transform: IDENTITY_TRANSFORM,
    paths,
    operationOverride: { mode: 'fill', fillStyle: 'scanline' },
  };
}

function interiorBand(y: number): number | null {
  const localY = y - OFFSET_MM;
  const band = Math.floor(localY / BAND_HEIGHT_MM);
  const withinBand = localY - band * BAND_HEIGHT_MM;
  return band >= 0 &&
    band < TONES.length &&
    withinBand >= BAND_INSET_MM &&
    withinBand < BAND_HEIGHT_MM - BAND_INSET_MM
    ? band
    : null;
}

function fillCoverage(group: FillGroup): number[] {
  const rows = new Map<number, number>();
  for (const segment of group.segments) {
    const start = segment.polyline[0];
    const end = segment.polyline.at(-1);
    if (start === undefined || end === undefined) continue;
    if (Math.abs(start.y - end.y) > 1e-8) throw new Error('Expected horizontal photo fill');
    rows.set(start.y, (rows.get(start.y) ?? 0) + Math.abs(end.x - start.x));
  }
  return TONES.map((_, band) => {
    const lengths = [...rows].filter(([y]) => interiorBand(y) === band).map(([, ink]) => ink);
    expect(lengths.length).toBeGreaterThan(20);
    return lengths.reduce((sum, ink) => sum + ink, 0) / (lengths.length * WIDTH_MM);
  });
}

function rasterCoverage(group: RasterGroup): number[] {
  const ink = TONES.map(() => 0);
  const pixels = TONES.map(() => 0);
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const physicalY =
      group.bounds.minY + ((y + 0.5) / group.pixelHeight) * (group.bounds.maxY - group.bounds.minY);
    const band = interiorBand(physicalY);
    if (band === null) continue;
    for (let x = 0; x < group.pixelWidth; x += 1) {
      pixels[band] = (pixels[band] ?? 0) + 1;
      if ((group.sValues[y * group.pixelWidth + x] ?? 0) > 0) {
        ink[band] = (ink[band] ?? 0) + 1;
      }
    }
  }
  return ink.map((value, band) => value / (pixels[band] ?? 0));
}

function expectDistinctShades(coverage: ReadonlyArray<number>): void {
  expect(coverage).toHaveLength(TONES.length);
  const measured = `Measured dark-to-light coverage: ${coverage.join(', ')}`;
  coverage.forEach((value, index) => {
    const tone = TONES[index] ?? 255;
    expect(Math.abs(value - (1 - tone / 255)), measured).toBeLessThan(0.12);
    if (index > 0) expect((coverage[index - 1] ?? 0) - value, measured).toBeGreaterThan(0.08);
  });
}

describe('Photo shading through committed output', () => {
  it('keeps pale shading when the photo is rotated and mirrored before raster conversion', async () => {
    const image = toneBands();
    for (let i = 0; i < image.data.length; i += 4) image.data.fill(240, i, i + 3);
    const source = {
      ...sourceRaster(),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90, mirrorX: true },
    };
    const project = sourceProject(source);
    const raster = await buildRasterTraceOutput(
      source,
      await photoTrace(image),
      project.scene.layers,
      true,
    );
    const luma = Array.from(atob(raster.lumaBase64 ?? ''), (value) => value.charCodeAt(0));
    expect(luma.length).toBeGreaterThan(1000);
    const mean = luma.reduce((sum, value) => sum + value, 0) / luma.length;
    expect(mean).toBeGreaterThan(238);
    expect(mean).toBeLessThan(242);
  });
  it(
    'preserves five shades as burn coverage in default horizontal vector fill',
    { timeout: 30_000 },
    async () => {
      const source = sourceRaster();
      const trace = await photoTrace();
      const committed = applyTraceToExisting(
        { project: sourceProject(source), undoStack: [] },
        source.id,
        trace,
        { deleteSourceAfterTrace: true },
      ).project;
      expect(committed.scene.layers).toHaveLength(1);
      expect(committed.scene.layers[0]).toMatchObject({
        mode: 'fill',
        fillStyle: 'scanline',
        hatchAngleDeg: 0,
        hatchSpacingMm: 0.1,
      });
      const job = compileJob(committed.scene, committed.device);
      expect(job.groups).toHaveLength(1);
      const group = job.groups[0];
      if (group?.kind !== 'fill') throw new Error('Expected photo fill output');
      expectDistinctShades(fillCoverage(group));
    },
  );

  it(
    'preserves the same shades through Raster scan assembly and compiled power',
    { timeout: 30_000 },
    async () => {
      const source = sourceRaster();
      const project = sourceProject(source);
      const trace = await photoTrace();
      const raster = await buildRasterTraceOutput(source, trace, project.scene.layers, true);
      const committed = applyRasterizedTraceToExisting(
        { project, undoStack: [] },
        source.id,
        raster,
        { deleteSourceAfterTrace: true },
      ).project;
      const job = compileJob(committed.scene, committed.device);
      expect(job.groups).toHaveLength(1);
      const group = job.groups[0];
      if (group?.kind !== 'raster') throw new Error('Expected photo raster output');
      expectDistinctShades(rasterCoverage(group));
    },
  );
});
