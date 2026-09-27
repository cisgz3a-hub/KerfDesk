import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import { localFromScene } from '../cnc-viewer3d/viewer3d-picking';
import type { ViewerWorkAxes } from '../cnc-viewer3d/viewer3d-work-axes';

// A held grid must keep the frame that produced it, not the latest project or
// pending route. Like preview placement metadata, this owns no durable state.
const gridFrames = new WeakMap<RemovalGrid, ViewerWorkAxes>();

export function registerCncCut3DWorkFrame(
  grid: RemovalGrid,
  device: DeviceProfile,
  jobOriginOffset: Vec2,
): void {
  const sceneZero = toSceneCoords({ x: -jobOriginOffset.x, y: -jobOriginOffset.y }, device);
  const sceneBasisOrigin = toSceneCoords({ x: 0, y: 0 }, device);
  const sceneBasisTip = toSceneCoords({ x: 1, y: 1 }, device);
  gridFrames.set(grid, {
    originMm: localFromScene({ ...sceneZero, z: 0 }, { x: grid.originX, y: grid.originY }, grid),
    xDirection: sceneBasisTip.x < sceneBasisOrigin.x ? -1 : 1,
    // The surface and every overlay share the viewer's final Y mirror.
    yDirection: sceneBasisTip.y < sceneBasisOrigin.y ? 1 : -1,
  });
}

export function cncCut3DWorkFrame(grid: RemovalGrid): ViewerWorkAxes | null {
  return gridFrames.get(grid) ?? null;
}
