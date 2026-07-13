// serializeProject — turns a Project into a deterministic .lf2 string.
//
// .lf2 is JSON, 2-space indent, trailing newline, LF endings. V8's
// JSON.stringify preserves property insertion order, and all our domain
// constructors use consistent literal-shape orderings, so output is
// byte-deterministic given a byte-deterministic Project.

import { polylineToCurveSubpath, type Project } from '../../core/scene';

export function serializeProject(project: Project): string {
  return `${JSON.stringify(withCurveGeometry(project), null, 2)}\n`;
}

function withCurveGeometry(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        'paths' in object
          ? {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                curves: path.curves ?? path.polylines.map(polylineToCurveSubpath),
              })),
            }
          : object,
      ),
    },
  };
}
