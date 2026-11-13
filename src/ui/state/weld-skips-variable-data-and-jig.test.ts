// @vitest-environment jsdom
// Tools audit T1, T28 Weld (ADR-350 Amendment 1):
// - T28-P1-1: welding variable text burned its template glyphs ("SN {{serial:4}}")
//   on every record. Weld now leaves variable text and variable barcodes as they
//   are, says why, and welds the rest.
// - T28-P2-1: Select All then Weld merged jig artwork with its copies in other
//   boxes, so the jig's piece-by-piece runs (4) fell to 0. Weld now leaves the
//   registration jig alone.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBarcodeObject, defaultBarcodeSpec } from '../../core/barcode';
import { registrationJigCompilationRuns } from '../../core/job/registration-jig-compilation-runs';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_PROJECT_VARIABLE_DATA,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import { createRegistrationBox } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { textToPolylines } from '../../core/text';
import { parseVariableTemplateSource } from '../../core/variables';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import {
  prepareOutputSnapshot,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';
import { selectionCanCombine, selectionCanWeld } from '../commands/selection-command-state';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { burnMoves, litLength, litMoves, type LitMove } from './weld-burn-test-helpers';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function load(project: Project, selected: ReadonlyArray<string>): void {
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
    redoStack: [],
  });
}

function projectOf(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  serialValue = 42,
): Project {
  const base = createProject();
  return {
    ...base,
    variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue },
    scene: { ...base.scene, objects: [...objects], layers: [...layers], groups: [] },
  };
}

const lineOp = (id: string, speed: number, power: number): Layer => ({
  ...createLayer({ id, color: '#000000', name: id, mode: 'line' }),
  speed,
  power,
});

const rect = (id: string, w: number, h: number, x: number, y: number, op: string): SceneObject =>
  ({
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: w, heightMm: h, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y },
    }),
    operationIds: [op],
  }) as SceneObject;

const burn = burnMoves;

// ---- variable text ------------------------------------------------------
const roboto = (() => {
  const bytes = readFileSync('src/ui/text/fonts/Roboto-Regular.ttf');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
})();

const renderer: VariableTextRenderer = ({ text, content }) =>
  textToPolylines({
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
    fontBuffer: roboto,
  });

async function variableText(): Promise<TextObject> {
  const parsed = parseVariableTemplateSource('SN {{serial:4}}');
  if (!parsed.ok) throw new Error(parsed.message);
  const base = {
    kind: 'text',
    id: 'VT',
    content: 'SN {{serial:4}}',
    variableTemplate: parsed.template,
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
    paths: [],
    operationIds: ['L'],
  } as unknown as TextObject;
  // The stored outlines are the template glyphs, as the editor renders them.
  const glyphs = await renderer({ text: base, content: base.content, project: createProject() });
  return { ...base, bounds: glyphs.bounds, paths: glyphs.paths } as TextObject;
}

async function snapshotBurn(project: Project): Promise<ReadonlyArray<LitMove>> {
  const prepared = await prepareOutputSnapshot(project, {
    clock: () => new Date(0),
    renderVariableText: renderer,
  });
  if (!prepared.ok) throw new Error('snapshot failed');
  return litMoves(emitPreparedGcode(prepared).gcode, project.device);
}

const maxX = (moves: ReadonlyArray<LitMove>) => Math.max(...moves.map((move) => move.maxX));

describe('Weld leaves variable data as it is (T28-P1-1)', () => {
  it('welds the shapes beside variable text, and the text still burns each record', async () => {
    const text = await variableText();
    // A bar crossing the S, and two overlapping squares to weld.
    const bar = rect('BAR', 8, 1.5, 48, 53.5, 'L');
    const a = rect('A', 10, 10, 10, 10, 'L');
    const b = rect('B', 10, 10, 15, 10, 'L');
    const project = projectOf([text, bar, a, b], [lineOp('L', 1234, 37)]);
    load(project, ['VT', 'BAR', 'A', 'B']);

    st().weldSelection();

    const after = st().project;
    const kept = after.scene.objects.find((object) => object.id === 'VT');
    expect(kept?.kind).toBe('text');
    expect((kept as TextObject).variableTemplate).toBeDefined();
    expect(after.scene.objects.some((object) => object.id === 'A')).toBe(false);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text: use Bake Variable Text/);

    // Oracle: the burn ends where the rendered value "SN 0042" ends, not
    // where the template's braces end, and it moves on with the serial.
    const value = await renderer({ text, content: 'SN 0042', project });
    const textMoves = (moves: ReadonlyArray<LitMove>) => moves.filter((move) => move.maxX > 45);
    const burned42 = textMoves(await snapshotBurn(after));
    expect(maxX(burned42)).toBeCloseTo(50 + value.bounds.maxX, 2);
    expect(maxX(burned42)).toBeLessThan(50 + text.bounds.maxX - 5);
    const burned43 = textMoves(
      await snapshotBurn({
        ...after,
        variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, ...after.variables, serialValue: 43 },
      }),
    );
    expect(litLength(burned43)).not.toBeCloseTo(litLength(burned42), 3);
  });

  it('disables Weld for variable text alone, and the store refuses it with the notice', async () => {
    const project = projectOf([await variableText()], [lineOp('L', 1234, 37)]);
    load(project, ['VT']);
    expect(selectionCanWeld(project, ['VT'])).toBe(false);
    expect(selectionCanWeld(project, ['VT'], 'variable')).toBe(false);

    // Weld, Offset outlines and Dogbone each leave it and say why.
    for (const run of [
      () => st().weldSelection(),
      () => st().offsetSelection(1),
      () => st().dogboneSelection(3),
    ]) {
      useToastStore.setState({ toasts: [] });
      run();
      expect(st().project).toBe(project);
      expect(toasts().join(' ')).toMatch(/Bake Variable Text/);
    }
  });

  it('leaves a variable barcode out of Weld and the Booleans', async () => {
    const parsed = parseVariableTemplateSource('LOT-{{serial:3}}');
    if (!parsed.ok) throw new Error(parsed.message);
    const created = await createBarcodeObject({
      id: 'BC',
      color: '#000000',
      spec: {
        ...defaultBarcodeSpec('code128'),
        moduleMm: 0.3,
        data: 'LOT-{{serial:3}}',
        variableTemplate: parsed.template,
      },
      value: 'LOT-041',
      renderCaption: async () => ({
        polylines: [],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      }),
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    });
    if (!created.ok) throw new Error(created.message);
    const barcode = { ...created.object, operationIds: ['L'] } as SceneObject;
    const tab = rect('TAB', 8, 6, 18, 22, 'L');
    const project = projectOf([barcode, tab], [lineOp('L', 3000, 40)], 41);
    load(project, ['BC', 'TAB']);
    expect(selectionCanCombine(project, ['BC', 'TAB'])).toBe(false);

    st().weldSelection();

    expect(st().project.scene.objects.find((object) => object.id === 'BC')).toBe(barcode);
    expect(toasts().join(' ')).toMatch(/A variable barcode was left as it is/);
  });
});

describe('Weld leaves the registration jig as it is (T28-P2-1)', () => {
  const BOX_A = 'box-a';
  const BOX_B = 'box-b';

  function jigProject(locked: boolean): Project {
    const boxes = [BOX_A, BOX_B].map((id, index) => ({
      ...createRegistrationBox({ id, widthMm: 60, heightMm: 60, x: 10 + index * 80, y: 10 }),
      ...(locked ? { locked: true } : {}),
    }));
    const art1 = rect('ART1', 16, 16, 20, 20, 'art');
    const art2 = rect('ART2', 16, 16, 28, 26, 'art');
    const eng = rect('ENG', 6, 6, 30, 50, 'eng');
    const copies = [art1, art2, eng].map((source) => ({
      ...source,
      id: registrationJigCopyId(source.id, BOX_B),
      transform: { ...source.transform, x: source.transform.x + 80 },
    }));
    // Two ordinary overlapping squares outside the jig.
    const free = [rect('F1', 10, 10, 200, 10, 'art'), rect('F2', 10, 10, 205, 10, 'art')];
    return projectOf(
      [...boxes, art1, art2, eng, ...copies, ...free],
      [
        { ...createRegistrationLayer(), output: false },
        lineOp('eng', 1111, 10),
        lineOp('art', 2222, 90),
      ],
    );
  }

  // The runs a job compiles for one jig piece each; the free pair runs apart.
  function jigRuns(project: Project): number {
    const free = new Set(['F1', 'F2']);
    return (registrationJigCompilationRuns(project.scene) ?? []).filter((run) =>
      run.vectorObjects.every((object) => !free.has(object.id) && !object.id.startsWith('welded')),
    ).length;
  }

  // The burn order by feed and box: piece by piece is F1111@A, F2222@A, F1111@B, …
  function runOrder(project: Project): ReadonlyArray<string> {
    return burn(project).reduce<string[]>((order, move) => {
      if (move.maxX > 190) return order;
      const tag = `F${move.feed}@${move.maxX < 85 ? 'A' : 'B'}`;
      if (order.at(-1) !== tag) order.push(tag);
      return order;
    }, []);
  }

  it.each([
    ['unlocked outlines (after Unlock All)', false],
    ['locked outlines (as the jig editor saves them)', true],
  ])('Select All then Weld keeps the jig runs and order, with %s', (_label, locked) => {
    const project = jigProject(locked);
    load(project, []);
    st().selectAllObjects();
    const runsBefore = jigRuns(project);
    const orderBefore = runOrder(project);
    expect(runsBefore).toBe(4);
    expect(orderBefore).toEqual(['F1111@A', 'F2222@A', 'F1111@B', 'F2222@B']);

    st().weldSelection();

    const after = st().project;
    expect(findRegistrationBoxes(after.scene)).toHaveLength(2);
    expect(jigRuns(after)).toBe(runsBefore);
    expect(runOrder(after)).toEqual(orderBefore);
    // The ordinary pair outside the jig still welds: 2 × 40 mm → 50 mm outline.
    expect(after.scene.objects.some((object) => object.id === 'F1')).toBe(false);
    expect(litLength(burn(after).filter((move) => move.maxX > 190))).toBeCloseTo(50, 3);
    expect(toasts().join(' ')).toMatch(/registration jig was left as it is/);
  });

  it('disables Weld for jig artwork and its copies alone', () => {
    const project = jigProject(true);
    const jigArt = ['ART1', 'ART2', registrationJigCopyId('ART1', BOX_B)];
    expect(selectionCanWeld(project, jigArt)).toBe(false);
    // Offset outlines adds a new object and keeps the jig, so it stays available.
    expect(selectionCanWeld(project, jigArt, 'variable')).toBe(true);
  });
});
