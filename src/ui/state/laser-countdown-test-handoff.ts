import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest, type MotionPoint } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { canvasJobTimingPlan, type CanvasJobTimingPlanResult } from './canvas-job-timing-plan';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import { useLaserStore } from './laser-store';

const TEST_ORIGIN: MotionPoint = { x: 0, y: 0, z: 0 };

type LaserCountdownTestHandoffOptions = {
  readonly gcode: string;
  readonly retentionKey: string;
  readonly capability: CanvasMotionPlan['capability'];
};

type LaserCountdownTestHandoff = {
  readonly canvasPlan: CanvasMotionPlan;
  readonly jobTimingPlan: CanvasJobTimingPlanResult;
};

/**
 * Builds matching canvas and countdown evidence from one controller-state
 * snapshot for low-level job lifecycle tests.
 */
export function laserCountdownTestHandoff(
  options: LaserCountdownTestHandoffOptions,
): LaserCountdownTestHandoff {
  const state = useLaserStore.getState();
  return {
    canvasPlan: {
      manifest: buildMotionManifest(options.gcode, {
        machineKind: 'laser',
        initialPosition: TEST_ORIGIN,
      }),
      fingerprint: fingerprintGcode(options.gcode),
      retentionKey: options.retentionKey,
      machineKind: 'laser',
      device: DEFAULT_DEVICE_PROFILE,
      coordinateFrame: { kind: 'machine', workOffsetMm: TEST_ORIGIN },
      framePerimeter: [],
      jobStart: TEST_ORIGIN,
      approachFrom: TEST_ORIGIN,
      capability: options.capability,
      unavailableReason: null,
      resumed: false,
      positionEpoch: state.trustedPositionEpoch ?? 0,
    },
    jobTimingPlan: canvasJobTimingPlan(options.gcode, DEFAULT_DEVICE_PROFILE, TEST_ORIGIN, {
      controllerSessionEpoch: state.controllerSessionEpoch,
      positionEpoch: state.trustedPositionEpoch,
      activeControllerKind: state.activeControllerKind,
      detectedControllerKind: state.detectedControllerKind,
    }),
  };
}
