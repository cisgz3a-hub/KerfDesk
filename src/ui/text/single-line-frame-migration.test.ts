import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Project, TextObject } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';

// Rolling audit v8 N4-P1-1 (ADR-682 Amendment 1). The fixture was saved as
// schema 18 by the parent of #1507 (0fcbe8e99, the text code 1.0.27 shipped),
// through its own buildTextObject and serializeProject. Its texts sit in
// shrink-to-fit frames that count a line as the old cap-height Size. CSV rows:
// ANNA, Anna, Hello, Maximilian, Peggy, Ågot.
const FIXTURE = 'parent-saved-single-line-text-frames';
const NAMES = ['ANNA', 'Anna', 'Hello', 'Maximilian', 'Peggy', 'Ågot'] as const;

// Width and height of each record's G-code burn in that parent build, measured
// as below when the fixture was saved.
const PARENT_RECORD_BURNS: Readonly<Record<string, Readonly<Record<string, [number, number]>>>> = {
  'relief-name-tag': {
    ANNA: [39.588, 10],
    Anna: [33.28, 9.926],
    Hello: [32.986, 10.956],
    Maximilian: [69.292, 11],
    Peggy: [34.74, 11],
    Ågot: [21.214, 11],
  },
  'casual-hand-name-tag': {
    ANNA: [29.022, 12],
    Anna: [27.148, 12],
    Hello: [19.91, 12],
    Maximilian: [42.774, 12],
    Peggy: [20.816, 11.992],
    Ågot: [13.084, 11.987],
  },
};

type Burn = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

describe('single-line text frames saved before schema 19 (N4-P1-1, ADR-682 Amendment 1)', () => {
  it('opens with each frame keeping the old line rule', () => {
    const project = opened();
    expect(project.schemaVersion).toBe(20);
    const rules = Object.fromEntries(texts(project).map((text) => [text.id, text.textBox]));
    expect(rules['relief-name-tag']).toMatchObject({ legacyLineEm: 0.68, minSizeMm: 2000 / 680 });
    expect(rules['relief-plain-anna']).toMatchObject({ legacyLineEm: 0.68 });
    expect(rules['relief-auto-height']).toMatchObject({ legacyLineEm: 0.68 });
    expect(rules['casual-hand-name-tag']).toMatchObject({ legacyLineEm: 0.5, minSizeMm: 4 });
    expect(rules['nixish-two-lines']).toMatchObject({ legacyLineEm: 0.5 });
  });

  it('redraws every text exactly as the old build drew it when it is edited', async () => {
    for (const text of texts(opened())) {
      const rebuilt = await buildTextObject({ ...text, mode: 'edit' }, dialogValues(text));
      expect(rebuilt.textBox, text.id).toEqual(text.textBox);
      expect(maxGap(rebuilt.bounds, text.bounds), text.id).toBeLessThan(1e-9);
      expect(maxPointGap(rebuilt, text), text.id).toBeLessThan(1e-9);
    }
  });

  it('burns the plain framed text 10 mm tall, as before', async () => {
    const plain = texts(opened()).find((text) => text.id === 'relief-plain-anna');
    if (plain === undefined) throw new Error('fixture text missing');
    const rebuilt = await buildTextObject({ ...plain, mode: 'edit' }, dialogValues(plain));
    const burn = await burnOf(opened(), rebuilt, null);
    expect(burn.maxX - burn.minX).toBeCloseTo(39.588, 3);
    expect(burn.maxY - burn.minY).toBeCloseTo(10, 3);
  });

  it.each(Object.keys(PARENT_RECORD_BURNS))(
    'burns every %s record at the size the old build burned it',
    async (id) => {
      const project = opened();
      const template = texts(project).find((text) => text.id === id);
      if (template === undefined) throw new Error('fixture text missing');
      for (const [index, name] of NAMES.entries()) {
        const burn = await burnOf(project, template, index);
        const [width, height] = PARENT_RECORD_BURNS[id]?.[name] ?? [NaN, NaN];
        expect(burn.maxX - burn.minX, name).toBeCloseTo(width, 3);
        expect(burn.maxY - burn.minY, name).toBeCloseTo(height, 3);
      }
    },
  );

  // ADR-682 Amendment 1. The old build left every record's ink top at the
  // frame top. Hello's l stands above the template's braces, so it rises
  // 0.46 mm over the frame top to keep that baseline.
  it('puts records on the template baseline unless their ink fills the frame', async () => {
    const project = opened();
    const template = texts(project).find((text) => text.id === 'relief-name-tag');
    if (template === undefined) throw new Error('fixture text missing');
    const frame = await burnOf(project, template, null);
    const burns = new Map<string, Burn>();
    for (const [index, name] of NAMES.entries())
      burns.set(name, await burnOf(project, template, index));
    const baseline = burns.get('ANNA')?.minY;
    expect(baseline).toBeCloseTo(frame.minY + 0.5, 3);
    expect(burns.get('Anna')?.minY).toBeCloseTo(baseline ?? NaN, 3);
    expect(burns.get('Hello')?.minY).toBeCloseTo(baseline ?? NaN, 3);
    expect(burns.get('Hello')?.maxY).toBeCloseTo(frame.maxY + 0.456, 3);
    for (const name of ['Maximilian', 'Peggy', 'Ågot']) {
      expect(burns.get(name)?.minY, name).toBeCloseTo(frame.minY, 3);
      expect(burns.get(name)?.maxY, name).toBeCloseTo(frame.maxY, 3);
    }
  });
});

function opened(): Project {
  const bytes = gunzipSync(readFileSync(resolve('src/__fixtures__', `${FIXTURE}.lf2.gz`)));
  const result = deserializeProject(bytes.toString('utf8'));
  if (result.kind !== 'ok') throw new Error(`fixture did not open: ${JSON.stringify(result)}`);
  expect(result.migratedFrom).toBe(18);
  return result.project;
}

function texts(project: Project): ReadonlyArray<TextObject> {
  return project.scene.objects.filter((object): object is TextObject => object.kind === 'text');
}

// What the text dialog starts from when it opens a text for editing.
function dialogValues(text: TextObject): DialogValues {
  return {
    content: text.content,
    fontKey: text.fontKey,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    bendDeg: text.bendDeg ?? 0,
    color: text.color,
    embeddedFonts: [],
    ...(text.weldOverlaps === undefined ? {} : { weldOverlaps: text.weldOverlaps }),
    ...(text.textBox === undefined ? {} : { textBox: text.textBox }),
    ...(text.variableTemplate === undefined ? {} : { variableTemplate: text.variableTemplate }),
  };
}

function maxGap(a: TextObject['bounds'], b: TextObject['bounds']): number {
  return Math.max(
    Math.abs(a.minX - b.minX),
    Math.abs(a.minY - b.minY),
    Math.abs(a.maxX - b.maxX),
    Math.abs(a.maxY - b.maxY),
  );
}

function maxPointGap(a: TextObject, b: TextObject): number {
  const left = a.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  const right = b.paths.flatMap((path) => path.polylines.flatMap((line) => line.points));
  expect(left.length).toBe(right.length);
  return left.reduce((gap, point, index) => {
    const other = right[index] ?? { x: Infinity, y: Infinity };
    return Math.max(gap, Math.abs(point.x - other.x), Math.abs(point.y - other.y));
  }, 0);
}

/** Burn extent of one text alone; `null` burns the text as placed. */
async function burnOf(
  project: Project,
  text: TextObject,
  recordIndex: number | null,
): Promise<Burn> {
  const { variableTemplate: _template, ...asPlaced } = text;
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects: [recordIndex === null ? asPlaced : text] } },
    {
      clock: () => new Date('2026-10-29T00:00:00Z'),
      renderVariableText,
      recordIndex: recordIndex ?? 0,
    },
  );
  if (!prepared.ok) throw new Error('output was refused');
  return burnExtent(emitPreparedGcode(prepared).gcode);
}

// Every point a G1 move burns through: its start and its end.
function burnExtent(gcode: string): Burn {
  let x = 0;
  let y = 0;
  const burn = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const include = (px: number, py: number): void => {
    burn.minX = Math.min(burn.minX, px);
    burn.maxX = Math.max(burn.maxX, px);
    burn.minY = Math.min(burn.minY, py);
    burn.maxY = Math.max(burn.maxY, py);
  };
  for (const line of gcode.split('\n')) {
    const motion = /^G([01])\b/.exec(line)?.[1];
    if (motion === undefined) continue;
    const nextX = Number(/X(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? x);
    const nextY = Number(/Y(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? y);
    if (motion === '1') {
      include(x, y);
      include(nextX, nextY);
    }
    x = nextX;
    y = nextY;
  }
  if (!Number.isFinite(burn.minX)) throw new Error('no burn moves in the G-code');
  return burn;
}
