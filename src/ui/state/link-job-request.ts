// What a controller-link job compiles from (ADR-705 Amendment 4, code quality
// audit C2 D2-P1-1 and D2-P2-3). The Moshi USB and Ruida network panels build
// their Frame and Start from this one request, so they take what Save and
// G-code Start take from the canvas:
// - the job placement;
// - the output scope, so "Selected artwork only" and "Anchor from selected
//   artwork" apply as they do on G-code and Save .rd;
// - the "After completed job" variable advance, run when the machine
//   reports the job finished.

import { DEFAULT_OUTPUT_SCOPE, type OutputScope, type Project } from '../../core/scene';
import type { JobPlacementSettings } from '../../core/job';
import { useStore } from './store';
import { currentOutputScope } from './output-scope-state';

export type LinkJobRequest = {
  readonly project: Project;
  readonly placement: JobPlacementSettings;
  readonly outputScope: OutputScope;
  /** Runs when the machine reports the job finished: the variable advance. */
  readonly completed: () => void;
};

/** A request for `project`, advancing its variables once the job finishes. */
export function linkJobRequest(
  project: Project,
  placement: JobPlacementSettings,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): LinkJobRequest {
  return {
    project,
    placement,
    outputScope,
    completed: () =>
      useStore.getState().advanceVariablesAfter(project, 'successful-stream', outputScope),
  };
}

/** The request for the canvas as it stands: project, placement and scope. */
export function currentLinkJobRequest(): LinkJobRequest {
  const app = useStore.getState();
  return linkJobRequest(app.project, app.jobPlacement, currentOutputScope(app));
}
