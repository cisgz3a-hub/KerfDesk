// Test support: build the FrameVerification a Start would accept for a
// project, by compiling the same job the frame-first gate will compare
// against. Lives beside the gate (like job-review/testing.ts) so Start tests
// can pass the gate without re-deriving compile internals.

import type { JobOriginPlacement } from '../../core/job';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type { FrameVerification } from '../state/frame-verification';
import type { WorkCoordinateOffset } from '../state/origin-actions';

export function frameVerificationForProject(
  project: Project,
  options: {
    readonly jobOrigin?: JobOriginPlacement;
    readonly outputScope?: OutputScope;
    readonly wco?: WorkCoordinateOffset | null;
    readonly workOriginActive?: boolean;
  } = {},
): FrameVerification {
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    outputScope: options.outputScope ?? DEFAULT_OUTPUT_SCOPE,
  });
  if (!prepared.ok) {
    throw new Error(
      `frameVerificationForProject: compile failed — ${prepared.preflight.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  const bounds = computeJobBounds(prepared.job, project.device);
  if (bounds === null) {
    throw new Error('frameVerificationForProject: the compiled job has no bounds to frame.');
  }
  return {
    boundsSignature: frameBoundsSignature(bounds),
    wco: options.wco ?? null,
    workOriginActive: options.workOriginActive === true,
  };
}
