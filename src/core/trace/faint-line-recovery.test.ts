import { describe, expect, it } from 'vitest';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { prepareTraceForContour, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

type Rect = { x: number; y: number; width: number; height: number };
const solid = { x: 8, y: 8, width: 80, height: 48 };
const interior = { x: 20, y: 20, width: 56, height: 24 };
const strokes = [150, 180, 220, 240].map((luma, index) => ({
  luma,
  x: 24,
  y: 80 + 18 * index,
  width: 132,
  height: (index % 2) + 1,
}));

function blank(luma = 255, scale = 1): RawImageData {
  const data = new Uint8ClampedArray(192 * scale * 160 * scale * 4);
  for (let i = 0; i < data.length; i += 4) data.set([luma, luma, luma, 255], i);
  return { width: 192 * scale, height: 160 * scale, data };
}
function rect(image: RawImageData, area: Rect, luma: number): void {
  for (let y = area.y; y < area.y + area.height; y += 1)
    for (let x = area.x; x < area.x + area.width; x += 1)
      image.data.set([luma, luma, luma, 255], (y * image.width + x) * 4);
}
function ink(image: RawImageData, area: Rect): number {
  let count = 0;
  for (let y = area.y; y < area.y + area.height; y += 1)
    for (let x = area.x; x < area.x + area.width; x += 1)
      if (image.data[(y * image.width + x) * 4]! < 128) count += 1;
  return count;
}
function scaled(area: Rect, scale: number): Rect {
  return {
    x: area.x * scale,
    y: area.y * scale,
    width: area.width * scale,
    height: area.height * scale,
  };
}
function artwork(scale = 1): RawImageData {
  const image = blank(255, scale);
  rect(image, scaled(solid, scale), 0);
  for (const stroke of strokes) rect(image, scaled(stroke, scale), stroke.luma);
  return image;
}

describe('explicit coherent faint-line recovery', () => {
  it.each([1, 2])(
    'retains source-scale coherence and compatible interpolation at %sx',
    (pixelScale) => {
      const image = artwork(pixelScale);
      const { prepared, crackField } = prepareTraceForContour(image, {
        ...TRACE_PRESETS['Line Art']!,
        faintLineRecovery: true,
        despeckleMinPixels: 0,
        fillPinholeCracks: false,
        pixelScale,
      });
      expect(crackField).not.toBeNull();
      for (const stroke of strokes)
        expect(ink(prepared, scaled(stroke, pixelScale))).toBe(
          stroke.width * stroke.height * pixelScale ** 2,
        );
      let mismatches = 0;
      for (let y = 0; y < image.height; y += 1)
        for (let x = 0; x < image.width; x += 1)
          if (
            crackField!.lumaAt(x, y) <= crackField!.thresholdAt(x, y) !==
            prepared.data[(y * image.width + x) * 4]! < 128
          )
            mismatches += 1;
      expect(mismatches).toBe(0);
    },
  );

  it('rejects low-amplitude paper texture', () => {
    const image = blank();
    for (let y = 0; y < image.height; y += 1)
      for (let x = 0; x < image.width; x += 1) {
        const luma = 245 + ((x * 17 + y * 31) % 11);
        image.data.set([luma, luma, luma, 255], (y * image.width + x) * 4);
      }
    const { prepared } = prepareTraceForContour(image, {
      ...TRACE_PRESETS['Line Art']!,
      faintLineRecovery: true,
    });
    expect(ink(prepared, { x: 0, y: 0, width: image.width, height: image.height })).toBe(0);
  });

  it.each(['Line Art', 'Smooth', 'Sharp', 'Centerline'])(
    '%s keeps grayscale fine strokes and solid interiors together',
    (name) => {
      const image = artwork();
      const before = image.data.slice();
      const preset = TRACE_PRESETS[name]!;
      const native = prepareTraceForContour(image, preset).prepared;
      expect(strokes.reduce((sum, stroke) => sum + ink(native, stroke), 0)).toBe(0);
      const { prepared } = prepareTraceForContour(image, { ...preset, faintLineRecovery: true });
      expect(ink(prepared, interior)).toBe(1344);
      for (const stroke of strokes)
        expect(ink(prepared, stroke)).toBe(stroke.width * stroke.height);
      expect(image.data).toEqual(before);
    },
  );

  it.each(['Line Art', 'Sharp'])('%s rejects isolated pale paper noise', (name) => {
    const image = blank();
    rect(image, solid, 0);
    const marks = Array.from({ length: 24 }, (_, index) => ({
      x: 110 + (index % 6) * 12,
      y: 20 + Math.floor(index / 6) * 18,
      width: 1,
      height: 1,
    }));
    marks.push({ x: 114, y: 110, width: 2, height: 2 }, { x: 140, y: 110, width: 3, height: 3 });
    for (const mark of marks) rect(image, mark, 180);
    const { prepared } = prepareTraceForContour(image, {
      ...TRACE_PRESETS[name]!,
      faintLineRecovery: true,
      despeckleMinPixels: 0,
    });
    expect(marks.reduce((sum, mark) => sum + ink(prepared, mark), 0)).toBe(0);
  });

  it('preserves the actual Otsu base instead of adding a fixed 128 brightness band', () => {
    const image = blank(200);
    rect(image, solid, 0);
    const mark = { x: 120, y: 80, width: 2, height: 2 };
    rect(image, mark, 120);
    const preset = TRACE_PRESETS['Sharp']!;
    const native = prepareTraceForContour(image, preset).prepared;
    const { prepared } = prepareTraceForContour(image, { ...preset, faintLineRecovery: true });
    expect(ink(native, mark)).toBe(0);
    expect(ink(prepared, mark)).toBe(0);
    expect(ink(prepared, interior)).toBe(1344);
  });

  it('keeps alpha interpretation ahead of faint-line detection', () => {
    const image = artwork();
    image.data[3] = 0;
    const options = {
      ...TRACE_PRESETS['Line Art']!,
      traceTransparency: true,
      sourceHasTransparency: true,
    };
    expect(prepareTraceForContour(image, { ...options, faintLineRecovery: true })).toEqual(
      prepareTraceForContour(image, options),
    );
  });

  it.each(['Line Art', 'Sharp'])(
    '%s generated vectors retain the recovered fine strokes',
    async (name) => {
      const image = artwork();
      const paths = await traceImageToColoredPaths(image, {
        ...TRACE_PRESETS[name]!,
        faintLineRecovery: true,
      });
      const raster = rasterizeColoredPaths(paths, image.width, image.height);
      for (const stroke of strokes) {
        let selected = 0;
        for (let y = stroke.y; y < stroke.y + stroke.height; y += 1)
          for (let x = stroke.x; x < stroke.x + stroke.width; x += 1)
            if (raster.data[y * image.width + x] === 1) selected += 1;
        expect(selected).toBeGreaterThanOrEqual(stroke.width * stroke.height * 0.98);
      }
    },
  );
});
