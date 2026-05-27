// OutputStrategy — the abstraction over controller dialects (ADR-006).
// Phase A ships only GRBL; the interface is here so Phase G's Marlin/etc. can
// land as additional implementations without touching JobCompiler.

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';

export type OutputStrategy = {
  // Discriminator on the future union — GrblStrategy returns 'grbl'. New
  // strategies add a literal here and a discriminated case at the call site.
  readonly id: 'grbl';

  // Emit a deterministic G-code string for `job` against `device`. Same input
  // + same params → byte-identical output (PROJECT.md non-negotiable #5).
  readonly emit: (job: Job, device: DeviceProfile) => string;
};
