// OutputStrategy — the abstraction over controller dialects (ADR-006).
// Phase A ships only GRBL; the interface is here so Phase H's Marlin/etc. can
// land as additional implementations without touching JobCompiler. (Drawing
// tools took the Phase G slot — see PROJECT.md "Anything past Phase F".)

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import type { Vec2 } from '../scene';

export type OutputEmitOptions = {
  /** Explicit beam-off position for the final move. When absent, the selected
   * device dialect keeps its normal finish policy. */
  readonly finishPosition?: Vec2;
};

export type OutputStrategy = {
  // Discriminator on the strategy union (ADR-095 added 'marlin'; the CNC
  // router strategy is 'grbl-cnc'). New strategies add a literal here and a
  // case in select-output-strategy (machine-kind CNC short-circuits first).
  readonly id: 'grbl' | 'grbl-cnc' | 'marlin' | 'smoothieware';

  // Emit a deterministic G-code string for `job` against `device`. Same input
  // + same params → byte-identical output (PROJECT.md non-negotiable #5).
  readonly emit: (job: Job, device: DeviceProfile, options?: OutputEmitOptions) => string;
};
