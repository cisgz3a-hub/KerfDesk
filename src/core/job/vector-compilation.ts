import type { Group, JobDiagnostic } from './job';

// Groups plus operator diagnostics, shared by the vector compiler branches.
export type VectorCompilation = {
  readonly groups: ReadonlyArray<Group>;
  readonly diagnostics: ReadonlyArray<JobDiagnostic>;
};

export function vectorCompilation(parts: ReadonlyArray<VectorCompilation>): VectorCompilation {
  return {
    groups: parts.flatMap((part) => part.groups),
    diagnostics: parts.flatMap((part) => part.diagnostics),
  };
}
