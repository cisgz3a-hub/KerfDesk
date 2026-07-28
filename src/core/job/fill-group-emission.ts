import type { ScanOffsetPoint } from '../devices';
import { planFillSweeps } from './fill-sweep-plan';
import type { FillGroup } from './job';
import { offsetForSpeed } from './scan-offset';

/** Whether a compiled fill group retains at least one controller-visible sweep. */
export function hasExecutableFillSweep(
  group: FillGroup,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): boolean {
  if (group.fillRunwayPolicy !== 'feed-matched-every-sweep') return true;
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(scanningOffsets, group.speed);
  return planFillSweeps(group, scanOffsetMm).length > 0;
}
