// Shared three.js viewer home (ADR-255; ADR-102 §2 as amended). The G-code
// Inspector consumes it now; the CNC 3D pane migrates here over time.

export {
  createViewer3dScene,
  type PlayheadMarker,
  type Viewer3dSceneHandle,
  type Viewer3dSceneResult,
  type Viewer3dSegments,
} from './viewer3d-scene';
export {
  buildSegmentBuckets,
  cssHexColor,
  revealCount,
  rgbTriple,
  type SegmentBuckets,
  type Viewer3dSegmentsInput,
} from './segment-buckets';
export {
  CAMERA_PRESETS,
  CAMERA_PRESET_LABEL,
  cameraPlacement,
  type CameraPreset,
} from './camera-presets';
export { directionArrows, type ArrowPlacement } from './direction-arrows';
export { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';
