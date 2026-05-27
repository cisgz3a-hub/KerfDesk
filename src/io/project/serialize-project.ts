// serializeProject — turns a Project into a deterministic .lf2 string.
//
// .lf2 is JSON, 2-space indent, trailing newline, LF endings. V8's
// JSON.stringify preserves property insertion order, and all our domain
// constructors use consistent literal-shape orderings, so output is
// byte-deterministic given a byte-deterministic Project.

import type { Project } from '../../core/scene';

export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}
