import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import {
  canvasJobTimingPlan,
  validatedCanvasJobTimingPlan,
  type CanvasJobTimingContext,
} from './canvas-job-timing-plan';

const ABSOLUTE_MOVE = 'G21\nG90\nG0 X100';
const DWELL = 'G21\nG90\nG4 P3';
const OVER_BUDGET_PROGRAM = ';\n'.repeat(25_000);
const COUNTDOWN_SEGMENT_BUDGET = 25_000;
const MIN_ARC_SEGMENTS_PER_LINE = 24;
const MAX_ARC_SEGMENTS_PER_LINE = 360;
const MANY_ARC_COUNT = 2_000;
const MANY_ARC_PROGRAM = [
  'G21 G90',
  'G0 X100 Y0',
  ...Array.from({ length: MANY_ARC_COUNT }, () => 'G2 X100 Y0 I-100 J0 F600'),
].join('\n');
const ORIGIN = { x: 0, y: 0, z: 0 };
const GRBL = 'grbl-v1.1';
const CONTROLLER_SESSION_EPOCH = 7;
const POSITION_EPOCH = 11;

function controllerContext(
  activeControllerKind: ControllerKind | null = GRBL,
  detectedControllerKind: ControllerKind | null = activeControllerKind,
): CanvasJobTimingContext {
  return {
    controllerSessionEpoch: CONTROLLER_SESSION_EPOCH,
    positionEpoch: POSITION_EPOCH,
    activeControllerKind,
    detectedControllerKind,
  };
}

describe('canvas job timing plan', () => {
  it('requires a trustworthy finite controller start position', () => {
    const missing = canvasJobTimingPlan(
      ABSOLUTE_MOVE,
      DEFAULT_DEVICE_PROFILE,
      null,
      controllerContext(),
    );
    const nonFinite = canvasJobTimingPlan(
      ABSOLUTE_MOVE,
      DEFAULT_DEVICE_PROFILE,
      {
        x: Number.NaN,
        y: 0,
        z: 0,
      },
      controllerContext(),
    );

    expect(missing).toMatchObject({
      kind: 'unavailable',
      reason: 'current controller position is unavailable for exact emitted-program timing',
    });
    expect(nonFinite).toMatchObject({
      kind: 'unavailable',
      reason: 'current controller position is unavailable for exact emitted-program timing',
    });
  });

  it('uses the supplied controller position for the initial travel', () => {
    const result = canvasJobTimingPlan(
      ABSOLUTE_MOVE,
      DEFAULT_DEVICE_PROFILE,
      {
        x: 75,
        y: 0,
        z: 0,
      },
      controllerContext(),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.totalRouteMm).toBe(25);
  });

  it('uses the active controller family as authority for dwell semantics', () => {
    const grbl = canvasJobTimingPlan(DWELL, DEFAULT_DEVICE_PROFILE, ORIGIN, controllerContext());
    const marlin = canvasJobTimingPlan(
      DWELL,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext('marlin'),
    );
    const smoothie = canvasJobTimingPlan(
      DWELL,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext('smoothieware'),
    );
    const configuredMarlinActiveGrbl = canvasJobTimingPlan(
      DWELL,
      { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' },
      ORIGIN,
      controllerContext(),
    );
    const activeGrblDetectedMarlin = canvasJobTimingPlan(
      DWELL,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext(GRBL, 'marlin'),
    );

    expect(grbl.kind).toBe('ok');
    if (grbl.kind === 'ok') expect(grbl.plan.dwellSeconds).toBe(3);
    expect(marlin).toMatchObject({ kind: 'unavailable' });
    expect(smoothie).toMatchObject({ kind: 'unavailable' });
    expect(activeGrblDetectedMarlin).toMatchObject({ kind: 'unavailable' });
    expect(configuredMarlinActiveGrbl.kind).toBe('ok');
    if (configuredMarlinActiveGrbl.kind === 'ok') {
      expect(configuredMarlinActiveGrbl.plan.dwellSeconds).toBe(3);
    }
  });

  it('refuses exact dwell timing without an active controller family', () => {
    expect(
      canvasJobTimingPlan(DWELL, DEFAULT_DEVICE_PROFILE, ORIGIN, controllerContext(null)),
    ).toMatchObject({
      kind: 'unavailable',
      reason: 'active controller family is unavailable for exact emitted-program dwell timing',
    });
    expect(
      canvasJobTimingPlan(DWELL, DEFAULT_DEVICE_PROFILE, ORIGIN, controllerContext(GRBL, null)),
    ).toMatchObject({
      kind: 'unavailable',
      reason: 'current-session controller evidence cannot prove G4 P dwell uses seconds',
    });
  });

  it('keeps very large countdown sidecars unavailable before timeline allocation', () => {
    const result = canvasJobTimingPlan(
      OVER_BUDGET_PROGRAM,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext(),
    );

    expect(result).toMatchObject({
      kind: 'unavailable',
      reason: 'Exact emitted program exceeds the live countdown line budget.',
    });
  });

  it('stops a many-arc sidecar within one expanded line of the segment budget', () => {
    const boundedRender = buildGcodeRenderModel(MANY_ARC_PROGRAM, {
      initialPositionMm: ORIGIN,
      maxSegments: COUNTDOWN_SEGMENT_BUDGET,
    });
    const timing = canvasJobTimingPlan(
      MANY_ARC_PROGRAM,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext(),
    );

    expect(boundedRender.kind).toBe('error');
    if (boundedRender.kind !== 'error') return;
    expect(boundedRender.segmentLimit?.maximum).toBe(COUNTDOWN_SEGMENT_BUDGET);
    expect(boundedRender.segmentLimit?.observed).toBeGreaterThan(COUNTDOWN_SEGMENT_BUDGET);
    expect(boundedRender.segmentLimit?.observed).toBeLessThanOrEqual(
      COUNTDOWN_SEGMENT_BUDGET + MAX_ARC_SEGMENTS_PER_LINE,
    );
    expect(boundedRender.segmentLimit?.observed).toBeLessThan(
      MANY_ARC_COUNT * MIN_ARC_SEGMENTS_PER_LINE,
    );
    expect(timing).toMatchObject({
      kind: 'unavailable',
      reason: 'Exact emitted program exceeds the live countdown segment budget.',
    });
  });

  it('degrades stale program, session, family, or initial-position evidence without gating', () => {
    const result = canvasJobTimingPlan(
      ABSOLUTE_MOVE,
      DEFAULT_DEVICE_PROFILE,
      ORIGIN,
      controllerContext(),
    );
    const current = { ...controllerContext(), initialPosition: ORIGIN };

    expect(validatedCanvasJobTimingPlan(ABSOLUTE_MOVE, result, current)).toBe(result);
    for (const stale of [
      validatedCanvasJobTimingPlan(`${ABSOLUTE_MOVE}\nM5`, result, current),
      validatedCanvasJobTimingPlan(ABSOLUTE_MOVE, result, {
        ...current,
        controllerSessionEpoch: CONTROLLER_SESSION_EPOCH + 1,
      }),
      validatedCanvasJobTimingPlan(ABSOLUTE_MOVE, result, {
        ...current,
        detectedControllerKind: 'marlin',
      }),
      validatedCanvasJobTimingPlan(ABSOLUTE_MOVE, result, {
        ...current,
        initialPosition: { x: 1, y: 0, z: 0 },
      }),
    ]) {
      expect(stale).toEqual({
        kind: 'unavailable',
        reason: 'exact emitted-program timing evidence changed before controller handoff',
      });
    }
  });
});
