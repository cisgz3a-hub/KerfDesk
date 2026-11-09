// Names the object a Save or autosave refusal is about (ADR-307 Amendment 5).
//
// The loader reports the first field it refuses as a path such as
// "missing or invalid `scene.objects[1].bounds.maxX`", which tells an operator
// nothing they can act on (rolling audit v11 W5-P2-1). When the path names a
// scene object, the refusal names that object instead, and when the object's
// coordinates are past the loader's limit it says so and what to do.

import type { Bounds, Project, SceneObject } from '../../core/scene';
import { boundsInRange, importedArtworkInRange } from './imported-artwork-range';
import { MAX_PROJECT_COORDINATE_MAGNITUDE_MM } from './project-shape-primitives';

const OBJECT_PATH = /`scene\.objects\[(\d+)\]/;

function objectBounds(object: SceneObject): Bounds | null {
  const bounds = (object as { readonly bounds?: unknown }).bounds;
  if (typeof bounds !== 'object' || bounds === null) return null;
  const { minX, minY, maxX, maxY } = bounds as Record<string, unknown>;
  return [minX, minY, maxX, maxY].every((value) => typeof value === 'number')
    ? (bounds as Bounds)
    : null;
}

/** False when the object stores a coordinate the project loader refuses. */
export function sceneObjectCoordinatesInRange(object: SceneObject): boolean {
  const bounds = objectBounds(object);
  if (bounds === null) return true;
  if (object.kind === 'imported-svg') return importedArtworkInRange(bounds, object.paths);
  return boundsInRange(bounds);
}

/** A short phrase naming the object the way the canvas and layers do. */
export function sceneObjectLabel(object: SceneObject, index: number): string {
  const name = object.name?.trim();
  if (name !== undefined && name !== '') return `object ${index + 1} (“${name}”)`;
  if (object.kind === 'imported-svg' && object.source.trim() !== '') {
    return `object ${index + 1} (imported from “${object.source}”)`;
  }
  return `object ${index + 1} (${object.kind.replace(/-/g, ' ')})`;
}

const LIMIT_TEXT = MAX_PROJECT_COORDINATE_MAGNITUDE_MM.toLocaleString('en-US');

/**
 * Rewrites a loader refusal that points into `scene.objects[i]` so it names
 * that object. Any other refusal is returned unchanged.
 */
export function nameRefusedSceneObject(project: Project, reason: string): string {
  const match = OBJECT_PATH.exec(reason);
  if (match === null) return reason;
  const index = Number(match[1]);
  const object = project.scene.objects[index];
  if (object === undefined) return reason;
  const label = sceneObjectLabel(object, index);
  if (!sceneObjectCoordinatesInRange(object)) {
    return (
      `${label} has coordinates past the ${LIMIT_TEXT} mm a project file can hold. ` +
      'Delete it (or undo its import) and save again.'
    );
  }
  return `${label} cannot be stored (${reason.replace(/\.$/, '')})`;
}
