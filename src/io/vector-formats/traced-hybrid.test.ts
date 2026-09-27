import { describe, expect, it } from 'vitest';
import { traceImagesToVectorFiles } from '../../core/trace/batch-trace';
import { tracedLayers } from '../../core/trace/batch-trace-svg';
import { fittedPageBox } from '../../core/trace/traced-page-box';
import { traceHybridPaths } from '../../core/trace/hybrid/trace-hybrid';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { RawImageData } from '../../core/trace/trace-image';
import { writeTracedDrawing } from './traced-drawing';

// A real thin pen ring and separate solid rectangle exercise both paint roles.
function ringAndBlock(): RawImageData {
  const width = 160;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ring = Math.abs(Math.hypot(x + 0.5 - 50, y + 0.5 - 50) - 25) < 1.5;
      const block = x >= 110 && x < 150 && y >= 20 && y < 80;
      const value = ring || block ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe('Multi-File Line + fill export', () => {
  it.each(['image', 'artwork'] as const)(
    'keeps the closed pen ring stroked and the solid block filled on the %s page',
    async (fit) => {
      const image = ringAndBlock();
      const preset = TRACE_PRESETS['Line + fill'];
      if (preset === undefined) throw new Error('Line + fill preset missing');
      const options = { ...preset, hybridMaxStrokeWidthPx: 4 };
      const paths = traceHybridPaths(image, options);
      expect(
        paths.some((path) => path.color === '#0000ff' && path.curves?.some((c) => c.closed)),
      ).toBe(true);
      const written: Record<string, string> = {};
      for (const format of ['svg', 'pdf', 'eps', 'geojson'] as const) {
        const batch = await traceImagesToVectorFiles(
          [
            {
              sourceName: 'ring.png',
              image,
              options,
              physicalSizeMm: { widthMm: 16, heightMm: 10 },
            },
          ],
          { trace: async () => paths, writeDrawing: writeTracedDrawing },
          { format, page: { fit } },
        );
        written[format] = batch.files[0]?.text ?? '';
      }
      const svg = new DOMParser().parseFromString(written['svg'] ?? '', 'image/svg+xml');
      expect(svg.querySelector('path[stroke="#0000ff"][fill="none"]')).not.toBeNull();
      expect(svg.querySelector('path[fill="#0000ff"]')).toBeNull();
      expect(svg.querySelector('path[fill="#000000"]')).not.toBeNull();
      expect(written['pdf']).toContain('\nS\n');
      expect(written['pdf']).toContain('\nf*\n');
      expect(written['eps']).toContain('\nstroke\n');
      expect(written['eps']).toContain('\neofill\n');
      const geo = JSON.parse(written['geojson'] ?? '{}') as {
        features: { properties: { color: string; paint: string }; geometry: { type: string } }[];
      };
      expect(geo.features.filter((f) => f.properties.color === '#0000ff')).toMatchObject([
        { properties: { paint: 'stroke' }, geometry: { type: 'LineString' } },
      ]);
      expect(geo.features.filter((f) => f.properties.color === '#000000')).toMatchObject([
        { properties: { paint: 'fill' }, geometry: { type: 'Polygon' } },
      ]);
    },
  );

  it('includes the closed hybrid stroke hairline when fitting its page', () => {
    const page = {
      pixelWidth: 100,
      pixelHeight: 100,
      physicalSizeMm: { widthMm: 10, heightMm: 10 },
    };
    const layers = tracedLayers(
      [
        {
          color: '#0000ff',
          polylines: [
            {
              closed: true,
              points: [
                { x: 20, y: 20 },
                { x: 80, y: 20 },
                { x: 80, y: 80 },
                { x: 20, y: 80 },
              ],
            },
          ],
        },
      ],
      page,
      'hybrid',
    );
    expect(fittedPageBox(layers, page, 'hybrid', 0, 0.001)).toEqual({
      minX: 1.95,
      minY: 1.95,
      maxX: 8.05,
      maxY: 8.05,
    });
  });
});
