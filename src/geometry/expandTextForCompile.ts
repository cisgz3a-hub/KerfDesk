/**
 * Clones the scene and attaches vector outlines to text objects so JobCompiler
 * can flatten them like path geometry (engrave fill, cut, etc.).
 */

import { type Scene } from '../core/scene/Scene';
import { type SceneObject, type SubPath } from '../core/scene/SceneObject';
import { textGeometryToPath } from './TextToPath';
import { textOutlineFingerprint } from './textOutlineFingerprint';

export { textOutlineFingerprint } from './textOutlineFingerprint';

export interface TextExpansionResult {
  scene: Scene;
  /** Names/IDs of text objects whose outlines could not be generated (potrace returned nothing). */
  failedTextObjects: string[];
}

const TEXT_OUTLINE_CACHE_MAX = 64;
/** Potrace results keyed by text geometry fingerprint (LRU). */
const textOutlineCache = new Map<string, SubPath[]>();

function cloneSubPaths(paths: SubPath[]): SubPath[] {
  return structuredClone(paths) as SubPath[];
}

function outlineCacheGet(key: string): SubPath[] | undefined {
  const v = textOutlineCache.get(key);
  if (!v) return undefined;
  textOutlineCache.delete(key);
  textOutlineCache.set(key, v);
  return cloneSubPaths(v);
}

function outlineCacheSet(key: string, paths: SubPath[]): void {
  textOutlineCache.delete(key);
  textOutlineCache.set(key, cloneSubPaths(paths));
  while (textOutlineCache.size > TEXT_OUTLINE_CACHE_MAX) {
    const oldestKey = textOutlineCache.keys().next().value;
    if (oldestKey === undefined) break;
    textOutlineCache.delete(oldestKey);
  }
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
    const fp = textOutlineFingerprint(g);
    const cached = outlineCacheGet(fp);
    if (cached) {
      changed = true;
      objects.push({
        ...obj,
        geometry: { ...g, outlineSubPaths: cached },
        _bounds: null,
        _worldTransform: null,
      });
      continue;
    }

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
    outlineCacheSet(fp, result.subPaths);
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
