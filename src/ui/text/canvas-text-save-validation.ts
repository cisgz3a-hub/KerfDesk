import type { Project, TextObject } from '../../core/scene';
import type { DialogValues } from './use-text-dialog-fields';

/** A guide can change through the object controls while a save is rendering. */
export function assertCanvasTextGuideCurrent(values: DialogValues, project: Project): void {
  if (values.pathText === undefined) return;
  const current = project.scene.objects.find(
    (object) => object.id === values.pathText?.guideObjectId,
  );
  if (values.pathGuide === undefined || current !== values.pathGuide) {
    throw new Error(
      'The guide path changed while text was updating. Review the guide and try again.',
    );
  }
}

export function canvasTextUnchanged(original: TextObject | null, next: TextObject): boolean {
  if (original === null) return false;
  const keys = [
    'content',
    'fontKey',
    'sizeMm',
    'alignment',
    'lineHeight',
    'letterSpacing',
    'color',
  ] as const;
  return (
    keys.every((key) => original[key] === next[key]) &&
    (original.bendDeg ?? 0) === (next.bendDeg ?? 0) &&
    (original.weldOverlaps ?? false) === (next.weldOverlaps ?? false) &&
    sameValue(original.pathText, next.pathText) &&
    sameValue(original.variableTemplate, next.variableTemplate) &&
    // Reopening linked text rebuilds its geometry against the current guide,
    // even if the lettering settings themselves have not changed.
    (next.pathText === undefined || samePlacement(original, next))
  );
}

function samePlacement(original: TextObject, next: TextObject): boolean {
  return (
    sameValue(original.transform, next.transform) &&
    sameValue(original.bounds, next.bounds) &&
    sameValue(original.paths, next.paths)
  );
}

/** Compare persisted values without making JSON property order significant. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameValue(a[key], b[key]))
  );
}
