// OutputStrategy — the abstraction over controller dialects (ADR-006).
// Phase A ships only GRBL; the interface is here so Phase H's Marlin/etc. can
// land as additional implementations without touching JobCompiler. (Drawing
// tools took the Phase G slot — see PROJECT.md "Anything past Phase F".)

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';

export type OutputStrategy = {
  // Discriminator on the strategy union (ADR-095 added 'marlin'). New
  // strategies add a literal here and a case in select-output-strategy.
  readonly id: 'grbl' | 'marlin';

  // Emit a deterministic G-code string for `job` against `device`. Same input
  // + same params → byte-identical output (PROJECT.md non-negotiable #5).
  readonly emit: (job: Job, device: DeviceProfile) => string;
};
