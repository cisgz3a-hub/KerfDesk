/**
 * Clones the scene and attaches vector outlines to text objects so JobCompiler
 * can flatten them like path geometry (engrave fill, cut, etc.).
 */

import { type Scene } from '../core/scene/Scene';
import { type SceneObject } from '../core/scene/SceneObject';
import { textGeometryToPath } from './TextToPath';

export interface TextExpansionResult {
  scene: Scene;
  /** Names/IDs of text objects whose outlines could not be generated (potrace returned nothing). */
  failedTextObjects: string[];
}

export async function expandTextOutlinesForCompile(scene: Scene): Promise<TextExpansionResult> {
  const objects: SceneObject[] = [];
  let changed = false;
  const failedTextObjects: string[] = [];

  for (const obj of scene.objects) {
    if (obj.geometry.type !== 'text') {
      objects.push(obj);
      continue;
    }
    const g = obj.geometry;
    const result = await textGeometryToPath(g);
    if (!result?.subPaths.length) {
      failedTextObjects.push(obj.name || obj.id);
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

  const outScene = changed ? { ...scene, objects } : scene;
  return { scene: outScene, failedTextObjects };
}
