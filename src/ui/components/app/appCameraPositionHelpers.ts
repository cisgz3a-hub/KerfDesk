import type { Scene } from '../../../core/scene/Scene';
import type { SceneCommitAction } from '../../scene/SceneCommitActions';

export interface CameraPositionCommit {
  scene: Scene;
  action: Extract<SceneCommitAction, 'camera-position'>;
}

/**
 * T2-6 Phase 3ae: pure camera-position scene transaction builder.
 * App.tsx still owns the UI callback wiring; this helper owns the
 * target-anchor scan and object transform replacement.
 */
export function buildCameraPositionCommit(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  worldX: number,
  worldY: number,
): CameraPositionCommit | null {
  if (selectedIds.size === 0) {
    let minX = Infinity;
    let minY = Infinity;
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      minX = Math.min(minX, obj.transform.tx);
      minY = Math.min(minY, obj.transform.ty);
    }
    if (!Number.isFinite(minX)) return null;
    const dx = worldX - minX;
    const dy = worldY - minY;
    return {
      scene: {
        ...scene,
        objects: scene.objects.map(o => ({
          ...o,
          transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy },
        })),
      },
      action: 'camera-position',
    };
  }

  const selected = scene.objects.filter(o => selectedIds.has(o.id));
  let minX = Infinity;
  let minY = Infinity;
  for (const o of selected) {
    minX = Math.min(minX, o.transform.tx);
    minY = Math.min(minY, o.transform.ty);
  }
  const dx = worldX - minX;
  const dy = worldY - minY;
  return {
    scene: {
      ...scene,
      objects: scene.objects.map(o =>
        selectedIds.has(o.id)
          ? { ...o, transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy } }
          : o
      ),
    },
    action: 'camera-position',
  };
}
