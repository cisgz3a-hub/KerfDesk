import { describe, expect, it } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { isCutBeforeEngravingWarning } from './cut-order-warnings';
import { prepareStartJob } from './start-job-readiness';

// Rolling audit v12 X3-P2-1: Job Review, Save G-code and Start read the
// prepared job, where a contour with a lead-in or lead-out is one open burn.
// Each case burns every outline before the names inside them.

const CUT = '#0000ff';
const ENGRAVE = '#ff0000';

type Polyline = { readonly closed: true; readonly points: ReadonlyArray<Vec2> };

const square = (x: number, y: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});

const ring = (cx: number, cy: number, radius: number, count: number): Polyline => ({
  closed: true,
  points: Array.from({ length: count }, (_, at) => ({
    x: cx + radius * Math.cos((at / count) * 2 * Math.PI),
    y: cy + radius * Math.sin((at / count) * 2 * Math.PI),
  })),
});

function svg(
  id: string,
  color: string,
  polylines: ReadonlyArray<Polyline>,
  extra: Partial<SceneObject> = {},
): SceneObject {
  const points = polylines.flatMap((polyline) => polyline.points);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    },
    paths: [{ color, polylines: polylines.map((polyline) => ({ ...polyline })) }],
    ...extra,
  } as SceneObject;
}

// A filled "O": an outer ring and its hole.
const nameO = (id: string, cx: number, cy: number) =>
  svg(id, ENGRAVE, [ring(cx, cy, 12, 64), ring(cx, cy, 7, 64)]);
const oneCoaster = [svg('o1', CUT, [square(20, 20, 80)]), nameO('n1', 60, 60)];
const twoCoasters = [...oneCoaster, svg('o2', CUT, [square(130, 20, 80)]), nameO('n2', 170, 60)];
const disc = [svg('d1', CUT, [ring(60, 60, 40, 360)]), nameO('n1', 60, 60)];
// Outlines are o1 and o2; the names are n1 and n2.
const leadsOnOutlines = (objects: ReadonlyArray<SceneObject>) =>
  objects.map((object) =>
    object.id.startsWith('o')
      ? { ...object, operationOverride: { leadInEnabled: true, leadOutEnabled: true } }
      : object,
  ) as ReadonlyArray<SceneObject>;

function project(
  objects: ReadonlyArray<SceneObject>,
  cut: Partial<Layer>,
  base: Project = createProject(),
): Project {
  return {
    ...base,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'cut', color: CUT }),
          name: 'Outline',
          mode: 'line',
          power: 90,
          speed: 400,
          ...cut,
        },
        {
          ...createLayer({ id: 'name', color: ENGRAVE }),
          name: 'Name',
          mode: 'fill',
          power: 30,
          speed: 3000,
        },
      ],
      objects: [...objects],
    },
  };
}

function falcon(objects: ReadonlyArray<SceneObject>, cut: Partial<Layer>): Project {
  const device = {
    ...FALCON_A1_PRO_GRBLHAL_PROFILE,
    homing: { ...FALCON_A1_PRO_GRBLHAL_PROFILE.homing, enabled: true },
  };
  return project(objects, cut, createProject(device));
}

const wco = { x: 0, y: 0, z: 0 };
const machine = {
  connected: false,
  alarmCode: null,
  hasActiveStreamer: false,
  activeControllerKind: 'grblhal' as const,
  activeControllerCommandSet: 'creality-falcon-a1-pro' as const,
  detectedControllerKind: 'grblhal' as const,
  homingState: 'confirmed' as const,
  workOriginActive: true,
  wcoCache: wco,
  controllerSettings: { maxPowerS: 1000, laserModeEnabled: true, reportInches: false },
  statusReport: {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco,
    feed: 0,
    spindle: 0,
  },
};

const cutWarnings = (warnings: ReadonlyArray<string> | undefined) =>
  (warnings ?? []).filter(isCutBeforeEngravingWarning).length;

async function routeWarnings(objects: ReadonlyArray<SceneObject>, cut: Partial<Layer>) {
  const p = project(objects, cut);
  const review = await prepareOutputRequestForTest({ kind: 'prepare', project: p, options: {} });
  const save = await prepareOutputRequestForTest({ kind: 'save', project: p, options: {} });
  const start = prepareStartJob(
    falcon(objects, cut),
    machine.controllerSettings,
    machine,
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (review.kind !== 'prepared' || !review.result.ok)
    throw new Error('Job Review did not prepare');
  if (save.kind !== 'save' || save.result.kind !== 'emitted') throw new Error('Save did not emit');
  if (!start.ok) throw new Error(start.messages.join('\n'));
  const cutSegments = review.result.job.groups.flatMap((group) =>
    group.kind === 'cut' ? group.segments : [],
  );
  return {
    led: cutSegments.some((segment) => segment.leadContour !== undefined),
    jobReview: cutWarnings(review.machineWarnings),
    save: cutWarnings(save.result.machineWarnings),
    start: cutWarnings(start.warnings),
  };
}

const ON_EVERY_ROUTE = { jobReview: 1, save: 1, start: 1 };

describe('cut before engraving warning on the prepared job', () => {
  it('warns a plain cut on every route', async () => {
    expect(await routeWarnings(oneCoaster, {})).toEqual({ led: false, ...ON_EVERY_ROUTE });
  });

  it.each([
    ['a lead-in', oneCoaster, { leadInEnabled: true }],
    ['a lead-in and 3 passes', oneCoaster, { leadInEnabled: true, passes: 3 }],
    ['a lead-in and a 2 mm overcut', oneCoaster, { leadInEnabled: true, overcutMm: 2 }],
    [
      'a 5 mm straight lead-in',
      oneCoaster,
      { leadInEnabled: true, leadStyle: 'line', leadLengthMm: 5 },
    ],
    ['a lead-in too long to fit', oneCoaster, { leadInEnabled: true, leadLengthMm: 500 }],
    ['a lead-out on a round coaster', disc, { leadOutEnabled: true }],
    ['both leads on two coasters', twoCoasters, { leadInEnabled: true, leadOutEnabled: true }],
  ] as const)('warns a cut with %s on every route', async (_, objects, cut) => {
    expect(await routeWarnings(objects, cut)).toEqual({ led: true, ...ON_EVERY_ROUTE });
  });

  it('warns leads set on the artwork while the operation has none', async () => {
    expect(await routeWarnings(leadsOnOutlines(twoCoasters), {})).toEqual({
      led: true,
      ...ON_EVERY_ROUTE,
    });
  });
});
