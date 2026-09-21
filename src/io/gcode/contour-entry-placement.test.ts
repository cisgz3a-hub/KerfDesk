import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type Origin } from '../../core/devices';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { buildProgramTime } from '../../core/gcode-time/program-time';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Vec2 } from '../../core/scene';
import { prepareOutput } from './prepare-output';
import { prepareOutputSnapshot } from './prepare-output-snapshot';
import { compileJob } from '../../core/job/compile-job';
import { estimateJobDuration } from '../../core/job/estimate-duration';
import {
  computeJobBounds,
  computeJobMotionBounds,
  type JobBounds,
} from '../../core/job/job-bounds';
import {
  applyJobOriginOffset,
  type JobOriginPlacement,
  type JobStartMode,
} from '../../core/job/job-origin';
import { estimateWithPlanner } from '../../core/job/planner';
import { buildToolpath } from '../../core/job/toolpath';

const ORIGINS: readonly Origin[] = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];
const MODES: readonly JobStartMode[] = [
  'absolute',
  'user-origin',
  'current-position',
  'verified-origin',
];
const EDGES = {
  left: [
    { x: 2, y: 170 },
    { x: 12, y: 170 },
    { x: 0, y: 170 },
  ],
  right: [
    { x: 398, y: 170 },
    { x: 388, y: 170 },
    { x: 400, y: 170 },
  ],
  top: [
    { x: 170, y: 2 },
    { x: 170, y: 12 },
    { x: 170, y: 0 },
  ],
  bottom: [
    { x: 170, y: 398 },
    { x: 170, y: 388 },
    { x: 170, y: 400 },
  ],
} as const;
type Edge = keyof typeof EDGES;
const COLOR = '#ff0000';

// Independent coordinate oracle: canvas Y goes down; only the centred origin
// has negative bed numbers. No production origin/bounds/entry helper is used.
function numbers(p: Vec2, origin: Origin): Vec2 {
  if (origin === 'center') return { x: p.x - 200, y: 200 - p.y };
  return {
    x: origin.endsWith('right') ? 400 - p.x : p.x,
    y: origin.startsWith('rear') ? p.y : 400 - p.y,
  };
}
function translated(p: Vec2, offset: Vec2): Vec2 {
  return { x: p.x + offset.x, y: p.y + offset.y };
}
function bounds(points: readonly Vec2[]): JobBounds {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}
function fixture(origin: Origin, mode: JobStartMode, edge: Edge = 'right') {
  const [first, end, entry] = EDGES[edge].map((point) => numbers(point, origin)) as [
    Vec2,
    Vec2,
    Vec2,
  ];
  const target = mode === 'current-position' ? { x: 37, y: -53 } : { x: 0, y: 0 };
  const offset =
    mode === 'absolute'
      ? { x: 0, y: 0 }
      : {
          x: target.x - (first.x + end.x) / 2,
          y: target.y - (first.y + end.y) / 2,
        };
  const placement: JobOriginPlacement =
    mode === 'current-position'
      ? { startFrom: mode, anchor: 'center', currentPosition: target }
      : { startFrom: mode, anchor: 'center' };
  const device = {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    origin,
    bedWidth: 400,
    bedHeight: 400,
    estimateCutTimeScale: 1,
    estimateTravelTimeScale: 1,
  };
  const base = createProject(device);
  const points = EDGES[edge].slice(0, 2);
  const project = {
    ...base,
    optimization: {
      ...base.optimization,
      travelPolicy: 'source-order' as const,
      pathDirection: 'preserve' as const,
    },
    scene: {
      layers: [createLayer({ id: 'line', color: COLOR })],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'edge',
          source: 'entry.svg',
          bounds: bounds(points),
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: COLOR, polylines: [{ closed: false, points }] }],
        },
      ],
    },
  };
  const envelope = bounds(
    [
      { x: 0, y: 0 },
      { x: 400, y: 400 },
    ].map((p) => translated(numbers(p, origin), offset)),
  );
  return {
    project,
    placement,
    envelope,
    offset,
    first: translated(first, offset),
    end: translated(end, offset),
    entry: translated(entry, offset),
  };
}

const MATRIX = ORIGINS.flatMap((origin) =>
  MODES.flatMap((mode) => (Object.keys(EDGES) as Edge[]).map((edge) => ({ origin, mode, edge }))),
);

describe('prepared contour envelopes use the final program coordinate frame', () => {
  it.each(MATRIX)('$origin / $mode / $edge clips consistently at the physical edge', (input) => {
    const f = fixture(input.origin, input.mode, input.edge);
    const prepared = prepareOutput(f.project, {
      jobOrigin: f.placement,
      contourEntryBounds: f.envelope,
    });
    if (!prepared.ok) throw new Error('fixture failed to compile');
    expect(prepared.job.contourEntryBounds).toEqual(f.envelope);
    expect(prepared.jobOriginOffset).toEqual(f.offset);
    const body = grblStrategy.emit(prepared.job, f.project.device, { finishPosition: null });
    expect(body).toContain(`X${f.entry.x.toFixed(3)} Y${f.entry.y.toFixed(3)} F800 S0`);
    expect(body).toContain(`X${f.first.x.toFixed(3)} Y${f.first.y.toFixed(3)} F1500 S0`);
    const route = buildToolpath(prepared.job, {
      startPoint: { x: 0, y: 0 },
      // A legacy caller's bed dimensions must never override prepared evidence.
      bedSizeMm: { widthMm: 400, heightMm: 400 },
    });
    expect(route.steps.at(0)).toMatchObject({ kind: 'travel', to: f.entry });
    expect(route.steps.at(1)).toMatchObject({
      kind: 'travel',
      motion: 'feed',
      from: f.entry,
      to: f.first,
      length: 2,
    });
    expect(computeJobBounds(prepared.job, f.project.device)).toEqual(bounds([f.first, f.end]));
    expect(computeJobMotionBounds(prepared.job, f.project.device)).toEqual(
      bounds([f.entry, f.first, f.end]),
    );
    const parsed = buildGcodeRenderModel(body);
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const clock = buildProgramTime(parsed.model, {
      accelMmPerSec2: f.project.device.accelMmPerSec2,
      junctionDeviationMm: f.project.device.junctionDeviationMm,
      maxFeedMmPerMin: f.project.device.maxFeed,
    });
    expect(
      estimateWithPlanner(prepared.job, f.project.device, { finishPosition: null }).totalSeconds,
    ).toBeCloseTo(clock.totalSeconds, 6);
    const duration = estimateJobDuration(prepared.job, f.project.device, { finishPosition: null });
    expect(duration.totalSeconds - (duration.breakdown.transportSeconds ?? 0)).toBeCloseTo(
      clock.totalSeconds,
      6,
    );
  });

  it.each(ORIGINS.flatMap((origin) => MODES.map((mode) => ({ origin, mode }))))(
    '$origin / $mode does not invent optional entry travel for an unknown envelope',
    ({ origin, mode }) => {
      const f = fixture(origin, mode);
      const prepared = prepareOutput(f.project, {
        jobOrigin: f.placement,
        contourEntryBounds: null,
      });
      if (!prepared.ok) throw new Error('fixture');
      expect(prepared.job.contourEntryBounds).toBeNull();
      const body = grblStrategy.emit(prepared.job, f.project.device, { finishPosition: null });
      expect(body).not.toContain('F1500 S0');
      expect(
        buildToolpath(prepared.job, {
          startPoint: { x: 99, y: 99 },
          bedSizeMm: { widthMm: 400, heightMm: 400 },
        }).steps,
      ).toHaveLength(2);
      expect(computeJobMotionBounds(prepared.job, f.project.device)).toEqual(
        computeJobBounds(prepared.job),
      );
    },
  );

  it.each(ORIGINS)('%s fresh absolute compilation carries origin-correct bounds', (origin) => {
    const f = fixture(origin, 'absolute');
    const compiled = compileJob(f.project.scene, f.project.device);
    expect(compiled.contourEntryBounds).toEqual(f.envelope);
    const prepared = prepareOutput(f.project);
    if (!prepared.ok) throw new Error('fixture');
    expect(structuredClone(prepared.job).contourEntryBounds).toEqual(f.envelope);
    expect(buildToolpath(prepared.job, { startPoint: { x: 0, y: 0 } }).steps.at(0)).toMatchObject({
      to: f.entry,
    });
    expect(applyJobOriginOffset(compiled, { x: 1, y: 2 }).contourEntryBounds).toBeNull();
  });

  it.each(['user-origin', 'verified-origin', 'current-position'] as const)(
    '%s without physical evidence never falls back to profile limits',
    (mode) => {
      const f = fixture('center', mode);
      const prepared = prepareOutput(f.project, { jobOrigin: f.placement });
      if (!prepared.ok) throw new Error('fixture');
      expect(prepared.job.contourEntryBounds).toBeNull();
    },
  );

  it('snapshot caching distinguishes unknown, default and changed program envelopes', async () => {
    const f = fixture('center', 'absolute');
    const renderVariableText = async () => {
      throw new Error('fixture contains no text');
    };
    const options = { clock: () => new Date('2026-09-22T00:00:00Z'), renderVariableText };
    const snapshots = await Promise.all([
      prepareOutputSnapshot(f.project, options),
      prepareOutputSnapshot(f.project, { ...options, contourEntryBounds: null }),
      prepareOutputSnapshot(f.project, {
        ...options,
        contourEntryBounds: { ...f.envelope, maxX: 199 },
      }),
      prepareOutputSnapshot(f.project, { ...options, absoluteProgramOffset: { x: -400, y: -400 } }),
    ]);
    expect(snapshots[0]).not.toBe(snapshots[1]);
    expect(snapshots[1]).not.toBe(snapshots[2]);
    for (const snapshot of snapshots) if (!snapshot.ok) throw new Error('fixture');
    expect(snapshots.map((s) => (s.ok ? s.job.contourEntryBounds : undefined))).toEqual([
      f.envelope,
      null,
      { ...f.envelope, maxX: 199 },
      { minX: -600, minY: -600, maxX: -200, maxY: -200 },
    ]);
    expect(snapshots[3]?.ok && snapshots[3].jobOriginOffset).toEqual({ x: -400, y: -400 });
  });

  it.each(ORIGINS)(
    '%s absolute native translation keeps artwork and envelope aligned',
    (origin) => {
      const f = fixture(origin, 'absolute');
      const shift = { x: -412, y: -423 };
      const envelope = {
        minX: f.envelope.minX + shift.x,
        maxX: f.envelope.maxX + shift.x,
        minY: f.envelope.minY + shift.y,
        maxY: f.envelope.maxY + shift.y,
      };
      const prepared = prepareOutput(f.project, {
        absoluteProgramOffset: shift,
        contourEntryBounds: envelope,
      });
      if (!prepared.ok) throw new Error('fixture');
      expect(prepared.jobOriginOffset).toEqual(shift);
      const inferred = prepareOutput(f.project, { absoluteProgramOffset: shift });
      expect(inferred.ok && inferred.job.contourEntryBounds).toEqual(envelope);
      expect(buildToolpath(prepared.job, { startPoint: { x: 0, y: 0 } }).steps.at(0)).toMatchObject(
        {
          to: translated(f.entry, shift),
        },
      );
      expect(computeJobMotionBounds(prepared.job)).toEqual(
        bounds([f.entry, f.first, f.end].map((p) => translated(p, shift))),
      );
      const ignored = prepareOutput(f.project, {
        jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
        absoluteProgramOffset: shift,
      });
      if (!ignored.ok) throw new Error('fixture');
      expect(computeJobBounds(ignored.job)).toEqual({ minX: -5, minY: 0, maxX: 5, maxY: 0 });
    },
  );
});
