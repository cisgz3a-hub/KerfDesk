// "Park after job" and "Park height" in Job Review's machine facts. A configured
// park is a bed position that moves with the job (ADR-392); either field set
// makes one, the other axis reading 0 as the compiler does. With none set the
// program ends where the emitter's fallback puts it (ADR-392 Amendment 1): a
// Current Position job returns to its start, every other job to program X0 Y0.

import type { JobOriginPlacement } from '../../../core/job';
import type { CncMachineParams } from '../../../core/scene';
import { formatMm } from './job-review-format';

type ParkFact = {
  readonly label: string;
  readonly value: string;
  readonly tone: 'default' | 'warning';
};

export function parkFacts(
  params: Pick<CncMachineParams, 'parkXMm' | 'parkYMm' | 'safeZMm' | 'parkZMm'>,
  startFrom: JobOriginPlacement['startFrom'] | undefined,
  zTravelMm: number | undefined,
): ReadonlyArray<ParkFact> {
  return [
    { label: 'Park after job', value: parkLabel(params, startFrom), tone: 'default' },
    parkHeightFact(params, zTravelMm),
  ];
}

// ADR-491: before the job-end park and every bit change the bit lifts to the
// park height, never below safe Z. It is a work Z above the stock top, so a
// height at or above the recorded Z travel fits under no work zero (second CNC
// audit P2-gcode-1).
function parkHeightFact(
  params: Pick<CncMachineParams, 'safeZMm' | 'parkZMm'>,
  zTravelMm: number | undefined,
): ParkFact {
  const heightMm = Math.max(params.safeZMm, params.parkZMm ?? params.safeZMm);
  const value = `${formatMm(heightMm)} mm above stock top · job end and bit changes`;
  if (zTravelMm === undefined || heightMm < zTravelMm) {
    return { label: 'Park height', value, tone: 'default' };
  }
  return {
    label: 'Park height',
    value: `${value} · at or above the ${formatMm(zTravelMm)} mm Z travel`,
    tone: 'warning',
  };
}

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
