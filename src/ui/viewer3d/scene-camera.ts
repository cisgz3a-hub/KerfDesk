// View changes for the Inspector scene (ADR-426): named views with an
// automatic projection, Fit from the current angle, and the short animation
// between them. Split from viewer3d-scene.ts, which owns everything else.

import type { AxisBounds } from '../../core/gcode-view';
import {
  boundsExtent,
  placementAlong,
  projectionForView,
  viewDirection,
  type CameraPlacement,
  type Vec3,
  type Viewer3dProjection,
  type Viewer3dView,
} from './camera-presets';
import { easeOutCubic, tweenPose, VIEW_TWEEN_MS, type CameraPose } from './camera-tween';
import type { CameraRig } from './scene-setup';
import { prefersReducedMotion, stopViewer3dGlide } from './viewer3d-controls';

export type SceneCameraControl = {
  readonly setBounds: (bounds: AxisBounds | null) => void;
  /** Frames a new program from Iso in perspective, at once. */
  readonly frame: () => void;
  /** Animates to a named view; the cube faces and plan views draw orthographically. */
  readonly goToView: (view: Viewer3dView) => void;
  /** Animates to frame the whole job from the current angle. */
  readonly fit: () => void;
  readonly setProjection: (projection: Viewer3dProjection) => void;
  readonly stop: () => void;
  readonly dispose: () => void;
};

type AnimationFrameApi = Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

export function createSceneCameraControl(
  rig: CameraRig,
  requestRender: () => void,
  frameApi: AnimationFrameApi = globalThis,
): SceneCameraControl {
  const { camera, controls } = rig;
  let bounds: AxisBounds | null = null;
  let frameId: number | null = null;
  const stop = (): void => {
    if (frameId !== null) frameApi.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const animateTo = (to: CameraPlacement): void => {
    stop();
    stopViewer3dGlide(controls);
    const from = currentPose(rig);
    if (prefersReducedMotion()) {
      applyPose(rig, to);
      requestRender();
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = easeOutCubic((now - start) / VIEW_TWEEN_MS);
      applyPose(rig, tweenPose(from, to, t));
      requestRender();
      frameId = t < 1 ? frameApi.requestAnimationFrame(step) : null;
    };
    frameId = frameApi.requestAnimationFrame(step);
  };
  const placement = (direction: Vec3): CameraPlacement =>
    placementAlong(direction, bounds, camera.aspect, rig.getProjection());
  controls.addEventListener('start', stop);
  return {
    setBounds: (next) => {
      bounds = next;
      rig.setExtent(boundsExtent(next));
    },
    frame: () => {
      stop();
      rig.setProjection('perspective');
      applyPose(rig, placement(viewDirection('iso')));
      requestRender();
    },
    goToView: (view) => {
      rig.setProjection(projectionForView(view));
      animateTo(placement(viewDirection(view)));
    },
    fit: () => animateTo(placement(currentDirection(rig))),
    setProjection: (projection) => {
      rig.setProjection(projection);
      requestRender();
    },
    stop,
    dispose: () => {
      stop();
      controls.removeEventListener('start', stop);
    },
  };
}

function currentPose(rig: CameraRig): CameraPose {
  const { position } = rig.camera;
  const { target } = rig.controls;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z },
  };
}

function currentDirection(rig: CameraRig): Vec3 {
  const pose = currentPose(rig);
  const x = pose.position.x - pose.target.x;
  const y = pose.position.y - pose.target.y;
  const z = pose.position.z - pose.target.z;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/** Places the camera and re-targets the orbit. Up stays +Z (ADR-426). */
export function applyPose(rig: CameraRig, pose: CameraPose): void {
  const { camera, controls } = rig;
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  controls.update();
}
