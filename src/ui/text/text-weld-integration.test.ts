import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob, type CutSegment } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../../core/scene';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';

vi.mock('./font-loader', () => ({
  loadFont: async (key: string) => {
    const { readFile } = await import('node:fs/promises');
    const name = key === 'pacifico-regular' ? 'Pacifico-Regular' : 'DancingScript-Regular';
    const bytes = await readFile(`src/ui/text/fonts/${name}.ttf`);
    return Uint8Array.from(bytes).buffer;
  },
}));

const GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'guide.svg',
  bounds: { minX: 0, minY: 0, maxX: 200, maxY: 20 },
  transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 20 },
            { x: 100, y: 0 },
            { x: 200, y: 20 },
          ],
        },
      ],
    },
  ],
};

function values(overrides: Partial<DialogValues> = {}): DialogValues {
  return {
    content: 'my',
    fontKey: 'dancing-script-regular',
    sizeMm: 20,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000000',
    embeddedFonts: [],
    weldOverlaps: true,
    ...overrides,
  };
}

function cutSegments(text: TextObject): readonly CutSegment[] {
  const job = compileJob(
    { objects: [text], layers: [createLayer({ id: 'line', color: text.color })] },
    DEFAULT_DEVICE_PROFILE,
  );
  return job.groups.flatMap((group) => (group.kind === 'cut' ? group.segments : []));
}

function perimeter(points: readonly Vec2[], closed: boolean): number {
  return points.reduce((length, point, index) => {
    const previous = points[index - 1] ?? (closed ? points.at(-1) : undefined);
    return previous === undefined
      ? length
      : length + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function inkAt(paths: readonly ColoredPath[], point: Vec2): boolean {
  let inside = false;
  for (const line of paths.flatMap((path) => path.polylines)) {
    for (let i = 0, j = line.points.length - 1; i < line.points.length; j = i++) {
      const a = line.points[i]!;
      const b = line.points[j]!;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  }
  return inside;
}

describe('editable text overlap welding integration', () => {
  it.each(['dancing-script-regular', 'pacifico-regular'])(
    '%s removes the internal my joins from both editable geometry and Line compilation',
    async (fontKey) => {
      const raw = await buildTextObject({ mode: 'add' }, values({ fontKey, weldOverlaps: false }));
      const welded = await buildTextObject({ mode: 'edit', ...raw }, values({ fontKey }));
      const outlines = welded.paths.flatMap((path) => path.polylines);
      const compiled = cutSegments(welded);
      const rawCompiled = cutSegments(raw);

      expect(welded).toMatchObject({
        kind: 'text',
        id: raw.id,
        content: 'my',
        fontKey,
        sizeMm: 20,
        weldOverlaps: true,
      });
      expect(raw.paths.some((path) => (path.curves?.length ?? 0) > 0)).toBe(true);
      expect(outlines.length).toBeLessThan(rawCompiled.length);
      expect(compiled).toHaveLength(outlines.length);
      expect(compiled.every((segment) => segment.closed)).toBe(true);
      const outputLength = compiled.reduce(
        (sum, segment) => sum + perimeter(segment.polyline, false),
        0,
      );
      const outlineLength = outlines.reduce(
        (sum, line) => sum + perimeter(line.points, line.closed),
        0,
      );
      const rawLength = rawCompiled.reduce(
        (sum, segment) => sum + perimeter(segment.polyline, false),
        0,
      );
      expect(outputLength).toBeCloseTo(outlineLength, 3);
      expect(outputLength).toBeLessThan(rawLength - 1);
    },
  );

  it.each(['dancing-script-regular', 'pacifico-regular'])(
    '%s retains the empty centres in boo',
    async (fontKey) => {
      const raw = await buildTextObject(
        { mode: 'add' },
        values({ fontKey, content: 'boo', weldOverlaps: false }),
      );
      const welded = await buildTextObject({ mode: 'add' }, values({ fontKey, content: 'boo' }));
      const rings = raw.paths.flatMap((path) => path.polylines);
      // Each counter centre is inside its own ring but outside the glyph ink.
      const centres = rings
        .map((line) => ({
          x: line.points.reduce((sum, p) => sum + p.x, 0) / line.points.length,
          y: line.points.reduce((sum, p) => sum + p.y, 0) / line.points.length,
        }))
        .filter((point) => !inkAt(raw.paths, point));

      expect(centres.length).toBeGreaterThanOrEqual(3);
      expect(centres.every((point) => !inkAt(welded.paths, point))).toBe(true);
      expect(welded.paths.flatMap((path) => path.polylines).length).toBeLessThan(rings.length);
    },
  );

  it.each(['bend', 'path'] as const)(
    'reapplies the stored weld choice when variable content is rendered on a %s',
    async (placement) => {
      const placed =
        placement === 'bend'
          ? { bendDeg: 40 }
          : {
              pathGuide: GUIDE,
              pathText: { guideObjectId: GUIDE.id, offsetMm: 4, reverse: false },
            };
      const project = createProject();
      const withGuide = { ...project, scene: { ...project.scene, objects: [GUIDE] } };
      const contourCounts: number[] = [];
      for (const weldOverlaps of [true, false]) {
        const text = await buildTextObject({ mode: 'add' }, values({ ...placed, weldOverlaps }));
        const variable: TextObject = {
          ...text,
          content: '{{csv:name}}',
          variableTemplate: { tokens: [{ kind: 'csv', column: 'name' }] },
        };
        const before = JSON.stringify(variable);
        const rendered = await renderVariableText({
          text: variable,
          content: 'boo',
          project: withGuide,
        });
        const expected = await buildTextObject(
          { mode: 'add' },
          values({ ...placed, content: 'boo', weldOverlaps }),
        );

        expect(rendered.paths).toEqual(expected.paths);
        expect(rendered.bounds).toEqual(expected.bounds);
        if (placement === 'path') expect(rendered.transform).toEqual(expected.transform);
        expect(JSON.stringify(variable)).toBe(before);
        expect(variable.variableTemplate?.tokens).toEqual([{ kind: 'csv', column: 'name' }]);
        const compiled = cutSegments({ ...variable, ...rendered });
        expect(compiled).toHaveLength(expected.paths.flatMap((path) => path.polylines).length);
        contourCounts.push(compiled.length);
      }
      expect(contourCounts[0]).toBeLessThan(contourCounts[1]!);
    },
  );

  it('keeps legacy text without the weld setting unchanged during variable rendering', async () => {
    const raw = await buildTextObject({ mode: 'add' }, values({ weldOverlaps: false }));
    const { weldOverlaps, ...legacy } = raw;
    const rendered = await renderVariableText({
      text: legacy,
      content: 'my',
      project: createProject(),
    });

    expect(weldOverlaps).toBe(false);
    expect(rendered.paths).toEqual(raw.paths);
    expect(cutSegments({ ...legacy, ...rendered })).toEqual(cutSegments(raw));
  });

  it('keeps native single-line strokes intact even when welding is requested', async () => {
    const raw = await buildTextObject(
      { mode: 'add' },
      values({ fontKey: 'ems-nixish', weldOverlaps: false }),
    );
    const welded = await buildTextObject({ mode: 'add' }, values({ fontKey: 'ems-nixish' }));
    const rendered = await renderVariableText({
      text: welded,
      content: 'my',
      project: createProject(),
    });

    expect(welded.paths).toEqual(raw.paths);
    expect(rendered.paths).toEqual(raw.paths);
    expect(welded.paths.flatMap((path) => path.polylines).some((line) => !line.closed)).toBe(true);
  });
});
