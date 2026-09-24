import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { prepareStartJob } from './start-job-readiness';

const placement = { startFrom: 'absolute', anchor: 'front-left' } as const;
const offset = { x: 200.398, y: 170.323, z: -20.194 };

function project() {
  const base = createProject({
    ...FALCON_A1_PRO_GRBLHAL_PROFILE,
    homing: { ...FALCON_A1_PRO_GRBLHAL_PROFILE.homing, enabled: true },
  });
  return {
    ...base,
    optimization: {
      ...base.optimization,
      travelPolicy: 'source-order' as const,
      pathDirection: 'preserve' as const,
    },
    scene: {
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'offset.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 50, minY: 228, maxX: 60, maxY: 238 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 50, y: 238 },
                    { x: 60, y: 228 },
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

function machine(reportInches = false) {
  const scale = reportInches ? 25.4 : 1;
  const wco = { x: offset.x / scale, y: offset.y / scale, z: offset.z / scale };
  return {
    connected: false,
    alarmCode: null,
    hasActiveStreamer: false,
    activeControllerKind: 'grblhal' as const,
    activeControllerCommandSet: 'creality-falcon-a1-pro' as const,
    detectedControllerKind: 'grblhal' as const,
    homingState: 'confirmed' as const,
    workOriginActive: true,
    wcoCache: wco,
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true, reportInches },
    statusReport: {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: 214.263 / scale, y: 177.425 / scale, z: 0 },
      wPos: null,
      wco,
      feed: 0,
      spindle: 0,
    },
  };
}

describe('Absolute placement retains machine coordinates with a work offset', () => {
  it.each([false, true])(
    'prepares the homed Falcon without clearing its offset (inches=%s)',
    (inches) => {
      const p = project();
      const m = machine(inches);
      const result = prepareStartJob(
        p,
        m.controllerSettings,
        m,
        placement,
        DEFAULT_OUTPUT_SCOPE,
        undefined,
        false,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.messages.join('\n'));
      expect(result.gcode).toContain('X-150.398 Y-140.323');
      // Independent controller algebra: commanded work point + WCO is the
      // intended machine/bed point, despite the origin retained after Home.
      expect(-150.398 + offset.x).toBeCloseTo(50, 9);
      expect(-140.323 + offset.y).toBeCloseTo(30, 9);
      expect(result.canvasPlan.jobStart).toEqual({ x: 50, y: 238 });
      expect(result.canvasPlan.framePerimeter).toContainEqual({ x: 50, y: 238 });
      expect(result.gcode).not.toMatch(/G92|G10/);
      expect(m.wcoCache.x).toBe(offset.x / (inches ? 25.4 : 1));
    },
  );

  it('also compensates the observed offset when the bed mapping is unverified', () => {
    const p = project();
    const m = { ...machine(), homingState: 'unknown' as const };
    const result = prepareStartJob(
      p,
      m.controllerSettings,
      m,
      placement,
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.messages.join('\n'));
    expect(result.gcode).toContain('X-150.398 Y-140.323');
    expect(result.warnings.join('\n')).toContain('mapping is unverified');
    const resolved = resolveJobPlacement(placement, m);
    if (!resolved.ok) throw new Error('known offset fixture');
    expect(
      runtimeCoordinatePreparationOptions(p.device, resolved, m).contourEntryBounds,
    ).toBeNull();
  });

  it('adds the stock negative native translation exactly once', () => {
    const p = project();
    const m = {
      ...machine(),
      ...stockNativeEvidence(p.device),
      wcoCache: { x: -300, y: -100, z: 0 },
    };
    const result = prepareStartJob(
      p,
      m.controllerSettings,
      m,
      placement,
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.messages.join('\n'));
    expect(result.gcode).toContain('X-8.000 Y-138.000');
    expect(-8 - 300 + 358).toBe(50);
    expect(-138 - 100 + 268).toBe(30);
  });

  it('keeps an unresolved custom offset factual instead of assuming zero', () => {
    const m = { ...machine(), wcoCache: null, statusReport: null };
    expect(resolveJobPlacement(placement, m).ok).toBe(false);
  });

  it('keeps the preparation key stable when the first zero WCO report arrives', () => {
    const p = project();
    const m = {
      ...machine(),
      homingState: 'unknown' as const,
      workOriginActive: false,
      wcoCache: null,
      statusReport: null,
    };
    const before = resolveJobPlacement(placement, m);
    const reported = { ...m, wcoCache: { x: 0, y: 0, z: 0 } };
    const after = resolveJobPlacement(placement, reported);
    if (!before.ok || !after.ok) throw new Error('zero-offset fixture');
    expect(runtimeCoordinatePreparationOptions(p.device, before, m)).toEqual(
      runtimeCoordinatePreparationOptions(p.device, after, reported),
    );
  });
});
