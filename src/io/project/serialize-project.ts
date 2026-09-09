// serializeProject — turns a Project into a deterministic .lf2 string.
//
// Manual .lf2 files use 2-space JSON indentation; autosave can omit it.
// Both formats retain a trailing newline and LF endings. V8's
// JSON.stringify preserves property insertion order, and all our domain
// constructors use consistent literal-shape orderings, so output is
// byte-deterministic given a byte-deterministic Project.

import { polylineToCurveSubpath, type Project, type SceneObject } from '../../core/scene';
import { stringifyProjectJson } from './stringify-project-json';

export function serializeProject(
  project: Project,
  options: { readonly compact?: boolean } = {},
): string {
  const serializable = withCurveGeometry(project);
  const json = hasTypedRelief(project)
    ? stringifyProjectJson(serializable, options)
    : JSON.stringify(serializable, null, options.compact === true ? undefined : 2);
  return `${json}\n`;
}

function hasTypedRelief(project: Project): boolean {
  return project.scene.objects.some(
    (object) =>
      object.kind === 'relief' &&
      object.reliefSource.kind === 'legacy-mesh' &&
      (object.reliefSource.meshPositions instanceof Float32Array ||
        object.reliefSource.meshPositions instanceof Float64Array),
  );
}

function withCurveGeometry(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map(withSerializableObject),
    },
  };
}

function withSerializableObject(object: SceneObject): SceneObject {
  if (!('paths' in object)) return object;
  return {
    ...object,
    paths: object.paths.map((path) => ({
      ...path,
      curves: path.curves ?? path.polylines.map(polylineToCurveSubpath),
    })),
  };
}
