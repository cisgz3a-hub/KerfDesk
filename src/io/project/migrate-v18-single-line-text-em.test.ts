import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { CNC_STROKE_FONT_DATA } from '../../core/text/cnc-stroke-font-data';
import { fairStrokeFont, isPolylineDigitizedFont } from '../../core/text/fair-stroke-font';
import { renderStrokeFontText, type StrokeFont } from '../../core/text/stroke-font-text';
import { svgStrokeFont } from '../../core/text/svg-stroke-font';
import type { TextRenderResult } from '../../core/text/text-to-polylines';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

// What schema-18 writers divided Size by for each single-line font.
const LEGACY_SIZE_UNITS = [
  ['relief-single-line', 680],
  ['ems-nixish', 500],
  ['ems-decorous-script', 500],
  ['ems-casual-hand', 500],
] as const;

function text(id: string, fontKey: string, extra: Partial<TextObject> = {}): TextObject {
  return {
    kind: 'text',
    id,
    content: 'Hi\nyo',
    fontKey,
    sizeMm: 10,
    alignment: 'center',
    lineHeight: 1.4,
    letterSpacing: 0.1,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 24 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    ...extra,
  };
}

function loadAsSchema18(objects: ReadonlyArray<TextObject>): ReadonlyArray<TextObject> {
  const project = createProject();
  const raw = JSON.parse(serializeProject({ ...project, scene: { ...project.scene, objects } }));
  const result = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 18 }));
  if (result.kind !== 'ok') throw new Error(`load failed: ${JSON.stringify(result)}`);
  expect(result.project.schemaVersion).toBe(20);
  return result.project.scene.objects as ReadonlyArray<TextObject>;
}

function font(fontKey: string, unitsPerEm?: number): StrokeFont {
  const data = CNC_STROKE_FONT_DATA.find((candidate) => candidate.key === fontKey);
  if (data === undefined) throw new Error(fontKey);
  const native = svgStrokeFont(data);
  const compiled = isPolylineDigitizedFont(fontKey) ? fairStrokeFont(native) : native;
  return unitsPerEm === undefined ? compiled : { ...compiled, unitsPerEm };
}

function render(object: TextObject, strokeFont: StrokeFont): TextRenderResult {
  return renderStrokeFontText(
    {
      content: object.content,
      sizeMm: object.sizeMm,
      alignment: object.alignment,
      lineHeight: object.lineHeight,
      letterSpacing: object.letterSpacing,
      color: object.color,
    },
    strokeFont,
  );
}

function maxPointGap(a: TextRenderResult, b: TextRenderResult): number {
  const left = a.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const right = b.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  expect(right.length).toBe(left.length);
  return left.reduce((gap, point, index) => {
    const other = right[index] ?? { x: Infinity, y: Infinity };
    return Math.max(gap, Math.abs(point.x - other.x), Math.abs(point.y - other.y));
  }, 0);
}

describe('schema 19: single-line text Size becomes the em (ADR-682)', () => {
  it.each(LEGACY_SIZE_UNITS)(
    '%s keeps exactly the geometry a schema-18 build drew',
    (fontKey, legacyUnits) => {
      const before = text('t', fontKey);
      const [after] = loadAsSchema18([before]);
      if (after === undefined) throw new Error('text lost');

      const factor = 1000 / legacyUnits;
      expect(after.sizeMm).toBeCloseTo(10 * factor, 12);
      expect(after.lineHeight).toBeCloseTo(1.4 / factor, 12);
      expect(after.letterSpacing).toBeCloseTo(0.1 / factor, 12);
      // A schema-18 build divided Size by the legacy units; this build divides
      // the migrated Size by the em. Both draw the same text.
      const legacy = render(before, font(fontKey, legacyUnits));
      const current = render(after, font(fontKey));
      expect(maxPointGap(legacy, current)).toBeLessThan(1e-9);
      expect(current.anchor?.x).toBeCloseTo(legacy.anchor?.x ?? NaN, 9);
      expect(current.anchor?.y).toBeCloseTo(legacy.anchor?.y ?? NaN, 9);
    },
  );

  it('scales a frame minimum, keeps its line rule, and leaves outline text and geometry alone', () => {
    const box = {
      mode: 'fixed',
      widthMm: 40,
      heightMm: 12,
      wrap: true,
      fit: 'shrink',
      minSizeMm: 4,
    } as const;
    const relief = text('relief', 'relief-single-line', { textBox: box });
    const roboto = text('roboto', 'roboto-regular', { textBox: box });
    const [migratedRelief, migratedRoboto] = loadAsSchema18([relief, roboto]);

    expect(migratedRelief?.textBox).toEqual({
      ...box,
      minSizeMm: (4 * 1000) / 680,
      legacyLineEm: 0.68,
    });
    expect(migratedRelief?.bounds).toEqual(relief.bounds);
    expect(migratedRelief?.paths).toEqual(relief.paths);
    expect(migratedRoboto).toEqual(roboto);
  });

  // A schema-19 file was written under the em rule, by 1.0.28 or by this
  // build's step 18, so nothing in it is rescaled or given the old line rule.
  it('opens a schema-19 file without rescaling it again', () => {
    const project = createProject();
    const relief = text('relief', 'relief-single-line', {
      sizeMm: 14,
      textBox: {
        mode: 'fixed',
        widthMm: 40,
        heightMm: 12,
        wrap: true,
        fit: 'shrink',
        minSizeMm: 4,
      },
    });
    const raw = JSON.parse(
      serializeProject({ ...project, scene: { ...project.scene, objects: [relief] } }),
    );
    const result = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 19 }));

    expect(result.kind === 'ok' ? result.project.schemaVersion : null).toBe(20);
    expect(result.kind === 'ok' ? result.project.scene.objects : []).toEqual([relief]);
  });
});
