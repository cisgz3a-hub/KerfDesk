import { afterEach, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords, type Origin } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type Vec2,
} from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import type { CncTwoSidedSetup } from '../../core/scene/cnc-two-sided-setup';
import { canvasPlanRetentionKey } from '../../ui/state/canvas-motion-plan';
import { useStore } from '../../ui/state';
import { resetStore } from '../../ui/state/test-helpers';
import { useLaserStore } from '../../ui/state/laser-store';
import { initialLaserState } from '../../ui/state/laser-store-helpers';
import { installFrameOnceProject } from '../../ui/laser/frame-once.test-support';
import { reviewPendingFramedRunPermitForCurrentState } from '../../ui/laser/framed-run-testing';
import { framedRunReadinessIssue } from '../../ui/laser/framed-run-readiness';
import { emitGcode, prepareOutput } from './index';

type Part = { readonly id: string; readonly points: readonly [Vec2, Vec2] };
type PlacementCase = {
  readonly startFrom: 'absolute' | 'user-origin';
  readonly selection: 'all' | 'whole-side-anchor' | 'selection-anchor';
};
const PARTS: ReadonlyArray<Part> = [
  {
    id: 'common',
    points: [
      { x: 23, y: 28 },
      { x: 33, y: 30 },
    ],
  },
  {
    id: 'a-extra',
    points: [
      { x: 14, y: 25 },
      { x: 17, y: 29 },
    ],
  },
  {
    id: 'b-extra',
    points: [
      { x: 45, y: 43 },
      { x: 51, y: 48 },
    ],
  },
];
const CASES: ReadonlyArray<PlacementCase> = [
  { startFrom: 'absolute', selection: 'all' },
  { startFrom: 'absolute', selection: 'whole-side-anchor' },
  { startFrom: 'user-origin', selection: 'all' },
  { startFrom: 'user-origin', selection: 'whole-side-anchor' },
  { startFrom: 'user-origin', selection: 'selection-anchor' },
];
const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;

afterEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
});

it('emits independently derived side coordinates after placement and expires prior canvas/Frame evidence', async () => {
  for (const origin of ORIGINS) {
    for (const activeSide of ['A', 'B'] as const) {
      for (const flipAxis of ['x', 'y'] as const) {
        const project = sideProject(origin, activeSide, flipAxis);
        const original = JSON.stringify(project);
        for (const placement of CASES)
          assertPlacedOutput(project, origin, activeSide, flipAxis, placement);
        expect(JSON.stringify(project)).toBe(original);
      }
    }
  }
  installFrameOnceProject();
  const a = sideProject('front-left', 'A', 'y');
  useStore.setState({ project: a });
  const permit = await reviewPendingFramedRunPermitForCurrentState();
  expect(framedRunReadinessIssue(permit)).toBeNull();
  const placement = { startFrom: 'absolute', anchor: 'front-left' } as const;
  const aKey = canvasPlanRetentionKey(a, DEFAULT_OUTPUT_SCOPE, placement);
  const b = sideProject('front-left', 'B', 'y');
  useStore.setState({ project: b });
  expect(canvasPlanRetentionKey(b, DEFAULT_OUTPUT_SCOPE, placement)).not.toBe(aKey);
  expect(framedRunReadinessIssue(permit)).toContain('Frame the updated job again.');
});

function assertPlacedOutput(
  project: Project,
  origin: Origin,
  activeSide: 'A' | 'B',
  flipAxis: 'x' | 'y',
  placement: PlacementCase,
): void {
  const active = PARTS.filter(
    (part) => part.id === 'common' || part.id === `${activeSide.toLowerCase()}-extra`,
  );
  const selected =
    placement.selection === 'all' ? active : active.filter((part) => part.id === 'common');
  const scope = {
    cutSelectedGraphics: placement.selection !== 'all',
    useSelectionOrigin: placement.selection === 'selection-anchor',
    selectedObjectIds: placement.selection === 'all' ? [] : ['common'],
  };
  const expectedParts = selected.map((part) => ({
    ...part,
    points: part.points.map((point) => physicalSidePoint(point, activeSide, flipAxis)),
  }));
  const anchorParts = placement.selection === 'selection-anchor' ? selected : active;
  const offset = expectedOffset(placement, anchorParts, origin, activeSide, flipAxis);
  const options = {
    jobOrigin: { startFrom: placement.startFrom, anchor: 'front-left' } as const,
    outputScope: scope,
    ...(placement.startFrom === 'absolute' ? { absoluteProgramOffset: offset } : {}),
  };
  const prepared = prepareOutput(project, options);
  if (!prepared.ok) throw new Error('Side output failed to prepare');
  expect(prepared.project.scene.objects.map((object) => object.id)).toEqual(
    selected.map((part) => part.id),
  );
  expect(prepared.jobOriginOffset).toEqual(offset);
  const machine = prepared.project.machine;
  if (machine?.kind !== 'cnc') throw new Error('Expected prepared CNC stock');
  // The execution copy retains its source-frame stock datum. Placement translates
  // all emitted points by one common offset; authored stock and side intent stay unchanged.
  expect(machine.stock.originOffset).toEqual(
    activeSide === 'A' ? { x: 10, y: 20 } : { x: 4, y: 7 },
  );
  const gcode = emitGcode(project, options).gcode;
  expect(gcode).toContain(`; CNC side ${activeSide} | G54 | stock top Z0`);
  expect(gcode).toContain('\nG54\n');
  const cuts: string[] = [];
  for (const part of expectedParts) {
    const start = part.points[0];
    const end = part.points[1];
    if (start === undefined || end === undefined) throw new Error('Missing expected line endpoint');
    expect(gcode).toContain(`G0 ${xyWords(start, offset)}`);
    cuts.push(`G1 ${xyWords(end, offset)}`);
  }
  const actualCuts = gcode
    .split('\n')
    .filter((line) => /^G1 X/.test(line))
    .map((line) => line.replace(/ F.*$/, ''));
  expect(actualCuts.sort()).toEqual(cuts.sort());
}

// Literal stock-local equations derived from min-XY A=(10,20), B=(4,7),
// stock=100x60. These do not call the production flip or placement helpers.
function physicalSidePoint(point: Vec2, side: 'A' | 'B', axis: 'x' | 'y'): Vec2 {
  if (side === 'A') return point;
  return axis === 'y' ? { x: 114 - point.x, y: point.y - 13 } : { x: point.x - 6, y: 87 - point.y };
}

function expectedOffset(
  placement: PlacementCase,
  anchorParts: ReadonlyArray<Part>,
  origin: Origin,
  side: 'A' | 'B',
  axis: 'x' | 'y',
): Vec2 {
  return placement.startFrom === 'absolute'
    ? { x: -2, y: 3 }
    : relativeOffset(
        anchorParts.flatMap((part) =>
          part.points.map((point) => physicalSidePoint(point, side, axis)),
        ),
        origin,
      );
}

function relativeOffset(points: ReadonlyArray<Vec2>, origin: Origin): Vec2 {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    // The 6 mm fixture cutter expands the reviewed footprint by 3 mm on each edge.
    x: -(origin.endsWith('right') ? Math.max(...xs) + 3 : Math.min(...xs) - 3),
    y: -(origin.startsWith('rear') ? Math.max(...ys) + 3 : Math.min(...ys) - 3),
  };
}

function xyWords(point: Vec2, offset: Vec2): string {
  return `X${(point.x + offset.x).toFixed(3)} Y${(point.y + offset.y).toFixed(3)}`;
}

function sideProject(origin: Origin, activeSide: 'A' | 'B', flipAxis: 'x' | 'y'): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, origin });
  const side: CncTwoSidedSetup = {
    activeSide,
    flipAxis,
    sideBStockOriginMm: { x: 4, y: 7 },
    sideAObjectIds: ['common', 'a-extra'],
    sideBObjectIds: ['common', 'b-extra'],
    registration: [],
  };
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'em-6000',
      stock: {
        ...DEFAULT_CNC_MACHINE_CONFIG.stock,
        widthMm: 100,
        heightMm: 60,
        thicknessMm: 12,
        originOffset: { x: 10, y: 20 },
      },
    },
    cncSetup: { ...defaultCncMachiningSetup(), twoSided: side },
    optimization: {
      ...base.optimization,
      travelPolicy: 'source-order',
      pathDirection: 'preserve',
      insideFirst: false,
    },
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'line', color: '#000000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: false },
        },
      ],
      objects: PARTS.map((part): ImportedSvg => {
        const points = part.points.map((point) => toSceneCoords(point, base.device));
        return {
          kind: 'imported-svg',
          id: part.id,
          source: `${part.id}.svg`,
          transform: IDENTITY_TRANSFORM,
          bounds: {
            minX: Math.min(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxX: Math.max(...points.map((point) => point.x)),
            maxY: Math.max(...points.map((point) => point.y)),
          },
          paths: [{ color: '#000000', polylines: [{ points, closed: false }] }],
        };
      }),
    },
  };
}
