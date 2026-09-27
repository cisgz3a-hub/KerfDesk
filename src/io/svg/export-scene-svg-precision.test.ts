import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { decimalGridAtMost } from '../../core/vector-export/decimal-grid';
import { formatSvgPathData } from '../../core/vector-export/svg-path-data';
import { exportSceneSvg, type SceneSvgExportOptions } from './export-scene-svg';
import { parsePathD } from './parse-path-d';

function project(objects: readonly SceneObject[], mode: 'fill' | 'line' = 'fill'): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers: [createLayer({ id: 'layer', color: '#000000', mode })],
    },
  };
}

function artwork(curves: CurveSubpath[], transform = IDENTITY_TRANSFORM): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform,
    paths: [{ color: '#000000', polylines: [], curves }],
  };
}

function svgOf(source: Project, options?: SceneSvgExportOptions): string {
  const result = exportSceneSvg(source, undefined, options);
  if (result.kind !== 'ok') throw new Error(result.error);
  return result.value.svg;
}

function rect(x: number, y: number, w: number, h: number): CurveSubpath {
  return {
    start: { x, y },
    closed: true,
    segments: [
      { kind: 'line', to: { x: x + w, y } },
      { kind: 'line', to: { x: x + w, y: y + h } },
      { kind: 'line', to: { x, y: y + h } },
    ],
  };
}

const bulgingCubic: CurveSubpath = {
  start: { x: 0, y: 10 },
  closed: false,
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 2 }, control2: { x: 10, y: 2 }, to: { x: 10, y: 10 } },
  ],
};

function viewBoxOf(svg: string): readonly [number, number, number, number] {
  const values = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);
  return [values[0] ?? NaN, values[1] ?? NaN, values[2] ?? NaN, values[3] ?? NaN];
}

function matrixOf(svg: string): readonly [number, number, number, number, number, number] {
  const m = (/matrix\(([^)]+)\)/.exec(svg)?.[1] ?? '').split(' ').map(Number);
  return [m[0] ?? NaN, m[1] ?? NaN, m[2] ?? NaN, m[3] ?? NaN, m[4] ?? NaN, m[5] ?? NaN];
}

function firstPathData(svg: string): string {
  return /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
}

describe('artwork SVG export precision, bounds and grouping', () => {
  it('sizes the page to the exact curve extremum, not the control hull', () => {
    const svg = svgOf(project([artwork([bulgingCubic])]));
    // Peak at t = 1/2: y = 10 - 8 * 3/4 = 4; the hull would reach y = 2.
    expect(svg).toContain('width="10mm" height="6mm" viewBox="0 4 10 6"');
    const exact = svgOf(project([artwork([bulgingCubic])]), { precisionMm: null });
    expect(exact).toContain('width="10mm" height="6mm" viewBox="0 4 10 6"');
  });

  it.each([
    { edge: 500_000, scale: 0.0000254, offset: 0 },
    { edge: 0.0000004, scale: 100_000, offset: 0 },
    { edge: 500_000, scale: 4e-11, offset: 999_999 },
  ])('keeps extreme object scales within the WORLD grid ($edge x $scale)', (c) => {
    const line: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [{ kind: 'line', to: { x: c.edge, y: 1 } }],
    };
    const source = artwork([line], { ...IDENTITY_TRANSFORM, x: c.offset, scaleX: c.scale });
    const svg = svgOf(project([source], 'line'));
    const [a, , c2, , e] = matrixOf(svg);
    const xs = parsePathD(firstPathData(svg)).flatMap((s) =>
      s.points.map((p) => a * p.x + c2 * p.y + e),
    );
    expect(xs[0]).toBe(c.offset);
    // The local step is precision / scale, so the world error stays <= half a grid diagonal.
    expect(Math.abs((xs[1] ?? NaN) - (c.offset + c.edge * c.scale))).toBeLessThanOrEqual(
      0.001 * Math.SQRT1_2,
    );
  });

  it('rounds the page outward so rounded geometry stays inside it', () => {
    const tilted = artwork([rect(0.12345, 0.5, 3.33333, 1)], {
      ...IDENTITY_TRANSFORM,
      rotationDeg: 17,
    });
    const svg = svgOf(project([tilted]));
    const viewBox = viewBoxOf(svg);
    const [minX, minY, width, height] = viewBox;
    const d = firstPathData(svg);
    const radians = (17 * Math.PI) / 180;
    for (const subpath of parsePathD(d)) {
      for (const p of subpath.points) {
        const x = p.x * Math.cos(radians) - p.y * Math.sin(radians);
        const y = p.x * Math.sin(radians) + p.y * Math.cos(radians);
        expect(x).toBeGreaterThanOrEqual(minX);
        expect(y).toBeGreaterThanOrEqual(minY);
        expect(x).toBeLessThanOrEqual(minX + width + 1e-12);
        expect(y).toBeLessThanOrEqual(minY + height + 1e-12);
      }
    }
    for (const value of viewBox) expect(String(value)).toMatch(/^-?\d+(\.\d{1,3})?$/);
  });

  it('writes relative commands on the grid and full precision on request', () => {
    const source = project([artwork([rect(0.1 + 0.2, 1, 2.0000004, 3), rect(5, 5, 1, 1)])]);
    const d = (options?: SceneSvgExportOptions): string =>
      /<path d="([^"]+)"/.exec(svgOf(source, options))?.[1] ?? '';
    expect(d()).toBe('M.3 1h2v3h-2zm4.7 4h1v1h-1z');
    expect(d({ precisionMm: 0.1 })).toBe('M.3 1h2v3h-2zm4.7 4h1v1h-1z');
    expect(d({ precisionMm: null })).toBe(
      'M.30000000000000004 1L2.3000004 1 2.3000004 4 .30000000000000004 4zM5 5L6 5 6 6 5 6z',
    );
  });

  it('groups each outer contour with its direct holes', () => {
    const source = project([artwork([rect(0, 0, 10, 10), rect(20, 0, 5, 5), rect(2, 2, 3, 3)])]);
    const svg = svgOf(source, { groupContours: true });
    const groups = [...svg.matchAll(/<g><path d="([^"]+)"[^>]*fill-rule="evenodd"/g)].map(
      (match) => match[1],
    );
    expect(groups).toEqual(['M0 0h10v10h-10zm2 2h3v3h-3z', 'M20 0h5v5h-5z']);
    const outlines = svgOf(project([artwork([rect(0, 0, 10, 10), rect(2, 2, 3, 3)])], 'line'), {
      groupContours: true,
    });
    expect(outlines).toContain('<g><path d="M0 0h10v10h-10zm2 2h3v3h-3z"');
    expect(outlines).toContain('fill="none"');
  });

  it('produces path data the importer reads back to the same points', () => {
    const curves: CurveSubpath[] = [
      {
        start: { x: -1.25, y: 0.5 },
        closed: true,
        segments: [
          { kind: 'line', to: { x: 3, y: 0.5 } },
          {
            kind: 'cubic',
            control1: { x: 4, y: 0.5 },
            control2: { x: 4, y: -2 },
            to: { x: 3, y: -2.75 },
          },
          { kind: 'line', to: { x: 3, y: -4 } },
          { kind: 'line', to: { x: -0.001, y: -0.002 } },
        ],
      },
      {
        start: { x: 7, y: 7 },
        closed: false,
        segments: [{ kind: 'line', to: { x: 6.5, y: 9 } }],
      },
    ];
    const d = formatSvgPathData(curves, decimalGridAtMost(0.001));
    const back = parsePathD(d, 1e-6);
    const expected = curves.map((curve) => {
      const flat = flattenCurveSubpath(curve, { toleranceMm: 1e-6 });
      if (flat.kind !== 'ok') throw new Error('flatten failed');
      return flat.polyline.points;
    });
    expect(back.map((subpath) => subpath.closed)).toEqual([true, false]);
    back.forEach((subpath, index) => {
      const wanted = expected[index] ?? [];
      expect(subpath.points.length).toBeGreaterThan(1);
      for (const point of [subpath.points[0], subpath.points.at(-1)] as Vec2[]) {
        expect(wanted.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 1e-9)).toBe(true);
      }
    });
    expect(d).toBe('M-1.25 .5h4.25c1 0 1-2.5 0-3.25v-1.25l-3.001 3.998zm8.25 6.5l-.5 2');
  });

  it('shrinks a dense line-only trace compared with full precision', () => {
    const jagged: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: true,
      segments: Array.from({ length: 400 }, (_, i) => ({
        kind: 'line' as const,
        to: { x: (i + 1) * 0.1 + 1e-9 * i, y: (i % 2) * 0.1 + 12.3 },
      })),
    };
    const source = project([artwork([jagged])]);
    const exact = svgOf(source, { precisionMm: null }).length;
    const rounded = svgOf(source).length;
    // Relative integer steps drop the repeated absolute digits and float noise.
    expect(rounded).toBeLessThan(exact * 0.4);
  });
});
