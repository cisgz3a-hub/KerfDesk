import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type TextAlignment,
  type TextObject,
} from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import type { PreparedOutput } from '../../io/gcode/prepare-output';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { emitPreparedRdFile } from '../../io/rd/emit-rd';
import { tiledCncProject } from '../app/save-tiled-gcode-testing';
import { finalizeTiledOutput } from '../app/tiled-output-preparation';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { inspectPreparedStart } from '../laser/start-job-prepared-inspection';
import { buildTextObject } from './build-text-object';
import { outputTextRenderer } from './output-text-renderer';
import type { DialogValues } from './use-text-dialog-fields';
import { advisoryMessages, burnFrom, type Burn } from './variable-text-frame-testing';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Rolling audit v9 R4 (ADR-682 Amendment 2, ADR-591 Amendment 3). Every number is read from the
// emitted burn moves. A text placed at X 100, Y 50 has its frame's left edge at X 100 and its top
// at Y 350.
const PLACED = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
const FRAME_TOP = 350;
const TEMPLATE = '{{csv:name}}';
const SHRINK: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 80,
  heightMm: 11,
  wrap: true,
  fit: 'shrink',
  minSizeMm: 2,
};
const NOW = new Date('2026-11-02T00:00:00Z');

describe('a record the shared baseline would take out of its frame (R4-P1-1)', () => {
  const casualTag = (patch: Partial<DialogValues> = {}): Promise<TextObject> =>
    text({ fontKey: 'ems-casual-hand', alignment: 'center', textBox: SHRINK, ...patch });

  it('refits Casual Hand “Gypsy” to about Size 7.56, inside the 80 × 11 frame', async () => {
    const burn = await burnOf(await casualTag(), 0, ['Gypsy']);
    // It burned 3.552 mm below the frame on main, at its full 10.68 mm.
    expect(burn.minY).toBeGreaterThanOrEqual(FRAME_TOP - 11 - 0.002);
    expect(burn.maxY).toBeLessThanOrEqual(FRAME_TOP + 0.002);
    expect((burn.maxY - burn.minY) / 10.68).toBeCloseTo(7.56 / 10, 2);
  });

  it('warns about nothing, because the record now fits', async () => {
    const prepared = await preparedFor(await casualTag(), 0, ['Gypsy']);
    expect(advisoryMessages(prepared)).toEqual([]);
  });

  it('leaves names without descenders at full size, on one baseline', async () => {
    const tag = await casualTag();
    const anna = await burnOf(tag, 0, ['Anna', 'Al']);
    const al = await burnOf(tag, 1, ['Anna', 'Al']);
    expect(anna.maxY - anna.minY).toBeCloseTo(8.185, 2);
    expect(anna.minY).toBeCloseTo(al.minY, 3);
  });

  it.each<TextAlignment>(['left', 'center', 'right'])(
    'keeps a refit record on the %s alignment point',
    async (alignment) => {
      const burn = await burnOf(await casualTag({ alignment }), 0, ['Gypsy']);
      if (alignment === 'left') expect(burn.minX).toBeCloseTo(100, 1);
      if (alignment === 'center') expect((burn.minX + burn.maxX) / 2).toBeCloseTo(140, 1);
      if (alignment === 'right') expect(burn.maxX).toBeCloseTo(180, 1);
    },
  );

  it('refits a record on two lines by the same rule', async () => {
    const burn = await burnOf(await casualTag({ textBox: { ...SHRINK, heightMm: 26 } }), 0, [
      'Gypsy\nGypsy',
    ]);
    expect(burn.maxY).toBeLessThanOrEqual(FRAME_TOP + 0.002);
    expect(burn.minY).toBeGreaterThanOrEqual(FRAME_TOP - 26 - 0.002);
  });

  it('does not resize a frame without Shrink to fit, and warns instead', async () => {
    const tag = await casualTag({ textBox: { ...SHRINK, heightMm: 12.2, fit: 'none' } });
    const prepared = await preparedFor(tag, 0, ['Gypsy']);
    const burn = burnFrom(prepared);
    expect(burn.maxY - burn.minY).toBeCloseTo(10.68, 2);
    expect(advisoryMessages(prepared)).toEqual([
      expect.stringMatching(/^Variable text “Gypsy” \(CSV record 1\): overflows its frame by/),
    ]);
  });

  it('warns when the frame’s smallest size stops the refit', async () => {
    const tag = await casualTag({ textBox: { ...SHRINK, minSizeMm: 9.5 } });
    const prepared = await preparedFor(tag, 0, ['Gypsy']);
    expect(burnFrom(prepared).minY).toBeLessThan(FRAME_TOP - 11);
    expect(advisoryMessages(prepared)[0]).toContain('overflows its frame');
  });
});

describe('variable records in an Auto width frame take the template’s alignment (R4-P1-2)', () => {
  const AUTO: TextBoxSettings = { ...SHRINK, mode: 'auto-width', wrap: false, fit: 'none' };
  const NAMES = ['Al', 'Anna', 'Maximilian'];

  it.each([
    ['center', (burn: Burn) => (burn.minX + burn.maxX) / 2],
    ['right', (burn: Burn) => burn.maxX],
    ['left', (burn: Burn) => burn.minX],
  ] as const)('%s', async (alignment, point) => {
    const tag = await text({ alignment, textBox: AUTO });
    const template = await burnOf(tag, null, NAMES);
    for (const [index, name] of NAMES.entries()) {
      const burn = await burnOf(tag, index, NAMES);
      // Main left a centred Al 23.63 mm off and a right-aligned one 47.26 mm off.
      expect(point(burn), name).toBeCloseTo(point(template), 1);
    }
  });

  it('holds for a single-line font', async () => {
    const tag = await text({ alignment: 'center', fontKey: 'relief-single-line', textBox: AUTO });
    const template = await burnOf(tag, null, NAMES);
    const al = await burnOf(tag, 0, NAMES);
    expect((al.minX + al.maxX) / 2).toBeCloseTo((template.minX + template.maxX) / 2, 1);
  });

  it('holds for a record on two lines', async () => {
    const tag = await text({ alignment: 'center', textBox: AUTO });
    const template = await burnOf(tag, null, ['Al\nAnna']);
    const record = await burnOf(tag, 0, ['Al\nAnna']);
    expect((record.minX + record.maxX) / 2).toBeCloseTo((template.minX + template.maxX) / 2, 1);
  });

  it('holds for a turned text', async () => {
    const tag = await text({ alignment: 'center', textBox: AUTO });
    const turned = { ...tag, transform: { ...PLACED, rotationDeg: 90 } };
    const template = await burnOf(turned, null, NAMES);
    const al = await burnOf(turned, 0, NAMES);
    expect((al.minY + al.maxY) / 2).toBeCloseTo((template.minY + template.maxY) / 2, 1);
  });

  it('never warns of overflow: the frame is each record’s own width', async () => {
    const tag = await text({ alignment: 'center', textBox: AUTO });
    const prepared = await preparedFor(tag, 2, NAMES);
    expect(advisoryMessages(prepared)).toEqual([]);
  });

  // Controls: these modes were already right, and stay so.
  it.each([
    ['fixed', { ...SHRINK, heightMm: 20 }],
    ['fixed, wrapped', { ...SHRINK, heightMm: 40, widthMm: 30, fit: 'none' as const }],
    ['Auto height', { ...SHRINK, mode: 'auto-height' as const, fit: 'none' as const }],
  ])('a %s frame still centres on the frame', async (_mode, textBox) => {
    const tag = await text({ alignment: 'center', textBox });
    const al = await burnOf(tag, 0, NAMES);
    expect((al.minX + al.maxX) / 2).toBeCloseTo(100 + textBox.widthMm / 2, 1);
  });
});

describe('a record that overflows its frame says so at output (R4-P2-1)', () => {
  const WRAPPED: TextBoxSettings = {
    mode: 'fixed',
    widthMm: 30,
    heightMm: 10,
    wrap: true,
    fit: 'none',
    minSizeMm: 2,
  };
  const LONG = ['Maximilian Alexander'];
  const WARNING =
    'Variable text “Maximilian Alexander” (CSV record 1): overflows its frame by 33.3 mm. It still burns in full.';
  const overflowing = async (): Promise<PreparedOutput> =>
    preparedFor(await text({ textBox: WRAPPED }), 0, LONG);

  it('names the record and the distance past the frame bottom', async () => {
    const prepared = await overflowing();
    expect(FRAME_TOP - 10 - burnFrom(prepared).minY).toBeCloseTo(33.3, 1);
    expect(advisoryMessages(prepared)).toEqual([WARNING]);
  });

  it('measures past the side of a frame without wrap', async () => {
    const tag = await text({ textBox: { ...WRAPPED, wrap: false } });
    const prepared = await preparedFor(tag, 0, LONG);
    expect(burnFrom(prepared).maxX - 130).toBeCloseTo(64.54, 1);
    expect(advisoryMessages(prepared)[0]).toContain('overflows its frame by 64.5 mm');
  });

  it('measures past the side at the frame’s smallest size', async () => {
    const tag = await text({
      textBox: { ...WRAPPED, wrap: false, fit: 'shrink', minSizeMm: 5 },
    });
    expect(advisoryMessages(await preparedFor(tag, 0, LONG))[0]).toContain('overflows its frame');
  });

  it('counts a record rising over the frame top (ADR-682 Amendment 1 D4)', async () => {
    const tag = await text({ textBox: { ...SHRINK, heightMm: 20 } });
    const prepared = await preparedFor(tag, 0, ['Ågot']);
    expect(advisoryMessages(prepared)[0]).toContain('overflows its frame by 1.7 mm');
  });

  it('counts only the sides of an Auto height frame', async () => {
    const tag = await text({ textBox: { ...WRAPPED, mode: 'auto-height' } });
    expect(advisoryMessages(await preparedFor(tag, 0, LONG))).toEqual([]);
  });

  it('stays quiet for a record that fits', async () => {
    const tag = await text({ textBox: { ...SHRINK, heightMm: 20 } });
    expect(advisoryMessages(await preparedFor(tag, 0, ['Anna']))).toEqual([]);
  });

  it('stays quiet for a bent record, which has no frame', async () => {
    const tag = await text({ bendDeg: 40 });
    expect(advisoryMessages(await preparedFor(tag, 0, LONG))).toEqual([]);
  });

  it('stays quiet for a record on a path, which has no frame', async () => {
    const tag = await text({
      pathText: { guideObjectId: GUIDE.id, offsetMm: 0, reverse: false },
      pathGuide: GUIDE,
    });
    const prepared = await prepareOutputSnapshot(project(tag, LONG, [GUIDE]), {
      clock: () => NOW,
      renderVariableText: outputTextRenderer,
      recordIndex: 0,
    });
    expect(advisoryMessages(prepared)).toEqual([]);
  });

  it('reaches Start', async () => {
    const inspected = inspectPreparedStart(await overflowing(), {} as MachineStartSnapshot);
    expect(inspected.ok && inspected.advisoryWarnings).toContain(WARNING);
  });

  it('reaches Save G-code', async () => {
    const saved = emitSavePreparedOutput(await overflowing(), {});
    expect(saved.kind === 'emitted' && saved.machineWarnings).toContain(WARNING);
  });

  it('reaches .rd', async () => {
    const prepared = await overflowing();
    const rd = emitPreparedRdFile(prepared, {});
    expect(rd.ok && rd.advisories).toContainEqual({
      code: 'variable-text-overflow',
      message: WARNING,
    });
  });

  it('reaches tiled G-code', async () => {
    const cnc = tiledCncProject();
    const layer = cnc.scene.layers[0];
    if (layer === undefined) throw new Error('fixture layer missing');
    const tag = { ...(await text({ textBox: WRAPPED })), color: layer.color };
    const prepared = await prepareOutputSnapshot(
      {
        ...cnc,
        variables: project(tag, LONG).variables,
        scene: { ...cnc.scene, objects: [tag] },
      } as Project,
      { clock: () => NOW, renderVariableText: outputTextRenderer, recordIndex: 0 },
    );
    const tiled = finalizeTiledOutput(prepared, null, null, null);
    expect(tiled.kind === 'ready' && tiled.preparationAdvisories).toContain(WARNING);
  });
});

async function text(patch: Partial<DialogValues>): Promise<TextObject> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
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
      variableTemplate: { tokens: [] },
      ...patch,
    },
  );
  return patch.pathText === undefined ? { ...built, transform: PLACED } : built;
}

const GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'guide.svg',
  bounds: { minX: 0, minY: 0, maxX: 200, maxY: 0 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 100 },
  paths: [
    {
      color: '#0000ff',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
        },
      ],
    },
  ],
};

function project(
  design: TextObject,
  names: ReadonlyArray<string>,
  extra: ReadonlyArray<SceneObject> = [],
): Project {
  return {
    ...createProject(),
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'names.csv', headers: ['name'], records: names.map((name) => [name]) },
    },
    scene: {
      objects: [design, ...extra],
      layers: [{ ...createLayer({ id: design.color, color: design.color }), mode: 'line' }],
      groups: [],
    },
  };
}

function preparedFor(
  design: TextObject,
  recordIndex: number,
  names: ReadonlyArray<string>,
): Promise<PreparedOutput> {
  return prepareOutputSnapshot(project(design, names), {
    clock: () => NOW,
    renderVariableText: outputTextRenderer,
    recordIndex,
  });
}

/** Burn extent; `null` emits the text as placed, the template itself. */
async function burnOf(
  design: TextObject,
  recordIndex: number | null,
  names: ReadonlyArray<string>,
): Promise<Burn> {
  const { variableTemplate: _template, ...asPlaced } = design;
  const object = recordIndex === null ? asPlaced : design;
  return burnFrom(await preparedFor(object, recordIndex ?? 0, names));
}
