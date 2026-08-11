// serializeProject — turns a Project into a deterministic .lf2 string.
//
// .lf2 is JSON, 2-space indent, trailing newline, LF endings. V8's
// JSON.stringify preserves property insertion order, and all our domain
// constructors use consistent literal-shape orderings, so output is
// byte-deterministic given a byte-deterministic Project.

import { polylineToCurveSubpath, type Project, type SceneObject } from '../../core/scene';
import { stringifyProjectJson } from './stringify-project-json';

export function serializeProject(project: Project): string {
  const serializable = withCurveGeometry(project);
  const json = hasTypedRelief(project)
    ? stringifyProjectJson(serializable)
    : JSON.stringify(serializable, null, 2);
  return `${json}\n`;
}

function hasTypedRelief(project: Project): boolean {
  return project.scene.objects.some(
    (object) =>
      object.kind === 'relief' &&
      object.reliefSource.kind === 'legacy-mesh' &&
      object.reliefSource.meshPositions instanceof Float32Array,
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
