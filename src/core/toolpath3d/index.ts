// core/toolpath3d — lifts a toolpath's 2D geometry and Z spans into 3D moves
// for the viewport. Pure; machine frame (ADR-257).

export {
  firstCuttingPoint,
  moveDepthRange,
  pointAtArcLength,
  toolpathMoves3d,
  type DepthRange,
  type Move3d,
  type Move3dKind,
  type Vec3,
} from './toolpath-moves-3d';
