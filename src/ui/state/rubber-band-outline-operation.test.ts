// Rubber-Band Outline cuts with an operation that cuts along a line, keeps the
// source artwork's own settings, and warns when its operation does not output
// (tools audit T1: T34-P1-1, T34-P2-1, T34R-P2-1, T34-P3-1..3; ADR-480
// Amendment 7). Every burn is read back from emitted G-code.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  benchmarkLayer,
  benchmarkProject,
  benchmarkRectangle,
  benchmarkVector,
} from '../../__fixtures__/cnc-leader-fixtures';
import {
  captureLayerOperationSettings,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { rubberBandOutlineOptions } from './rubber-band-outline-operation';
import {
  addedOutline,
  cncCut,
  gcodeOf,
  laserProject,
  lineOperation,
  litLengthByFeedAndPower,
  onlyObject,
  selectInOrder,
  square,
  totalLength,
  vector,
  withScene,
} from './rubber-band-outline-test-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
const toasts = () =>
  useToastStore.getState().toasts.map((toast) => `[${toast.variant}] ${toast.message}`);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

/** The project with one object moved onto another operation, as an oracle burn. */
function onOperation(project: Project, objectId: string, operation: Layer): Project {
  const objects = project.scene.objects.map((object) =>
    object.id === objectId && object.kind === 'imported-svg'
      ? {
          ...object,
          operationIds: [operation.id],
          paths: object.paths.map((path) => ({ ...path, operationIds: [operation.id] })),
        }
      : object,
  );
  return onlyObject(
    {
      ...project,
      scene: { ...project.scene, objects, layers: [...project.scene.layers, operation] },
    },
    objectId,
  );
}

describe('Rubber-Band Outline in CNC (T34-P1-1)', () => {
  const letters = benchmarkLayer('letters', { cutType: 'v-carve', toolId: 'v60', depthMm: 3 });
  const recess = benchmarkLayer('recess', { cutType: 'pocket', toolId: 'end6', depthMm: 3 });
  const cutout = benchmarkLayer('cutout', {
    cutType: 'profile-outside',
    toolId: 'end6',
    depthMm: 12,
    depthPerPassMm: 3,
  });
  const letterK = benchmarkVector('letter-1', [benchmarkRectangle(20, 20, 8, 40)], ['letters']);
  const letterD = benchmarkVector(
    'letter-2',
    [
      {
        closed: true,
        points: [
          { x: 40, y: 20 },
          { x: 60, y: 20 },
          { x: 70, y: 40 },
          { x: 60, y: 60 },
          { x: 40, y: 60 },
        ],
      },
    ],
    ['letters'],
  );
  const pocket = benchmarkVector('recess-1', [benchmarkRectangle(30, 30, 20, 20)], ['recess']);
  const part = benchmarkVector('cutout-1', [benchmarkRectangle(10, 10, 70, 60)], ['cutout']);

  it('cuts round V-carve text with a new Outside-path Outline, not a V-carve of the hull', () => {
    const project = withScene(benchmarkProject(), [letterK, letterD], [letters]);
    selectInOrder(project, ['letter-1', 'letter-2']);

    expect(st().addRubberBandOutline()).toBe(true);

    const { object, operation } = addedOutline(project);
    expect(operation.name).toBe('Outline');
    expect(operation.cnc?.cutType).toBe('profile-outside');
    // Hull perimeter 164.7 mm, plus the 6 mm bit's quarter turns round its corners.
    const cut = cncCut(gcodeOf(onlyObject(st().project, object.id)));
    expect(cut.cutMm).toBeGreaterThan(164);
    expect(cut.cutMm).toBeLessThan(220); // main: 82,512 mm
    expect(cut.minZ).toBeGreaterThanOrEqual(-1.0001); // main: -5.196 mm
  });

  it('copies the cut-out profile, not a pocket drawn earlier, whatever the scene order', () => {
    const project = withScene(benchmarkProject(), [pocket, part], [recess, cutout]);
    selectInOrder(project, ['cutout-1', 'recess-1']);

    st().addRubberBandOutline();

    const { object, operation } = addedOutline(project);
    expect(operation.cnc?.cutType).toBe('profile-outside');
    const made = cncCut(gcodeOf(onlyObject(st().project, object.id)));
    const oracle = cncCut(
      gcodeOf(onOperation(st().project, object.id, { ...cutout, id: 'oracle', name: 'oracle' })),
    );
    expect(made.cutMm).toBeCloseTo(oracle.cutMm, 3); // main: 4,773.6 mm of pocketing
    expect(made.minZ).toBeCloseTo(-12, 3);
  });

  it('offers only Profile operations and the new Outline, and says what it passed over', () => {
    const project = withScene(
      benchmarkProject(),
      [letterK, pocket, part],
      [letters, recess, cutout],
    );

    const options = rubberBandOutlineOptions(project, ['letter-1', 'recess-1', 'cutout-1']);

    expect(options.choices.map((choice) => [choice.name, choice.cut])).toEqual([
      ['cutout', 'Outside path'],
      ['Outline', 'Outside path'],
    ]);
    expect(options.passedOver).toEqual(['letters', 'recess']);
    expect(options.defaultId).toBe('cutout');
  });
});

describe('Rubber-Band Outline settings in a laser project', () => {
  it("keeps the source artwork's own settings and power scale (T34-P2-1)", () => {
    const cut = lineOperation('cut', 25, 1200);
    const plate: SceneObject = {
      ...vector('plate', [square(0, 0, 30, 20)], 'cut'),
      operationOverride: { power: 95, speed: 250 },
      powerScale: 80,
    };
    const hole = vector('hole', [square(40, 0, 10)], 'cut');
    const project = laserProject([plate, hole], [cut]);
    const plateBurn = [...litLengthByFeedAndPower(gcodeOf(onlyObject(project, 'plate'))).keys()];
    selectInOrder(project, ['plate', 'hole']);

    st().addRubberBandOutline();

    const { object } = addedOutline(project);
    const outlineBurn = litLengthByFeedAndPower(gcodeOf(onlyObject(st().project, object.id)));
    expect(plateBurn).toEqual(['F250/S760']);
    expect([...outlineBurn.keys()]).toEqual(plateBurn); // main: F1200/S250
  });

  it('passes over an output-off guide drawn first and warns when one is chosen (T34-P2-1)', () => {
    const guideOp = lineOperation('guide', 10, 4000, { output: false });
    const cut = lineOperation('cut', 90, 300);
    const guide = vector('guide', [square(0, 0, 100, 60)], 'guide');
    const a = vector('a', [square(10, 10, 20)], 'cut');
    const b = vector('b', [square(60, 20, 25)], 'cut');
    const project = laserProject([guide, a, b], [guideOp, cut]);
    selectInOrder(project, []);
    st().selectAllObjects();
    const before = totalLength(litLengthByFeedAndPower(gcodeOf(project)));

    st().addRubberBandOutline();

    const after = totalLength(litLengthByFeedAndPower(gcodeOf(st().project)));
    expect(after - before).toBeCloseTo(320, 3); // main: 0, the outline never burned
    expect(addedOutline(project).operation.output).toBe(true);

    useToastStore.setState({ toasts: [] });
    selectInOrder(project, ['guide', 'a', 'b']);
    expect(st().addRubberBandOutline('guide')).toBe(true);
    expect(toasts().at(-1)).toMatch(/^\[warning\] “guide” has its output turned off/);
  });

  it('gives a Line source with a Fill sub-operation a new Outline, so the hull is not hatched (T34R-P2-1)', () => {
    const root = lineOperation('art', 80, 400);
    const art: Layer = {
      ...root,
      subLayers: [
        {
          id: 'art-fill',
          label: 'Engrave',
          enabled: true,
          settings: {
            ...captureLayerOperationSettings(root),
            mode: 'fill',
            power: 30,
            speed: 3000,
            hatchSpacingMm: 0.5,
          },
        },
      ],
    };
    const project = laserProject(
      [vector('a', [square(0, 0, 10)], 'art'), vector('b', [square(40, 30, 10)], 'art')],
      [art],
    );
    selectInOrder(project, ['a', 'b']);

    st().addRubberBandOutline();

    const { object, operation } = addedOutline(project);
    expect(operation.name).toBe('Outline');
    expect(operation.subLayers).toEqual([]);
    const lit = totalLength(litLengthByFeedAndPower(gcodeOf(onlyObject(st().project, object.id))));
    expect(lit).toBeCloseTo(140, 3); // main: 1,740 mm with the hatch
  });

  it('copies the operation of the artwork selected first, not the one first in the scene (T34-P3-3)', () => {
    const project = laserProject(
      [vector('a', [square(0, 0, 10)], 'weak'), vector('c', [square(30, 0, 10)], 'strong')],
      [lineOperation('weak', 20, 1000), lineOperation('strong', 77, 1000)],
    );
    selectInOrder(project, ['c', 'a']);

    st().addRubberBandOutline();

    expect(addedOutline(project).operation.power).toBe(77); // main: 20
  });

  it('refuses an operation that is not one of the choices', () => {
    const project = laserProject(
      [vector('a', [square(0, 0, 10)], 'cut')],
      [lineOperation('cut', 50, 1000)],
    );
    selectInOrder(project, ['a']);

    expect(st().addRubberBandOutline('nonsense')).toBe(false);

    expect(st().project).toBe(project);
    expect(toasts().at(-1)).toMatch(/^\[warning\] That operation cannot cut this outline/);
  });
});

describe('Rubber-Band Outline notices', () => {
  it('says the outline does not go round variable text (T34-P3-1)', () => {
    const variableText = {
      kind: 'text',
      id: 'vt',
      content: 'SN {{serial:4}}',
      fontKey: 'roboto-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 60, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, y: 40 },
      paths: [{ color: '#000000', polylines: [square(0, 0, 60, 10)] }],
      operationIds: ['cut'],
      variableTemplate: {
        tokens: [
          { kind: 'literal', value: 'SN ' },
          { kind: 'serial', prefix: '', width: 4 },
        ],
      },
    } as unknown as SceneObject;
    const project = laserProject(
      [vector('r', [square(0, 0, 10)], 'cut'), variableText],
      [lineOperation('cut', 50, 1000)],
    );
    selectInOrder(project, ['r', 'vt']);

    expect(st().addRubberBandOutline()).toBe(true);

    expect(toasts()[0]).toMatch(
      /^\[info\] Variable text was left as text: .* The outline does not go round it\.$/,
    );
  });

  it('judges a tiny square and a thin sliver alike, by width (T34-P3-2)', () => {
    const operation = lineOperation('cut', 50, 1000);
    for (const shape of [square(0, 0, 0.008), square(0, 0, 50, 0.0015)]) {
      useToastStore.setState({ toasts: [] });
      const project = laserProject([vector('s', [shape], 'cut')], [operation]);
      selectInOrder(project, ['s']);

      expect(st().addRubberBandOutline()).toBe(false); // main: the sliver was outlined

      expect(toasts()).toEqual([
        '[warning] The selection has no area to outline: it lies on one straight line or is too small.',
      ]);
    }
  });
});
