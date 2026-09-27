// One mouse map and one camera feel for every 3D view (ADR-426).
//
// The audit found three maps: left-drag orbited in the G-code Inspector,
// panned in Cut 3D and the relief views, and drew in Design Studio. Every
// view now reads its drag actions from this one table, so a change here
// changes them all. Scroll always zooms toward the cursor.

import type * as ThreeNamespace from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type Viewer3dDragAction = 'orbit' | 'pan';

/** What each mouse button's drag does in every 3D view. */
export const VIEWER3D_MOUSE_MAP: Readonly<Record<'left' | 'middle' | 'right', Viewer3dDragAction>> =
  {
    left: 'pan',
    middle: 'pan',
    right: 'orbit',
  };

/** The on-screen hint for the map above, e.g. "Right-drag to orbit · …". */
export const VIEWER3D_MOUSE_HINT = [
  `${dragName('orbit')} to orbit`,
  `${dragName('pan')} to pan`,
  'Scroll to zoom',
].join(' · ');

// The side button that does an action; the middle button is left out of the
// hint because every map pans with it.
function dragName(action: Viewer3dDragAction): string {
  const side = VIEWER3D_MOUSE_MAP.left === action ? 'Left' : 'Right';
  return `${side}-drag`;
}

// Damping gives a short glide after a drag instead of a dead stop. Low enough
// that a flick settles in well under a second. Each frame of the glide moves
// the camera by this share of what is left of it.
export const VIEWER3D_DAMPING_FACTOR = 0.12;
const ROTATE_SPEED = 0.8;

const BUTTON_NAMES = ['left', 'middle', 'right'] as const;

/**
 * The orbit turn for one dragged pixel, the way OrbitControls turns it: a
 * full turn per view height, scaled by the shared rotate speed. Cut 3D's
 * worker camera uses it so its orbit feels like every other view's.
 */
export function viewer3dOrbitRadiansPerPixel(viewportHeightPx: number): number {
  return (2 * Math.PI * ROTATE_SPEED) / Math.max(1, viewportHeightPx);
}

/** The drag action for a PointerEvent.button, or null for other buttons. */
export function viewer3dDragAction(button: number): Viewer3dDragAction | null {
  const name = BUTTON_NAMES[button];
  return name === undefined ? null : VIEWER3D_MOUSE_MAP[name];
}

export type Viewer3dControlsOptions = {
  /** Leave the left button to the view's own tool (Design Studio draws with it). */
  readonly leftButtonFree?: boolean;
};

/**
 * Applies the shared mouse map and feel to an OrbitControls instance.
 * Damping is left off when the operator asks the system for reduced motion.
 * A view that turns damping on must call `controls.update()` every frame
 * while the camera settles; the shared render scheduler does.
 */
export function configureViewer3dControls(
  three: typeof ThreeNamespace,
  controls: OrbitControls,
  options: Viewer3dControlsOptions = {},
): void {
  const button = (action: Viewer3dDragAction): ThreeNamespace.MOUSE =>
    action === 'orbit' ? three.MOUSE.ROTATE : three.MOUSE.PAN;
  controls.mouseButtons = {
    LEFT: options.leftButtonFree === true ? null : button(VIEWER3D_MOUSE_MAP.left),
    MIDDLE: button(VIEWER3D_MOUSE_MAP.middle),
    RIGHT: button(VIEWER3D_MOUSE_MAP.right),
  };
  controls.enableDamping = !prefersReducedMotion();
  controls.dampingFactor = VIEWER3D_DAMPING_FACTOR;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.rotateSpeed = ROTATE_SPEED;
}

/**
 * Ends any glide still running from the last drag, so a programmatic camera
 * move does not fight it. With damping off, one update applies what is left
 * of the glide and clears it; the caller then places the camera.
 */
export function stopViewer3dGlide(controls: Pick<OrbitControls, 'enableDamping' | 'update'>): void {
  if (!controls.enableDamping) return;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
