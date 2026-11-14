// Tools audit T1: Prepare Stamp (T32-P2-1) and Convert to Bitmap (T32R-P1-1)
// rasterised an object's stored outlines. For variable text those are the
// template glyphs ("LOT {{serial:3}}") and for a variable barcode the code
// stored when it was made, so the stamp froze the template, and Convert to
// Bitmap deleted the text that burned the value and froze the template into
// every later record. Both now leave variable data out, as Weld does, and say
// "use Bake Variable Text first" (ADR-350 Amendment 3).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBarcodeObject } from '../../core/barcode/materialize-barcode';
import { defaultBarcodeSpec } from '../../core/barcode/barcode-spec';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { textToPolylines } from '../../core/text';
import { parseVariableTemplateSource } from '../../core/variables/template-source';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import {
  prepareOutputSnapshot,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';
import { stampPreparationCommand } from '../commands/stamp-preparation-command';
import {
  convertibleSkippedNotice,
  selectedConvertibleVectors,
} from '../commands/selection-command-state';
import { applyConvertToBitmap } from '../state/convert-to-bitmap';
import {
  decodeLitMoves,
  fontBuffer,
  operation,
  stampProject,
} from '../state/stamp-burn.test-support';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  assembleBitmapAsync,
  type BitmapConversionOptions,
  type ConvertibleVector,
} from './bitmap-assembly';
import { lumaToBase64 } from './luma-bitmap';
import { prepareStampSource } from './stamp-source';
import { stampSourceSelection } from './stamp-source-selection';
import { buildBitmapFromVectors } from './vector-to-bitmap';

vi.mock('./convert-bitmap-worker-client', () => ({
  convertBitmapInWorker: (
    vectors: ReadonlyArray<ConvertibleVector>,
    options: BitmapConversionOptions,
    id: string,
  ) =>
    assembleBitmapAsync(
      vectors,
      async (raster) => ({
        dataUrl: 'data:image/png;base64,AA==',
        lumaBase64: lumaToBase64(raster.luma),
      }),
      id,
      options,
    ),
}));

beforeEach(() => resetStore());

const TINOS = fontBuffer('Tinos-Regular.ttf');
const CONTENT = 'LOT {{serial:3}}';
const render = (content: string) =>
  textToPolylines({
    content,
    sizeMm: 8,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    fontBuffer: TINOS,
  });
const renderer: VariableTextRenderer = ({ text, content }) =>
  textToPolylines({
    content,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    color: text.color,
    fontBuffer: TINOS,
  });

async function variableTextProject(extra: SceneObject[] = []): Promise<Project> {
  const parsed = parseVariableTemplateSource(CONTENT);
  if (!parsed.ok) throw new Error(parsed.message);
  const template = await render(CONTENT);
  const text = {
    kind: 'text',
    id: 'VT',
    content: CONTENT,
    variableTemplate: parsed.template,
    fontKey: 'tinos-regular',
    sizeMm: 8,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: template.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    paths: template.paths,
    operationIds: ['FILL'],
  } as unknown as SceneObject;
  return stampProject([text, ...extra], [operation('FILL', 'fill')], {
    variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 7 },
  });
}

const border = {
  kind: 'imported-svg',
  id: 'BORDER',
  source: 'border.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  operationIds: ['FILL'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
} as unknown as SceneObject;

async function litWidth(project: Project, serialValue: number) {
  const snapshot = await prepareOutputSnapshot(
    {
      ...project,
      variables: { ...(project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA), serialValue },
    },
    { clock: () => new Date(0), renderVariableText: renderer },
  );
  if (!snapshot.ok) throw new Error('output refused');
  const gcode = emitPreparedGcode(snapshot).gcode;
  const xs = decodeLitMoves(gcode, project).flatMap((move) => [move.a.x, move.b.x]);
  return { gcode, width: Math.max(...xs) - Math.min(...xs) };
}

describe('Prepare Stamp leaves variable data out (T32-P2-1)', () => {
  it('refuses variable text alone and points to Bake Variable Text', async () => {
    const project = await variableTextProject();
    await expect(
      prepareStampSource(project, ['VT'], 254, new AbortController().signal),
    ).rejects.toThrow(/Bake Variable Text/u);
    const selection = stampSourceSelection(project.scene, ['VT']);
    expect(selection.canPrepare).toBe(false);
    expect(
      stampPreparationCommand({ canPrepareStamp: false, prepareStamp: vi.fn() } as never).enabled,
    ).toBe(false);
  });

  it('a stamp of a border and variable text is the border alone, with the notice', async () => {
    const project = await variableTextProject([border]);
    const selection = stampSourceSelection(project.scene, ['VT', 'BORDER']);
    expect(selection.objects.map((object) => object.id)).toEqual(['BORDER']);
    expect(selection.notice).toMatch(/Variable text was left as text: use Bake Variable Text/u);
    const prepared = await prepareStampSource(
      project,
      ['VT', 'BORDER'],
      254,
      new AbortController().signal,
    );
    // Per-cell: every source pixel is the border's (10 mm square at 0.1 mm), none the text's.
    const { image, pixels } = prepared;
    expect(image.bounds.maxX + image.transform.x).toBeCloseTo(10, 1);
    const dark = pixels.luma.reduce((sum, value) => sum + (value <= 127 ? 1 : 0), 0);
    expect(dark / (pixels.width * pixels.height)).toBeGreaterThan(0.95);
  });

  it('refuses a variable barcode, whose stored code is not the one the canvas shows', async () => {
    const parsed = parseVariableTemplateSource('{{serial:5}}');
    if (!parsed.ok) throw new Error(parsed.message);
    const spec = {
      ...defaultBarcodeSpec('code128'),
      data: '{{serial:5}}',
      showText: false,
      variableTemplate: parsed.template,
    };
    const made = await createBarcodeObject({
      id: 'BC',
      color: '#000000',
      spec: spec as never,
      value: '00100',
      renderCaption: async () =>
        ({ polylines: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }) as never,
    });
    if (!made.ok) throw new Error(made.message);
    const project = stampProject(
      [{ ...made.object, operationIds: ['FILL'] }],
      [operation('FILL', 'fill')],
      {
        variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 117 },
      },
    );
    await expect(
      prepareStampSource(project, ['BC'], 254, new AbortController().signal),
    ).rejects.toThrow(/variable barcode was left as it is: use Bake Variable Text/u);
    expect(selectedConvertibleVectors(project, ['BC'])).toEqual([]);
  });
});

describe('Convert to Bitmap leaves variable data out (T32R-P1-1)', () => {
  it('variable text keeps burning the current value at every serial', async () => {
    const project = await variableTextProject();
    const value = await render('LOT 007');
    const before = await litWidth(project, 7);
    expect(before.width).toBeCloseTo(value.bounds.maxX - value.bounds.minX, 0);
    // The real Convert to Bitmap path: the menu's convertibles, then the store swap.
    const convertibles = selectedConvertibleVectors(project, ['VT']);
    useStore.setState({ project, selectedObjectId: 'VT', additionalSelectedIds: new Set() });
    if (convertibles.length > 0) {
      const raster = await buildBitmapFromVectors(convertibles, {
        dpi: 254,
        renderType: 'fill-all',
      });
      useStore.setState((state) => applyConvertToBitmap(state, ['VT'], raster));
    }
    const after = useStore.getState().project;
    expect(after.scene.objects.map((object) => object.kind)).toEqual(['text']);
    const at7 = await litWidth(after, 7);
    const at8 = await litWidth(after, 8);
    expect(at7.width).toBeCloseTo(before.width, 3);
    expect(at8.gcode).not.toBe(at7.gcode);
  });

  it('a mixed selection converts the rest and names what it left as text', async () => {
    const project = await variableTextProject([border]);
    expect(selectedConvertibleVectors(project, ['VT', 'BORDER']).map((v) => v.id)).toEqual([
      'BORDER',
    ]);
    expect(convertibleSkippedNotice(project, ['VT', 'BORDER'])).toMatch(
      /Variable text was left as text: use Bake Variable Text first/u,
    );
    expect(convertibleSkippedNotice(project, ['BORDER'])).toBe('');
  });
});
