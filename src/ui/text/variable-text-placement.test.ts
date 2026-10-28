import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type PathTextSettings,
  type Project,
  type SceneObject,
  type TextAlignment,
  type TextObject,
} from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Rolling audit v7 L3. Every number is read from the emitted burn moves.
const PLACED = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
const TEMPLATE = '{{csv:name}}';

type Burn = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

describe('Size is the em for every font (L3-P1-1, L3-P2-1, ADR-682)', () => {
  // The H's own height in each font, in em units: Roboto's OS/2 cap height
  // 1456/2048, Relief's 680/1000, and the EMS H paths measured from the pinned
  // sources by an independent reader (rolling v7 L3 refuter).
  it.each([
    ['roboto-regular', 7.109],
    ['relief-single-line', 6.8],
    ['ems-nixish', 6.585],
    ['ems-decorous-script', 6.8],
    ['ems-casual-hand', 8.754],
  ])('a Size 10 H in %s burns its own height in a 10 mm em', async (fontKey, heightMm) => {
    const burn = await burnOf(await text({ content: 'H', fontKey }), null, []);
    expect(burn.maxY - burn.minY).toBeCloseTo(heightMm, 1);
    expect(burn.maxY - burn.minY).toBeLessThan(10);
  });

  it('keeps two lines of EMS Casual Hand apart at the default line height', async () => {
    const burn = await burnOf(
      await text({ content: 'H\nH', fontKey: 'ems-casual-hand', lineHeight: 1.4 }),
      null,
      [],
    );
    // One H is 8.75 mm tall and the lines are 14 mm apart, so two leave a gap.
    expect(burn.maxY - burn.minY).toBeLessThan(14 + 8.76);
    expect(burn.maxY - burn.minY).toBeGreaterThan(14 + 8.75 - 0.01);
  });
});

describe('variable records keep the template’s placement in G-code', () => {
  // L3-P1-2: before the fix these burned 17 to 23 mm off the template centre.
  it.each([
    ['bent 60°', { bendDeg: 60 }],
    ['bent -60°', { bendDeg: -60 }],
    ['bent 60° without distortion', { bendDeg: 60, textStyle: { bendUndistorted: true } }],
  ] as const)('centres %s records where the template is centred', async (_label, patch) => {
    const design = await text({ alignment: 'center', ...patch });
    // Rows of H are symmetric about their own centre, so their ink centre is
    // the anchor; real names differ by their ink at each end (up to 1.7 mm
    // for "Al" on so tight an arc).
    const rows = ['H', 'HHH', 'HHHHHHHHH'];
    const placed = await burnOf(design, null, rows);
    for (const recordIndex of rows.keys()) {
      const record = await burnOf(design, recordIndex, rows);
      expect(Math.abs(centreX(record) - centreX(placed))).toBeLessThan(0.01);
    }
    const names = ['Al', 'anna', 'Maximilian Alexander'];
    for (const recordIndex of names.keys()) {
      const record = await burnOf(design, recordIndex, names);
      expect(Math.abs(centreX(record) - centreX(placed))).toBeLessThan(2);
    }
  });

  it('keeps every record’s middle glyph on the template’s arc in a rigid bend', async () => {
    const design = await text({
      alignment: 'center',
      bendDeg: 60,
      textStyle: { bendUndistorted: true },
    });
    // The middle H is upright at the top of the arc, so its top is the
    // highest burn and sits one capital height above the shared anchor.
    const rows = ['H', 'HHH', 'HHHHHHHHH'];
    const tops = await Promise.all(
      rows.map(async (_row, recordIndex) => (await burnOf(design, recordIndex, rows)).maxY),
    );
    for (const top of tops) expect(top).toBeCloseTo(tops[0] ?? NaN, 3);
  });

  // L3-P2-5: names with and without capitals burned 1.7 to 2.4 mm apart.
  it('puts boxed records on one baseline and keeps a shrunk one inside its frame', async () => {
    const box: TextBoxSettings = {
      mode: 'fixed',
      widthMm: 80,
      heightMm: 20,
      wrap: true,
      fit: 'shrink',
      minSizeMm: 2,
    };
    const names = ['Al', 'Ana', 'anna', 'A very long name that the frame must shrink to fit'];
    const design = await text({ alignment: 'center', textBox: box });
    const placed = await burnOf(design, null, names);
    const [al, ana, anna, long] = await Promise.all(
      names.map((_name, recordIndex) => burnOf(design, recordIndex, names)),
    );
    if (al === undefined || ana === undefined || anna === undefined || long === undefined)
      throw new Error('a record did not burn');
    // "A" and "l" stand on the baseline; the bowl of "a" dips 0.1 mm below it.
    expect(Math.abs(ana.minY - anna.minY)).toBeLessThan(0.001);
    expect(Math.abs(al.minY - ana.minY)).toBeLessThan(0.15);
    // The frame still centres each record across its width.
    for (const record of [al, ana, anna, long])
      expect(Math.abs(centreX(record) - centreX(placed))).toBeLessThan(0.001);
    // The long name shrinks, so it keeps the frame's rule: ink top at the
    // frame top, everything inside the 20 mm frame.
    expect(long.maxY).toBeCloseTo(placed.maxY, 3);
    expect(long.minY).toBeGreaterThan(placed.maxY - 20);
  });

  it('lays path records on the template’s baseline, descenders below it', async () => {
    const names = ['Anna', 'Peggy'];
    const design = await text({
      alignment: 'left',
      pathText: { guideObjectId: GUIDE.id, offsetMm: 0, reverse: false },
      pathGuide: GUIDE,
    });
    const [anna, peggy] = await Promise.all(
      names.map((_name, recordIndex) => burnOf(design, recordIndex, names)),
    );
    // Both capitals reach the same height above the guide; Peggy's
    // descenders hang below Anna's baseline instead of lifting her line.
    expect(Math.abs((anna?.maxY ?? NaN) - (peggy?.maxY ?? NaN))).toBeLessThan(0.001);
    expect(peggy?.minY ?? NaN).toBeLessThan((anna?.minY ?? NaN) - 1.5);
  });
});

// A straight 150 mm guide, so "above" means a higher G-code Y.
const GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 150, maxY: 0 },
  transform: { ...IDENTITY_TRANSFORM, x: 20, y: 100 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 150, y: 0 },
          ],
        },
      ],
    },
  ],
};

async function text(
  patch: Partial<DialogValues> & {
    readonly pathText?: PathTextSettings;
    readonly alignment?: TextAlignment;
  },
): Promise<TextObject> {
  const values: DialogValues = {
    content: TEMPLATE,
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000000',
    embeddedFonts: [],
    weldOverlaps: false,
    ...(patch.content === undefined || patch.content === TEMPLATE
      ? { variableTemplate: { tokens: [] } }
      : {}),
    ...patch,
  };
  const built = await buildTextObject({ mode: 'add' }, values);
  return values.pathText === undefined ? { ...built, transform: PLACED } : built;
}

/** Burn extent; `null` emits the text as placed, the template itself. */
async function burnOf(
  design: TextObject,
  recordIndex: number | null,
  names: ReadonlyArray<string>,
): Promise<Burn> {
  const { variableTemplate: _template, ...asPlaced } = design;
  const object = recordIndex === null ? asPlaced : design;
  const prepared = await prepareOutputSnapshot(project(object, names), {
    clock: () => new Date('2026-10-28T00:00:00Z'),
    renderVariableText,
    recordIndex: recordIndex ?? 0,
  });
  if (!prepared.ok) throw new Error('output was refused');
  return burnExtent(emitPreparedGcode(prepared).gcode);
}

function project(text: TextObject, names: ReadonlyArray<string>): Project {
  const guide = text.pathText === undefined ? [] : [GUIDE];
  return {
    ...createProject(),
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'names.csv', headers: ['name'], records: names.map((name) => [name]) },
    },
    scene: {
      objects: [text, ...guide],
      // Only the text's colour burns; a guide on another colour stays out.
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}

// Every point a G1 move burns through: its start (where the last move left
// the head) and its end.
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

function centreX(burn: Burn): number {
  return (burn.minX + burn.maxX) / 2;
}
