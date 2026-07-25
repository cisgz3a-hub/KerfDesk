// Shared three.js viewer home (ADR-255; ADR-102 §2 as amended). The G-code
// Inspector consumes it now; the CNC 3D pane migrates here over time.

export {
  createViewer3dScene,
  type Viewer3dSceneHandle,
  type Viewer3dSceneResult,
  type Viewer3dSegments,
} from './viewer3d-scene';
export { resolveViewer3dTheme, type Viewer3dTheme } from './viewer3d-theme';
