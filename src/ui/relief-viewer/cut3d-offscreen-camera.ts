import type { Cut3DOffscreenControl } from './cut3d-offscreen-worker-protocol';
import { viewer3DZoomScale } from './viewer3d-keyboard-controls';

export type Cut3DCameraState = {
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly radiusMm: number;
  readonly minRadiusMm: number;
  readonly maxRadiusMm: number;
};

export type Cut3DCameraPose = {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
};

export const CUT3D_CAMERA_FOV_DEG = 40;
const ORBIT_RADIUS_FACTOR = 1.6;
const THICKNESS_FRAMING_FACTOR = 4;
const ROTATION_RADIANS_PER_PIXEL = 0.005;
const PITCH_LIMIT_RAD = Math.PI / 2 - 0.01;
const MIN_RADIUS_FACTOR = 0.05;
const MAX_RADIUS_FACTOR = 20;

/** Creates the same three-quarter, Z-up opening pose as the legacy renderer. */
export function initialCut3DCameraState(
  widthMm: number,
  heightMm: number,
  stockThicknessMm: number,
): Cut3DCameraState {
  const spanMm = Math.max(widthMm, heightMm, stockThicknessMm * THICKNESS_FRAMING_FACTOR);
  const framedRadiusMm = spanMm * ORBIT_RADIUS_FACTOR;
  const x = framedRadiusMm * 0.7;
  const y = -framedRadiusMm * 0.7;
  const z = framedRadiusMm * 0.6;
  return {
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    yawRad: Math.atan2(y, x),
    pitchRad: Math.atan2(z, Math.hypot(x, y)),
    radiusMm: Math.hypot(x, y, z),
    minRadiusMm: Math.max(spanMm * MIN_RADIUS_FACTOR, 0.01),
    maxRadiusMm: Math.max(spanMm * MAX_RADIUS_FACTOR, 1),
  };
}

/** Applies one compact, ordered input message without consulting DOM state. */
export function applyCut3DCameraControl(
  state: Cut3DCameraState,
  control: Cut3DOffscreenControl,
  viewportHeightPx: number,
): Cut3DCameraState {
  if (control.kind === 'rotate') {
    return {
      ...state,
      yawRad: state.yawRad - control.deltaX * ROTATION_RADIANS_PER_PIXEL,
      pitchRad: clamp(
        state.pitchRad + control.deltaY * ROTATION_RADIANS_PER_PIXEL,
        -PITCH_LIMIT_RAD,
        PITCH_LIMIT_RAD,
      ),
    };
  }
  if (control.kind === 'zoom') {
    return {
      ...state,
      radiusMm: clamp(
        state.radiusMm * viewer3DZoomScale(control.deltaY),
        state.minRadiusMm,
        state.maxRadiusMm,
      ),
    };
  }
  return panCamera(state, control.deltaX, control.deltaY, viewportHeightPx);
}

export function cut3DCameraPose(state: Cut3DCameraState): Cut3DCameraPose {
  const horizontal = state.radiusMm * Math.cos(state.pitchRad);
  return {
    position: [
      state.targetX + horizontal * Math.cos(state.yawRad),
      state.targetY + horizontal * Math.sin(state.yawRad),
      state.targetZ + state.radiusMm * Math.sin(state.pitchRad),
    ],
    target: [state.targetX, state.targetY, state.targetZ],
  };
}

function panCamera(
  state: Cut3DCameraState,
  deltaX: number,
  deltaY: number,
  viewportHeightPx: number,
): Cut3DCameraState {
  const height = Math.max(1, viewportHeightPx);
  const worldPerPixel =
    (2 * state.radiusMm * Math.tan((CUT3D_CAMERA_FOV_DEG * Math.PI) / 360)) / height;
  const sinYaw = Math.sin(state.yawRad);
  const cosYaw = Math.cos(state.yawRad);
  const sinPitch = Math.sin(state.pitchRad);
  const cosPitch = Math.cos(state.pitchRad);
  const rightX = -sinYaw;
  const rightY = cosYaw;
  const upX = -sinPitch * cosYaw;
  const upY = -sinPitch * sinYaw;
  const upZ = cosPitch;
  return {
    ...state,
    targetX: state.targetX + (-deltaX * rightX + deltaY * upX) * worldPerPixel,
    targetY: state.targetY + (-deltaX * rightY + deltaY * upY) * worldPerPixel,
    targetZ: state.targetZ + deltaY * upZ * worldPerPixel,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
