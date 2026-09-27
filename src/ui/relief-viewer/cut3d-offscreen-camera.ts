// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { viewer3dOrbitRadiansPerPixel } from '../viewer3d/viewer3d-controls';
import type { Cut3DOffscreenControl } from './cut3d-offscreen-worker-protocol';
import { viewer3DZoomScale, type Viewer3DZoomCursor } from './viewer3d-keyboard-controls';

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

export type Cut3DViewport = { readonly widthPx: number; readonly heightPx: number };

export type Cut3DCameraPose = {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
};

export const CUT3D_CAMERA_FOV_DEG = 40;
const ORBIT_RADIUS_FACTOR = 1.6;
const THICKNESS_FRAMING_FACTOR = 4;
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

/**
 * Applies one compact, ordered input message without consulting DOM state.
 * Orbit speed, screen-space pan and zoom toward the cursor match the orbit
 * controls of every other 3D view (ADR-426).
 */
export function applyCut3DCameraControl(
  state: Cut3DCameraState,
  control: Cut3DOffscreenControl,
  viewport: Cut3DViewport,
): Cut3DCameraState {
  if (control.kind === 'rotate') {
    const radiansPerPixel = viewer3dOrbitRadiansPerPixel(viewport.heightPx);
    return {
      ...state,
      yawRad: state.yawRad - control.deltaX * radiansPerPixel,
      pitchRad: clamp(
        state.pitchRad + control.deltaY * radiansPerPixel,
        -PITCH_LIMIT_RAD,
        PITCH_LIMIT_RAD,
      ),
    };
  }
  if (control.kind === 'zoom') return zoomCamera(state, control.deltaY, control.cursor, viewport);
  return panCamera(state, control.deltaX, control.deltaY, viewport.heightPx);
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

// The point under the cursor on the plane through the target stays under the
// cursor: the target moves toward it by the share the distance shrinks.
function zoomCamera(
  state: Cut3DCameraState,
  deltaY: number,
  cursor: Viewer3DZoomCursor | undefined,
  viewport: Cut3DViewport,
): Cut3DCameraState {
  const radiusMm = clamp(
    state.radiusMm * viewer3DZoomScale(deltaY),
    state.minRadiusMm,
    state.maxRadiusMm,
  );
  if (cursor === undefined) return { ...state, radiusMm };
  const halfHeightMm = state.radiusMm * Math.tan((CUT3D_CAMERA_FOV_DEG * Math.PI) / 360);
  const aspect = Math.max(1, viewport.widthPx) / Math.max(1, viewport.heightPx);
  const pull = 1 - radiusMm / state.radiusMm;
  const basis = screenBasis(state);
  const across = cursor.ndcX * halfHeightMm * aspect * pull;
  const upward = cursor.ndcY * halfHeightMm * pull;
  return {
    ...state,
    radiusMm,
    targetX: state.targetX + basis.right[0] * across + basis.up[0] * upward,
    targetY: state.targetY + basis.right[1] * across + basis.up[1] * upward,
    targetZ: state.targetZ + basis.right[2] * across + basis.up[2] * upward,
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
  const { right, up } = screenBasis(state);
  return {
    ...state,
    targetX: state.targetX + (-deltaX * right[0] + deltaY * up[0]) * worldPerPixel,
    targetY: state.targetY + (-deltaX * right[1] + deltaY * up[1]) * worldPerPixel,
    targetZ: state.targetZ + (-deltaX * right[2] + deltaY * up[2]) * worldPerPixel,
  };
}

type Axis = readonly [number, number, number];

// Screen right and up of the orbit camera, in the Z-up work frame.
function screenBasis(state: Cut3DCameraState): { readonly right: Axis; readonly up: Axis } {
  const sinYaw = Math.sin(state.yawRad);
  const cosYaw = Math.cos(state.yawRad);
  const sinPitch = Math.sin(state.pitchRad);
  const cosPitch = Math.cos(state.pitchRad);
  return {
    right: [-sinYaw, cosYaw, 0],
    up: [-sinPitch * cosYaw, -sinPitch * sinYaw, cosPitch],
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
