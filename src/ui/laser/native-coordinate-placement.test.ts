import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { computeJobBounds } from '../../core/job';
import { emitGcode, prepareOutput } from '../../io/gcode';
import {
  resolveJobPlacement,
  resolveExportJobPlacement,
  runtimeCoordinatePreparationOptions,
  trustedMotionOffsetForPreflight,
} from '../job-placement';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { mapControllerPointToScene } from '../state/canvas-motion-plan';
import { prepareStartJob } from './start-job-readiness';
import { initialMachinePositionOption } from './start-job-preparation';
import { bestFitRectangleFromCorners } from '../../core/scene/board-capture';
import { boardVerificationPoint, capturedBoardShape } from '../../core/scene/board-verification';

function project(startX = 50): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    origin: 'front-left',
    bedWidth: 358,
    bedHeight: 268,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
  });
  return {
    ...base,
    optimization: { ...base.optimization, travelPolicy: 'source-order', pathDirection: 'preserve' },
    scene: {
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'native.svg',
          bounds: { minX: startX, minY: 228, maxX: startX + 10, maxY: 238 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: startX, y: 238 },
                    { x: startX + 10, y: 228 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function machine(p: Project) {
  return {
    ...stockNativeEvidence(p.device),
    alarmCode: null,
    hasActiveStreamer: false,
    workOriginActive: false,
    wcoCache: { x: 0, y: 0, z: 0 },
    statusReport: {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: -308, y: -238, z: 0 },
      wPos: { x: -308, y: -238, z: 0 },
      wco: { x: 0, y: 0, z: 0 },
      feed: 0,
      spindle: 0,
    },
  };
}

describe('native negative runtime placement', () => {
  it('exports Absolute through known custom G54 while keeping the ordinary Start origin rule', () => {
    const p = project();
    const m = { ...machine(p), workOriginActive: true, wcoCache: { x: -300, y: -100, z: 0 } };
    const settings = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    expect(resolveJobPlacement(settings, m).ok).toBe(false);
    const placement = resolveExportJobPlacement(settings, m);
    if (!placement.ok) throw new Error('export fixture');
    const options = runtimeCoordinatePreparationOptions(p.device, placement, m);
    expect(options.absoluteProgramOffset).toEqual({ x: -58, y: -168 });
    const output = emitGcode(p, {
      ...options,
      preflightMotionOffset: trustedMotionOffsetForPreflight(p.device, placement, m)!,
    });
    expect(output.gcode).toContain('X-8.000 Y-138.000');
    // Work + WCO + native-to-bed = the intended physical bed point (50,30).
    expect(-8 - 300 + 358).toBe(50);
    expect(-138 - 100 + 268).toBe(30);
    const unknown = { ...m, wcoCache: null, statusReport: { ...m.statusReport, wco: null } };
    const fallback = resolveExportJobPlacement(settings, unknown);
    if (!fallback.ok) throw new Error('export fallback fixture');
    expect(runtimeCoordinatePreparationOptions(p.device, fallback, unknown)).toEqual({
      contourEntryBounds: null,
    });
  });
  it('emits Absolute in controller work coordinates and maps Frame/start back onto the artwork', () => {
    const p = project();
    const m = machine(p);
    const result = prepareStartJob(
      p,
      m.controllerSettings,
      m,
      { startFrom: 'absolute', anchor: 'front-left' },
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.messages.join('\n'));
    expect(result.prepared.jobOriginOffset).toEqual({ x: -358, y: -268 });
    expect(result.gcode).toContain('X-308.000 Y-238.000');
    expect(result.preflightMotionOffset).toEqual({ x: 358, y: 268 });
    expect(computeJobBounds(result.prepared.job, p.device)).toEqual({
      minX: -308,
      minY: -238,
      maxX: -298,
      maxY: -228,
    });
    expect(result.canvasPlan.jobStart).toEqual({ x: 50, y: 238 });
    expect(result.canvasPlan.framePerimeter).toContainEqual({ x: 50, y: 238 });
    expect(mapControllerPointToScene({ x: -308, y: -238, z: 0 }, result.canvasPlan)).toEqual({
      x: 50,
      y: 238,
    });
    expect(result.warnings.join('\n')).not.toMatch(/outside.*bed|mapping is unverified/i);
  });

  it('keeps User Origin work geometry while checking its physical bed location', () => {
    const p = project();
    const m = { ...machine(p), workOriginActive: true, wcoCache: { x: -300, y: -100, z: 0 } };
    const placement = resolveJobPlacement({ startFrom: 'user-origin', anchor: 'front-left' }, m);
    if (!placement.ok) throw new Error('fixture');
    const options = runtimeCoordinatePreparationOptions(p.device, placement, m);
    const motionOffset = trustedMotionOffsetForPreflight(p.device, placement, m);
    expect(motionOffset).toEqual({ x: 58, y: 168 });
    expect(options.absoluteProgramOffset).toBeUndefined();
    expect(options.contourEntryBounds).toEqual({ minX: -58, minY: -168, maxX: 300, maxY: 100 });
    const output = emitGcode(p, {
      ...options,
      jobOrigin: placement.jobOrigin!,
      preflightMotionOffset: motionOffset!,
    });
    expect(output.gcode).toContain('X0.000 Y0.000');
    expect(output.preflight.issues.some((i) => i.code === 'out-of-bed')).toBe(false);
  });

  it('normalizes the initial native head into the same bed frame used for no-go approaches', () => {
    const p = project();
    const m = machine(p);
    expect(initialMachinePositionOption(m, p.device)).toEqual({
      preflightInitialMachinePosition: { x: 50, y: 30 },
    });
    const inches = {
      ...m,
      reportInches: true,
      statusReport: { ...m.statusReport, mPos: { x: -308 / 25.4, y: -238 / 25.4, z: 0 } },
    };
    const position = initialMachinePositionOption(inches, p.device).preflightInitialMachinePosition;
    expect(position?.x).toBeCloseTo(50);
    expect(position?.y).toBeCloseTo(30);
  });

  it('detects the real initial approach crossing a clamp in bed coordinates', () => {
    const base = project(200);
    const p = {
      ...base,
      device: {
        ...base.device,
        noGoZones: [
          { id: 'clamp', name: 'Clamp', enabled: true, x: 100, y: 25, width: 10, height: 10 },
        ],
      },
    };
    const m = machine(p);
    const placement = { ok: true as const };
    const options = {
      ...runtimeCoordinatePreparationOptions(p.device, placement, m),
      preflightMotionOffset: trustedMotionOffsetForPreflight(p.device, placement, m)!,
    };
    const mapped = emitGcode(p, { ...options, ...initialMachinePositionOption(m, p.device) });
    expect(mapped.preflight.issues.some((i) => i.code === 'no-go-zone-collision')).toBe(true);
    const oldRaw = emitGcode(p, {
      ...options,
      preflightInitialMachinePosition: m.statusReport.mPos,
    });
    expect(oldRaw.preflight.issues.some((i) => i.code === 'no-go-zone-collision')).toBe(false);
  });

  it('keeps measured board sizes translation-invariant and verification jogs in native coordinates', () => {
    const corners = [
      { x: -300, y: -200 },
      { x: -240, y: -200 },
      { x: -240, y: -160 },
      { x: -300, y: -160 },
    ];
    const size = bestFitRectangleFromCorners(corners);
    expect(size).toEqual({ widthMm: 60, heightMm: 40, offSquareMm: 0 });
    const captured = { kind: 'rect' as const, origin: corners[0]!, widthMm: 60, heightMm: 40 };
    expect(capturedBoardShape(captured)).toEqual({ kind: 'rect', widthMm: 60, heightMm: 40 });
    expect(boardVerificationPoint(captured, { kind: 'rect', anchor: 'top-right' })).toEqual({
      x: -240,
      y: -160,
    });
  });

  it('leaves unknown and Verified Origin artwork-relative without adding a Start refusal', () => {
    const p = project();
    const m = machine(p);
    const unknown = { ...m, controllerBuildInfoObservation: null };
    const absolute = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    const prepared = prepareStartJob(
      p,
      m.controllerSettings,
      unknown,
      absolute,
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
    expect(prepared.canvasPlan.coordinateFrame.kind).toBe('relative');
    expect(runtimeCoordinatePreparationOptions(p.device, { ok: true }, unknown)).toEqual({
      contourEntryBounds: null,
    });
    expect(prepared.warnings.join('\n')).toContain('mapping is unverified');
    expect(prepared.prepared.jobOriginOffset).toEqual({ x: 0, y: 0 });

    const verified = resolveJobPlacement(
      { startFrom: 'verified-origin', anchor: 'front-left' },
      { ...m, workOriginActive: true },
    );
    if (!verified.ok) throw new Error('fixture');
    expect(trustedMotionOffsetForPreflight(p.device, verified, m)).toBeUndefined();
    expect(runtimeCoordinatePreparationOptions(p.device, verified, m)).toEqual({
      contourEntryBounds: null,
    });
    const output = prepareOutput(p, {
      jobOrigin: verified.jobOrigin!,
      ...runtimeCoordinatePreparationOptions(p.device, verified, m),
    });
    expect(output.ok).toBe(true);
  });
});
