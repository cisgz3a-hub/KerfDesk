import type { Project } from '../../core/scene';

const PROBE_SETUP_HISTORY_IDENTITY = Symbol('probeSetupHistoryIdentity');

type ProbeSetupTaggedProject = Project & {
  readonly [PROBE_SETUP_HISTORY_IDENTITY]?: number;
};

/**
 * Mark a committed machine/setup replacement without persisting that
 * session-only identity into project JSON. Enumerable symbol properties follow
 * ordinary immutable Project spreads, while JSON serialization ignores them.
 */
export function projectWithProbeSetupHistoryIdentity(project: Project, identity: number): Project {
  const tagged: ProbeSetupTaggedProject = {
    ...project,
    [PROBE_SETUP_HISTORY_IDENTITY]: identity,
  };
  return tagged;
}

/** Ordinary project/profile edits inherit the same marker; setup replacements do not. */
export function projectsShareProbeSetupIdentity(a: Project, b: Project): boolean {
  return (
    (a as ProbeSetupTaggedProject)[PROBE_SETUP_HISTORY_IDENTITY] ===
    (b as ProbeSetupTaggedProject)[PROBE_SETUP_HISTORY_IDENTITY]
  );
}

export function nextProbeSetupState(
  project: Project,
  currentEpoch: number,
): { readonly project: Project; readonly probeSetupEpoch: number } {
  const probeSetupEpoch = currentEpoch + 1;
  return {
    project: projectWithProbeSetupHistoryIdentity(project, probeSetupEpoch),
    probeSetupEpoch,
  };
}
