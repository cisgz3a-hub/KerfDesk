// "Park after job" in Job Review's machine facts. A configured park is a bed
// position that moves with the job (ADR-392); either field set makes one, the
// other axis reading 0 as the compiler does. With none set the program ends
// where the emitter's fallback puts it (ADR-392 Amendment 1): a Current Position
// job returns to its start, every other job to program X0 Y0.

import type { JobOriginPlacement } from '../../../core/job';
import type { CncMachineParams } from '../../../core/scene';
import { formatMm } from './job-review-format';

export function parkLabel(
  params: Pick<CncMachineParams, 'parkXMm' | 'parkYMm'>,
  startFrom: JobOriginPlacement['startFrom'] | undefined,
): string {
  if (params.parkXMm !== undefined || params.parkYMm !== undefined) {
    return `Bed X ${formatMm(params.parkXMm ?? 0)} · Y ${formatMm(params.parkYMm ?? 0)}`;
  }
  if (startFrom === 'current-position') return 'Not set · back to where the job started';
  if (startFrom === undefined) return 'Not set · program X0 Y0, or a Current Position job start';
  return 'Not set · program X0 Y0';
}
