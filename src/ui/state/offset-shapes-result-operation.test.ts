// Tools audit T1, T33 (ADR-410 Amendment 6). Offset Shapes puts the whole
// selection's offset on one operation. These tests decode the G-code that the
// real prepareOutput and emitter produce for the edited project, with the
// independent reader in src/__fixtures__/lit-burn-length.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { litBurn } from '../../__fixtures__/lit-burn-length';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import { createRegistrationBox } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import type { OffsetShapesRequest } from './offset-shapes-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

function operation(
  id: string,
  mode: 'line' | 'fill',
  speed: number,
  power: number,
  extra: Partial<Layer> = {},
): Layer {
  return { ...createLayer({ id, color: '#123456', name: id, mode }), speed, power, ...extra };
}

function rectangle(
  id: string,
  size: { w: number; h: number; x: number; y: number },
  operationId: string,
  name?: string,
): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: size.w, heightMm: size.h, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: size.x, y: size.y },
    }),
    operationIds: [operationId],
    ...(name === undefined ? {} : { name }),
  } as SceneObject;
}

function openLine(id: string, x: number, y0: number, y1: number, operationId: string): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y0, maxX: x, maxY: y1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x, y: y0 },
              { x, y: y1 },
            ],
          },
        ],
      },
    ],
    operationIds: [operationId],
  } as SceneObject;
}

function load(objects: SceneObject[], layers: Layer[], selection: string[]): Project {
  const base = createProject();
  const project: Project = {
    ...base,
    optimization: { ...DEFAULT_PROJECT_OPTIMIZATION },
    scene: { ...base.scene, objects, layers, groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: selection[0] ?? null,
    additionalSelectedIds: new Set(selection.slice(1)),
  });
  useToastStore.setState({ toasts: [] });
  return project;
}

function burn(project: Project): ReturnType<typeof litBurn> {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('prepareOutput refused the project');
  return litBurn(emitPreparedGcode(prepared).gcode);
}

function request(patch: Partial<OffsetShapesRequest> = {}): OffsetShapesRequest {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'round',
    outerShapesOnly: false,
    deleteOriginals: false,
    ...patch,
  };
}

// A 15 mm square's 1 mm round outward ring: 4 x 15 + 2 pi.
const PART_RING_MM = 60 + 2 * Math.PI;

beforeEach(() => resetStore());

describe('Offset Shapes result operation (T33-P2-1)', () => {
  const guide = operation('guide', 'line', 3000, 5, { output: false });
  const cut = operation('cut', 'line', 400, 95);
  const G = rectangle('G', { w: 100, h: 60, x: 10, y: 10 }, 'guide');
  const P = rectangle('P', { w: 15, h: 15, x: 30, y: 30 }, 'cut');

  it('does not default to an output-off guide drawn first (60 mm → 0 mm on main)', () => {
    const before = load([G, P], [guide, cut], ['G', 'P']);
    expect(burn(before).total).toBeCloseTo(60, 3);
    expect(st().offsetShapesSelection(request({ deleteOriginals: true }))).toBe(true);
    const after = burn(st().project);
    // The guide's 102 x 62 ring and the part's ring merge into one ring that
    // now burns on a copy of the cut operation instead of vanishing.
    expect(after.total).toBeGreaterThan(300);
    expect([...after.byFeedPower.keys()]).toEqual(['F400 S950']);
  });

  it('warns when the operator picks an output-off operation', () => {
    load([G, P], [guide, cut], ['P', 'G']);
    st().offsetShapesSelection(request({ deleteOriginals: true, operationId: 'guide' }));
    expect(burn(st().project).total).toBe(0);
    expect(toasts().join(' ')).toContain('“guide”, whose output is off');
  });

  it('defaults to the primary selection’s operation, not scene order', () => {
    const fill = operation('fill', 'fill', 2000, 25, { hatchSpacingMm: 0.2 } as Partial<Layer>);
    const line = operation('line', 'line', 600, 50);
    const B = rectangle('B', { w: 20, h: 20, x: 80, y: 20 }, 'fill');
    const A = rectangle('A', { w: 30, h: 10, x: 20, y: 20 }, 'line');
    const before = load([B, A], [fill, line], ['A', 'B']);
    const fillBefore = burn(before).byFeedPower.get('F2000 S250') ?? 0;
    st().offsetShapesSelection(request());
    const after = burn(st().project);
    // On main the outline's offset was hatched as Fill (2000 → 6330 mm).
    expect(after.byFeedPower.get('F2000 S250') ?? 0).toBeCloseTo(fillBefore, 3);
    expect(after.byFeedPower.get('F600 S500') ?? 0).toBeGreaterThan(80);
    expect(toasts().join(' ')).not.toContain('output is off');
  });

  it('honours a chosen operation from the selection', () => {
    load([P, G], [guide, cut], ['P', 'G']);
    st().offsetShapesSelection(request({ operationId: 'cut' }));
    const offsetLayer = st().project.scene.layers.at(-1);
    expect(offsetLayer?.output).toBe(true);
    expect(offsetLayer?.power).toBe(95);
  });

  it('names a single named source’s offset (T33-P3-2)', () => {
    load([rectangle('N', { w: 10, h: 10, x: 10, y: 10 }, 'cut', 'Bracket')], [cut], ['N']);
    st().offsetShapesSelection(request());
    expect(st().project.scene.objects.at(-1)?.name).toBe('Bracket offset');
  });
});

describe('Inward sources that make no ring (T33-P2-2)', () => {
  const cut = operation('cut', 'line', 500, 80);
  const plate = rectangle('plate', { w: 40, h: 30, x: 10, y: 10 }, 'cut');
  const plateRing = 2 * (37 + 27);
  it.each([
    ['a 2.5 mm square', rectangle('small', { w: 2.5, h: 2.5, x: 70, y: 10 }, 'cut', 'Pin')],
    ['a 2 mm bar', rectangle('bar', { w: 2, h: 40, x: 80, y: 10 }, 'cut', 'Pin')],
    ['an open line', { ...openLine('line', 100, 10, 35, 'cut'), name: 'Pin' } as SceneObject],
  ])('names %s that Delete removes with no replacement', (_label, lost) => {
    load([plate, lost], [cut], ['plate', lost.id]);
    st().offsetShapesSelection(
      request({ direction: 'inward', distanceMm: 1.5, deleteOriginals: true }),
    );
    // Delete still deletes (LightBurn parity); the burn is the plate's ring.
    expect(burn(st().project).total).toBeCloseTo(plateRing, 3);
    const notice = toasts().join(' ');
    expect(notice).toContain('One shape gets no inward offset');
    expect(notice).toContain('“Pin”');
    expect(notice).toContain('Undo brings it back');
  });

  it('names a partial collapse under Both, and stays quiet when every shape has a ring', () => {
    const small = rectangle('small', { w: 2.5, h: 2.5, x: 70, y: 10 }, 'cut');
    load([plate, small], [cut], ['plate', 'small']);
    st().offsetShapesSelection(request({ direction: 'both', distanceMm: 1.5 }));
    expect(toasts().join(' ')).toContain('One shape gets no inward offset');
    expect(toasts().join(' ')).toContain('a shape');

    const hole = rectangle('hole', { w: 10, h: 10, x: 20, y: 20 }, 'cut');
    load([plate, hole], [cut], ['plate', 'hole']);
    st().offsetShapesSelection(request({ direction: 'inward', distanceMm: 1.5 }));
    expect(toasts().join(' ')).not.toContain('no inward offset');
  });
});

describe('A jig left in Outline only (T33R-P2-1)', () => {
  function jig(): { objects: SceneObject[]; layers: Layer[]; copyId: string } {
    const boxes = ['boxA', 'boxB'].map(
      (id, index) =>
        ({
          ...createRegistrationBox({ id, widthMm: 60, heightMm: 60, x: 10 + index * 80, y: 10 }),
          locked: true,
        }) as SceneObject,
    );
    const art = rectangle('S', { w: 20, h: 20, x: 30, y: 30 }, 'art');
    const copyId = registrationJigCopyId('S', 'boxB');
    const copy = { ...art, id: copyId, transform: { ...IDENTITY_TRANSFORM, x: 110, y: 30 } };
    return {
      objects: [...boxes, art, copy as SceneObject],
      layers: [createRegistrationLayer(), operation('art', 'line', 2222, 90)],
      copyId,
    };
  }
  // The art's 1 mm round ring: 4 x 20 + 2 pi.
  const ART_RING_MM = 80 + 2 * Math.PI;

  it.each([
    ['Offset Shapes', () => st().offsetShapesSelection(request())],
    ['the panel offset', () => st().offsetSelection(1)],
  ])('%s of the art burns in the Artwork only run (160 mm on main)', (_label, offset) => {
    const { objects, layers } = jig();
    load(objects, layers, []);
    useStore.setState({ registrationArtworkOutputSnapshot: null });
    st().setRegistrationOutput('artwork');
    const artworkOnly = burn(st().project).total;
    st().setRegistrationOutput('box');
    useStore.setState({ selectedObjectId: 'S', additionalSelectedIds: new Set() });
    offset();
    const outlineRun = burn(st().project).total;
    st().setRegistrationOutput('artwork');
    expect(burn(st().project).total).toBeCloseTo(artworkOnly + ART_RING_MM, 1);
    // The Outline only run still burns the outlines alone.
    expect(outlineRun).toBeCloseTo(480, 3);
    expect(toasts().join(' ')).not.toContain('output is off');
  });
});

// PART_RING_MM documents the R2 control (part alone, Delete on → 66.28 mm).
it('keeps the single-part control unchanged', () => {
  const cut = operation('cut', 'line', 400, 95);
  load([rectangle('P', { w: 15, h: 15, x: 30, y: 30 }, 'cut')], [cut], ['P']);
  st().offsetShapesSelection(request({ deleteOriginals: true }));
  expect(burn(st().project).total).toBeCloseTo(PART_RING_MM, 1);
});
