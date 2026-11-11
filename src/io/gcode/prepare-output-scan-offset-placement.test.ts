import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { computeJobBounds, type Job, type JobOriginPlacement } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput, type PreparedOutput } from './prepare-output';

const FILL_COLOR = '#ff0000';
const LINE_COLOR = '#0000ff';
const SPEED_MM_PER_MIN = 1500;
const SIZE_MM = 10;

type Anchor = 'front-left' | 'front-right' | 'center';
type PlacementCase = {
  readonly label: string;
  readonly target: Vec2;
  readonly placement: (anchor: Anchor) => JobOriginPlacement;
};

const userOrigin = (anchor: Anchor): JobOriginPlacement => ({ startFrom: 'user-origin', anchor });

// ADR-052 Amendment 1: the table moves only commanded reverse rows, so a
// Line cut drawn on the fill's own outline stays on the Job Origin anchor.
const PLACEMENTS: ReadonlyArray<PlacementCase> = [
  {
    label: 'user origin',
    target: { x: 0, y: 0 },
    placement: userOrigin,
  },
  {
    label: 'verified origin',
    target: { x: 0, y: 0 },
    placement: (anchor) => ({ startFrom: 'verified-origin', anchor }),
  },
  {
    label: 'current position',
    target: { x: 50, y: 25 },
    placement: (anchor) => ({
      startFrom: 'current-position',
      anchor,
      currentPosition: { x: 50, y: 25 },
    }),
  },
];

describe('scan-offset tables leave placed jobs on their anchor (ADR-052 Amendment 1)', () => {
  it.each(PLACEMENTS)(
    'a positive table keeps the Line cut on the front-left anchor at $label',
    ({ placement, target }) => {
      const jobOrigin = placement('front-left');
      const prepared = prepare(lineAndFillProject(0.5, [square('art', 10)]), jobOrigin);
      const untabled = prepare(lineAndFillProject(null, [square('art', 10)]), jobOrigin);

      expect(prepared.jobOriginOffset).toEqual(untabled.jobOriginOffset);
      expect(lineBounds(prepared.job)).toEqual({
        minX: target.x,
        minY: target.y,
        maxX: target.x + SIZE_MM,
        maxY: target.y + SIZE_MM,
      });
      // The commanded reverse rows still reach half the 0.5 mm table past the
      // anchor (ADR-052 Amendment 2); that is real motion, so the burn and
      // motion envelopes keep it.
      expect(computeJobBounds(prepared.job, prepared.project.device)?.minX).toBeCloseTo(
        target.x - 0.25,
        6,
      );
    },
  );

  it.each(PLACEMENTS)(
    'a negative table keeps the Line cut on the front-right anchor at $label',
    ({ placement, target }) => {
      const jobOrigin = placement('front-right');
      const prepared = prepare(lineAndFillProject(-0.5, [square('art', 10)]), jobOrigin);
      const untabled = prepare(lineAndFillProject(null, [square('art', 10)]), jobOrigin);

      expect(prepared.jobOriginOffset).toEqual(untabled.jobOriginOffset);
      expect(lineBounds(prepared.job)).toMatchObject({ minY: target.y, maxX: target.x });
      expect(computeJobBounds(prepared.job, prepared.project.device)?.maxX).toBeCloseTo(
        target.x + 0.25,
        6,
      );
    },
  );

  it.each([0.5, -0.5])('a %s mm table keeps the centre anchor on the design centre', (offsetMm) => {
    const jobOrigin = userOrigin('center');
    const prepared = prepare(lineAndFillProject(offsetMm, [square('art', 10)]), jobOrigin);

    expect(lineBounds(prepared.job)).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
  });

  it('emits the compensated reverse rows below the origin and still passes preflight', () => {
    const project = lineAndFillProject(0.5, [square('art', 10)]);
    const emitted = emitGcode(project, { jobOrigin: userOrigin('front-left') });

    expect(emitted.preflight.ok).toBe(true);
    // Compact rows read `G1X-0.25Y2…`: the reverse rows end half the table
    // value below X0 (ADR-052 Amendment 2).
    expect(emitted.gcode).toMatch(/X-0\.25(?![0-9])/);
  });

  it.each([
    { useSelectionOrigin: true, expectedMinX: 0 },
    { useSelectionOrigin: false, expectedMinX: 90 },
  ])(
    'anchors full/selected design bounds when useSelectionOrigin=$useSelectionOrigin',
    ({ useSelectionOrigin, expectedMinX }) => {
      const project = lineAndFillProject(0.5, [square('selected', 100), square('unselected', 10)]);
      const outputScope: OutputScope = {
        cutSelectedGraphics: true,
        useSelectionOrigin,
        selectedObjectIds: ['selected'],
      };
      const prepared = prepare(project, userOrigin('front-left'), outputScope);

      expect(lineBounds(prepared.job)?.minX).toBeCloseTo(expectedMinX, 6);
    },
  );
});

function prepare(
  project: Project,
  jobOrigin: JobOriginPlacement,
  outputScope?: OutputScope,
): Extract<PreparedOutput, { readonly ok: true }> {
  const prepared = prepareOutput(project, {
    jobOrigin,
    ...(outputScope === undefined ? {} : { outputScope }),
  });
  if (!prepared.ok) throw new Error('expected prepared output');
  return prepared;
}

// Independent of the production bounds helpers: the Line cut's own vertices.
function lineBounds(job: Job) {
  const points = job.groups.flatMap((group) =>
    group.kind === 'cut' && group.color === LINE_COLOR
      ? group.segments.flatMap((segment) => segment.polyline)
      : [],
  );
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function lineAndFillProject(offsetMm: number | null, objects: ReadonlyArray<SceneObject>): Project {
  const device = {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    scanningOffsets: offsetMm === null ? [] : [{ speedMmPerMin: SPEED_MM_PER_MIN, offsetMm }],
  };
  const fill = {
    ...createLayer({ id: 'fill', color: FILL_COLOR, mode: 'fill' }),
    speed: SPEED_MM_PER_MIN,
    hatchAngleDeg: 0,
    hatchSpacingMm: 2,
    fillBidirectional: true,
    fillOverscanMm: 0,
  };
  const line = createLayer({ id: 'line', color: LINE_COLOR, mode: 'line' });
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      objects,
      layers: [fill, line],
      artworkOrder: objects.map((object) => object.id),
    },
  };
}

// One square, filled and outlined by a Line cut on the same edges.
function square(id: string, x: number): SceneObject {
  const minY = 10;
  const maxX = x + SIZE_MM;
  const maxY = minY + SIZE_MM;
  const outline = {
    closed: true,
    points: [
      { x, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x, y: maxY },
    ],
  };
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY, maxX, maxY },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: FILL_COLOR, polylines: [outline] },
      { color: LINE_COLOR, polylines: [outline] },
    ],
  };
}
