// @vitest-environment jsdom
// Tools audit T1 (ADR-350 Amendment 2):
// - T29-P1-2 → P2, T29R-P2-1, T29-P3-3: Union, Weld and Subtract / Intersect /
//   Exclude removed their sources without dependency repair, so an image
//   masked by a source kept a dangling id and burned whole (3200 mm, 2656 mm of
//   it outside the mask) with no warning, and text set on a source stayed
//   bound to a deleted guide. They now repair as Delete does and say so.
// - T29-P2-2: Union dropped placed tabs without ADR-494 Amendment 3's notice.
// - The other tools that rebuild stored outlines (Offset Shapes, Cut Shapes,
//   Trim, Warp / Deform, Rubber-Band Outline) leave variable text alone too.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { warpDeformTargets } from './warp-deform-plan';
import { warpDeformNotice } from './warp-deform-actions';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);
const find = (id: string) => st().project.scene.objects.find((object) => object.id === id);
const COLOR = '#000000';

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function square(id: string, x: number, y: number, size: number, open = false): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['L'],
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: !open,
            points: [
              { x, y },
              { x: x + size, y },
              { x: x + size, y: y + size },
              { x, y: y + size },
              ...(open ? [{ x, y: y + 0.01 }] : []),
            ],
          },
        ],
      },
    ],
  };
}

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'PHOTO',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,source',
  pixelWidth: 40,
  pixelHeight: 40,
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 2,
  imageMaskId: 'MASK',
};

const textOnGuide = {
  kind: 'text',
  id: 'LABEL',
  content: 'ROUND',
  fontKey: 'roboto-regular',
  sizeMm: 5,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: COLOR,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
  operationIds: ['L'],
  pathText: { guideObjectId: 'MASK', offsetMm: 0, reverse: false },
} as unknown as TextObject;

function load(objects: ReadonlyArray<SceneObject>, selected: ReadonlyArray<string>): Project {
  const project = {
    ...createProject(),
    scene: {
      objects: [...objects],
      layers: [
        { ...createLayer({ id: 'L', name: 'Line', color: COLOR }), mode: 'line' as const },
        createLayer({ id: 'image', name: 'Image', color: '#808080', mode: 'image' }),
      ],
      groups: [],
    },
  };
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return project;
}

describe('tools that replace their sources repair masks and text guides (T29-P1-2, T29R-P2-1)', () => {
  const tools: ReadonlyArray<readonly [string, () => void]> = [
    ['Union Silhouette', () => st().unionSilhouetteSelection('L')],
    ['Weld', () => st().weldSelection()],
    ['Subtract', () => st().booleanSelection('subtract')],
    ['Intersect', () => st().booleanSelection('intersect')],
    ['Exclude', () => st().booleanSelection('exclude')],
  ];

  it.each(tools)('%s clears the mask and the guide it consumed, and says so', (_name, run) => {
    // A 16 mm mask centred on the photo, with a 6 × 6 ear on its right edge.
    const before = load(
      [photo, square('MASK', 62, 62, 16), square('EAR', 75, 65, 6), textOnGuide],
      ['MASK', 'EAR'],
    );

    run();

    expect(find('MASK')).toBeUndefined();
    const image = find('PHOTO') as RasterImage;
    expect(image.imageMaskId).toBeUndefined();
    expect((find('LABEL') as TextObject).pathText).toBeUndefined();
    const said = toasts().join(' ');
    expect(said).toMatch(
      /1 image mask reference was removed because its mask artwork was merged into a new shape/,
    );
    expect(said).toMatch(/1 path-text guide reference was removed/);
    st().undo();
    expect(st().project).toBe(before);
  });

  it('Weld with Keep originals leaves the mask where it was', () => {
    load([photo, square('MASK', 62, 62, 16), square('EAR', 75, 65, 6)], ['MASK', 'EAR']);
    st().weldSelection({ keepOperands: true });
    expect((find('PHOTO') as RasterImage).imageMaskId).toBe('MASK');
    expect(toasts().join(' ')).not.toMatch(/image mask reference/);
  });

  it('Join Paths names the guide it merged away (T30-P3-4)', () => {
    const guided = (id: string, guide: string) =>
      ({
        ...textOnGuide,
        id,
        pathText: { ...textOnGuide.pathText, guideObjectId: guide },
      }) as TextObject;
    // Two strokes 0.01 mm apart, in separate objects: Join merges them into one.
    const stroke = (id: string, from: number, to: number): ImportedSvg => ({
      ...square(id, 0, 0, 10, true),
      paths: [
        {
          color: COLOR,
          polylines: [
            {
              closed: false,
              points: [
                { x: from, y: 0 },
                { x: to, y: 0 },
              ],
            },
          ],
        },
      ],
    });
    const g1 = stroke('G1', 0, 10);
    const g2 = stroke('G2', 10.01, 20);
    load([g1, g2, guided('T1', 'G1'), guided('T2', 'G2')], ['G1', 'G2']);

    expect(st().joinSelectedPaths(0.05)).toBe(true);

    const live = new Set(st().project.scene.objects.map((object) => object.id));
    const dangling = ['T1', 'T2'].filter((id) => {
      const guide = (find(id) as TextObject).pathText?.guideObjectId;
      return guide !== undefined && !live.has(guide);
    });
    expect(dangling).toEqual([]);
    expect(toasts().join(' ')).toMatch(/1 path-text guide reference was removed/);
  });
});

describe('Union Silhouette names the placed tabs it drops (T29-P2-2)', () => {
  const tab = { layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT: 0.125 };
  it.each([
    ['with placed tabs', true],
    ['without placed tabs', false],
  ])('%s', (_label, tabbed) => {
    const plate = { ...square('PLATE', 10, 10, 30), ...(tabbed ? { laserTabAnchors: [tab] } : {}) };
    load([plate, square('B', 35, 20, 10)], ['PLATE', 'B']);

    expect(st().unionSilhouetteSelection('L')).toBe(true);

    const notice = 'Placed tabs on the unioned shapes were removed. Undo restores them.';
    if (tabbed) expect(toasts()).toContain(notice);
    else expect(toasts()).not.toContain(notice);
  });
});

// ---- the other tools that read stored outlines ---------------------------
async function variableText(): Promise<TextObject> {
  const parsed = parseVariableTemplateSource('SN {{serial:4}}');
  if (!parsed.ok) throw new Error(parsed.message);
  // Stored outlines stand in for the template glyphs: one 10 mm square.
  const glyphs = square('VT', 20, 20, 10);
  return {
    ...textOnGuide,
    id: 'VT',
    content: 'SN {{serial:4}}',
    variableTemplate: parsed.template,
    bounds: glyphs.bounds,
    paths: glyphs.paths,
    pathText: undefined,
  } as unknown as TextObject;
}

describe('other geometry tools leave variable text as it is (ADR-350 Amendment 2)', () => {
  const offset = (deleteOriginals: boolean) => ({
    distanceMm: 1,
    direction: 'outward' as const,
    cornerStyle: 'corner' as const,
    outerShapesOnly: false,
    deleteOriginals,
  });

  it.each([false, true])('Offset Shapes (delete originals %s)', async (deleteOriginals) => {
    const text = await variableText();
    load([text, square('A', 60, 60, 10)], ['VT', 'A']);
    expect(st().offsetShapesSelection(offset(deleteOriginals))).toBe(true);
    expect(find('VT')).toBe(text);
    expect(
      st().project.scene.objects.filter((object) => object.id.startsWith('offset')),
    ).toHaveLength(1);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });

  it('Offset Shapes refuses variable text alone', async () => {
    const before = load([await variableText()], ['VT']);
    expect(st().offsetShapesSelection(offset(false))).toBe(false);
    expect(st().project).toBe(before);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });

  it('Cut Shapes does not cut variable text', async () => {
    const text = await variableText();
    load([square('A', 0, 20, 15), text, square('CUTTER', 12, 12, 30)], ['A', 'VT', 'CUTTER']);
    expect(st().cutSelectedShapes()).toBe(true);
    expect(find('VT')).toBe(text);
    expect(find('A')).toBeUndefined();
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });

  it('Trim Shapes refuses a stretch of variable text', async () => {
    const before = load([await variableText()], []);
    expect(st().trimShapeAt({ x: 25, y: 20 }, 0.5)).toBe(false);
    expect(st().project).toBe(before);
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });

  it('Rubber-Band Outline goes round the rest of the selection only', async () => {
    load([await variableText(), square('A', 60, 60, 10)], ['VT', 'A']);
    expect(st().addRubberBandOutline()).toBe(true);
    const outline = find(st().selectedObjectId ?? '');
    expect(outline?.bounds).toMatchObject({ minX: 60, minY: 60, maxX: 70, maxY: 70 });
    expect(toasts().join(' ')).toMatch(/Variable text was left as text/);
  });

  it('Warp / Deform bend the rest and say why the text stayed', async () => {
    const project = load([await variableText(), square('A', 60, 60, 10)], ['VT', 'A']);
    expect(warpDeformTargets(project.scene, ['VT', 'A']).map((object) => object.id)).toEqual(['A']);
    const plan = { warped: 1, convertedText: 0, convertedShapes: 0, curvesFlattened: false };
    expect(
      warpDeformNotice('warp', plan, { imagesAndReliefs: 0, locked: 0, variableText: 1 }),
    ).toBe(
      'Warped 1 object. Variable text was left as text: use Bake Variable Text first to fix its value.',
    );
  });
});
