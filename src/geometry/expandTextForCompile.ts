/**
 * Clones the scene and attaches vector outlines to text objects so JobCompiler
 * can flatten them like path geometry (engrave fill, cut, etc.).
 */

import { type Scene } from '../core/scene/Scene';
import { type SceneObject } from '../core/scene/SceneObject';
import { textGeometryToPath } from './TextToPath';

export async function expandTextOutlinesForCompile(scene: Scene): Promise<Scene> {
  const objects: SceneObject[] = [];
  let changed = false;

  for (const obj of scene.objects) {
    if (obj.geometry.type !== 'text') {
      objects.push(obj);
      continue;
    }
    const g = obj.geometry;
    const result = await textGeometryToPath(g);
    if (!result?.subPaths.length) {
      objects.push({
        ...obj,
        geometry: { ...g, outlineSubPaths: undefined },
        _bounds: null,
        _worldTransform: null,
      });
      continue;
    }
    changed = true;
    objects.push({
      ...obj,
      geometry: { ...g, outlineSubPaths: result.subPaths },
      _bounds: null,
      _worldTransform: null,
    });
  }

  return changed ? { ...scene, objects } : scene;
}
