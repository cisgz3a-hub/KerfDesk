// @vitest-environment jsdom
// Tools audit T1, T29 Union Silhouette and T30 Join Paths (ADR-350 Amendment 2):
// - T29-P1-1 / T30-P1-1: both rebuilt variable text from its stored template
//   glyphs, so every record burned "SN {{serial:4}}" and the serial stopped
//   changing. Join reached it in every bundled single-line font, because it
//   closes loops inside the template glyphs. They now leave variable text and
//   variable barcodes as they are, say why, and edit the rest, as Weld does.
// - T29-P2-1: Union merged box A's jig artwork into one silhouette while box B
//   still burned both outlines. Union and Join now leave the jig alone.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { registrationJigCompilationRuns } from '../../core/job/registration-jig-compilation-runs';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_PROJECT_VARIABLE_DATA,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Project,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import { createRegistrationBox } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { FONT_REGISTRY } from '../../core/text/font-registry';
import { textToPolylines } from '../../core/text';
import { parseVariableTemplateSource } from '../../core/variables';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import {
  prepareOutputSnapshot,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';
import { renderVariableText } from '../text/render-variable-text';
import { computeTextGeometry } from '../text/text-geometry-compute';
import {
  selectionCanJoinPaths,
  unionSilhouetteOperations,
} from '../commands/selection-command-state';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { burnMoves, litLength, litMoves, type LitMove } from './weld-burn-test-helpers';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);
const ids = (project: Project) => project.scene.objects.map((object) => object.id);
const maxX = (moves: ReadonlyArray<LitMove>) => Math.max(...moves.map((move) => move.maxX));

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

function projectOf(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  const base = createProject();
  return {
    ...base,
    variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 42 },
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

// Two strokes 0.01 mm apart, which Join closes into one path.
function strokes(id: string, x: number, y: number): ImportedSvg {
  const line = (points: ReadonlyArray<{ x: number; y: number }>) => ({ closed: false, points });
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['L'],
    paths: [
      {
        color: '#000000',
        polylines: [
          line([
            { x, y },
            { x: x + 10, y },
          ]),
          line([
            { x: x + 10.01, y },
            { x: x + 10, y: y + 10 },
          ]),
        ],
      },
    ],
  };
}

async function snapshotBurn(
  project: Project,
  renderer: VariableTextRenderer,
  serialValue = 42,
): Promise<ReadonlyArray<LitMove>> {
  const prepared = await prepareOutputSnapshot(
    {
      ...project,
      variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, ...project.variables, serialValue },
    },
    { clock: () => new Date(0), renderVariableText: renderer },
  );
  if (!prepared.ok) throw new Error('snapshot failed');
  return litMoves(emitPreparedGcode(prepared).gcode, project.device);
}

// ---- Union Silhouette: outline font ------------------------------------
const roboto = (() => {
  const bytes = readFileSync('src/ui/text/fonts/Roboto-Regular.ttf');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
})();

const robotoRenderer: VariableTextRenderer = ({ text, content }) =>
  textToPolylines({
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
    fontBuffer: roboto,
  });

async function robotoVariableText(): Promise<TextObject> {
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
  const glyphs = await robotoRenderer({
    text: base,
    content: base.content,
    project: createProject(),
  });
  return { ...base, bounds: glyphs.bounds, paths: glyphs.paths } as TextObject;
}

describe('Union Silhouette leaves variable text as it is (T29-P1-1)', () => {
  it('Select All unions the shapes beside variable text, which still burns each record', async () => {
    const text = await robotoVariableText();
    const bar = rect('BAR', 8, 1.5, 48, 53.5, 'L');
    const a = rect('A', 10, 10, 10, 10, 'L');
    const b = rect('B', 10, 10, 15, 10, 'L');
    const project = projectOf([text, bar, a, b], [lineOp('L', 1234, 37)]);
    load(project, []);
    st().selectAllObjects();
    const selected = [...st().additionalSelectedIds, st().selectedObjectId ?? ''];
    expect(unionSilhouetteOperations(project.scene, selected).map((op) => op.id)).toEqual(['L']);

    expect(st().unionSilhouetteSelection('L')).toBe(true);

    const after = st().project;
    expect(after.scene.objects.find((object) => object.id === 'VT')).toBe(text);
    expect(ids(after).some((id) => id === 'A' || id === 'BAR')).toBe(false);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text: use Bake Variable Text/);

    // Oracle: the burn ends where the rendered value "SN 0042" ends, not where
    // the template's braces end, and it moves on with the serial.
    const value = await robotoRenderer({ text, content: 'SN 0042', project });
    const textMoves = (moves: ReadonlyArray<LitMove>) => moves.filter((move) => move.maxX > 45);
    const burned42 = textMoves(await snapshotBurn(after, robotoRenderer));
    expect(maxX(burned42)).toBeCloseTo(50 + value.bounds.maxX, 2);
    expect(maxX(burned42)).toBeLessThan(50 + text.bounds.maxX - 5);
    const burned43 = textMoves(await snapshotBurn(after, robotoRenderer, 43));
    expect(litLength(burned43)).not.toBeCloseTo(litLength(burned42), 3);
  });

  it('disables Union for variable text alone, and the store refuses it with the notice', async () => {
    const project = projectOf([await robotoVariableText()], [lineOp('L', 1234, 37)]);
    load(project, ['VT']);
    expect(unionSilhouetteOperations(project.scene, ['VT'])).toEqual([]);

    expect(st().unionSilhouetteSelection('L')).toBe(false);

    expect(st().project).toBe(project);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });
});

// ---- Join Paths: every bundled single-line font -------------------------
const SINGLE_LINE_FONTS = FONT_REGISTRY.filter((font) => font.geometry === 'single-line').map(
  (font) => font.key,
);

async function singleLineVariableText(fontKey: string): Promise<TextObject> {
  const content = 'SN {{serial:4}}';
  const parsed = parseVariableTemplateSource(content);
  if (!parsed.ok) throw new Error(parsed.message);
  const style = { sizeMm: 8, alignment: 'left', lineHeight: 1.2, letterSpacing: 0 } as const;
  // A single-line font has no outline file to parse.
  const noOutline = () => Promise.reject(new Error('single-line fonts have no outline file'));
  const geometry = await computeTextGeometry(
    { fontKey, content, color: '#000000', ...style },
    undefined,
    noOutline,
  );
  return {
    kind: 'text',
    id: 'VT',
    content,
    fontKey,
    ...style,
    color: '#000000',
    variableTemplate: parsed.template,
    bounds: geometry.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 30 },
    paths: geometry.paths,
    operationIds: ['L'],
  } as unknown as TextObject;
}

describe('Join Paths leaves variable text as it is (T30-P1-1)', () => {
  it('covers all four bundled single-line fonts', () => {
    expect(SINGLE_LINE_FONTS).toHaveLength(4);
  });

  it.each(SINGLE_LINE_FONTS)('%s: Join refuses variable text alone', async (fontKey) => {
    const text = await singleLineVariableText(fontKey);
    const project = projectOf([text], [lineOp('L', 3000, 30)]);
    load(project, ['VT']);
    expect(selectionCanJoinPaths(project, ['VT'])).toBe(false);

    expect(st().joinSelectedPaths(0.05)).toBe(false);

    expect(st().project).toBe(project);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text: use Bake Variable Text/);
  });

  it.each(SINGLE_LINE_FONTS)(
    '%s: Join beside variable text keeps its burned value',
    async (fontKey) => {
      const text = await singleLineVariableText(fontKey);
      const project = projectOf([strokes('ART', 0, 0), text], [lineOp('L', 3000, 30)]);
      load(project, ['ART', 'VT']);
      expect(selectionCanJoinPaths(project, ['ART', 'VT'])).toBe(true);

      expect(st().joinSelectedPaths(0.05)).toBe(true);

      const after = st().project;
      expect(after.scene.objects.find((object) => object.id === 'VT')).toBe(text);
      expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
      // Oracle: the value's own render, not the template's 'SN {{serial:4}}'.
      const value = await renderVariableText({ text, content: 'SN 0042', project });
      const textMoves = (moves: ReadonlyArray<LitMove>) => moves.filter((move) => move.maxX > 25);
      const burned = textMoves(await snapshotBurn(after, renderVariableText));
      expect(maxX(burned)).toBeCloseTo(30 + value.bounds.maxX, 1);
      expect(maxX(burned)).toBeLessThan(30 + text.bounds.maxX - 5);
      const burned43 = textMoves(await snapshotBurn(after, renderVariableText, 43));
      expect(litLength(burned43)).not.toBeCloseTo(litLength(burned), 3);
    },
  );
});

// ---- Union and the registration jig (T29-P2-1) --------------------------
describe('Union Silhouette leaves the registration jig as it is (T29-P2-1)', () => {
  const BOX_A = 'box-a';
  const BOX_B = 'box-b';

  function jigProject(locked: boolean): Project {
    const boxes = [BOX_A, BOX_B].map((id, index) => ({
      ...createRegistrationBox({ id, widthMm: 60, heightMm: 60, x: 10 + index * 80, y: 10 }),
      ...(locked ? { locked: true } : {}),
    }));
    const art1 = rect('ART1', 20, 10, 20, 20, 'art');
    const art2 = rect('ART2', 10, 20, 28, 16, 'art');
    const copies = [art1, art2].map((source) => ({
      ...source,
      id: registrationJigCopyId(source.id, BOX_B),
      transform: { ...source.transform, x: source.transform.x + 80 },
    }));
    const free = [rect('F1', 10, 10, 200, 10, 'art'), rect('F2', 10, 10, 205, 10, 'art')];
    return projectOf(
      [...boxes, art1, art2, ...copies, ...free],
      [{ ...createRegistrationLayer(), output: false }, lineOp('art', 2222, 90)],
    );
  }

  const boxLit = (project: Project, inA: boolean) =>
    litLength(burnMoves(project).filter((move) => move.maxX < 190 && move.maxX < 85 === inA));

  it("refuses box A's pieces alone, so both boxes keep burning the same artwork", () => {
    const project = jigProject(true);
    load(project, ['ART1', 'ART2']);
    expect(unionSilhouetteOperations(project.scene, ['ART1', 'ART2'])).toEqual([]);
    const a = boxLit(project, true);
    expect(a).toBeCloseTo(boxLit(project, false), 3);

    expect(st().unionSilhouetteSelection('art')).toBe(false);

    expect(st().project).toBe(project);
    expect(toasts().join(' ')).toMatch(/registration jig was left as it is/);
  });

  it.each([
    ['unlocked outlines (after Unlock All)', false],
    ['locked outlines', true],
  ])('Select All unions only the free shapes, with %s', (_label, locked) => {
    const project = jigProject(locked);
    load(project, []);
    st().selectAllObjects();
    const runs = (registrationJigCompilationRuns(project.scene) ?? []).length;

    expect(st().unionSilhouetteSelection('art')).toBe(true);

    const after = st().project;
    expect(findRegistrationBoxes(after.scene)).toHaveLength(2);
    expect(ids(after)).toEqual(expect.arrayContaining(['ART1', 'ART2']));
    expect((registrationJigCompilationRuns(after.scene) ?? []).length).toBe(runs);
    expect(boxLit(after, true)).toBeCloseTo(boxLit(after, false), 3);
    // The free pair still unions: 2 × 40 mm → one 50 mm outline.
    expect(ids(after).some((id) => id === 'F1' || id === 'F2')).toBe(false);
    expect(litLength(burnMoves(after).filter((move) => move.maxX > 190))).toBeCloseTo(50, 3);
    expect(toasts().join(' ')).toMatch(/registration jig was left as it is/);
  });
});
