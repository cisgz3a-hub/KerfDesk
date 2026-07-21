// Builds the FillGroup literal for a scanline or Follow Shape (offset) fill
// layer — island fill has its own group builder in compile-job.ts. Split out
// of compile-job.ts (ADR-239) so that file stays under the size cap while the
// offset style gains its tangential contour-entry field.

import type { DeviceProfile } from '../devices';
import type { Layer } from '../scene';
import { contourEntryRunwayMm } from './contour-entry';
import { fillRunwayPolicyForDevice } from './fill-runway-policy';
import type { FillGroup, FillSegment } from './job';
import type { EffectiveScanDirection } from './scan-direction-policy';
import { validatedScanOffsetMm } from './scan-offset';
import type { commonVectorGroupFields } from './vector-group-fields';

export function buildFillGroup(args: {
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly common: ReturnType<typeof commonVectorGroupFields>;
  readonly scanDirection: EffectiveScanDirection;
  readonly segments: ReadonlyArray<FillSegment>;
}): FillGroup {
  const { layer, device } = args;
  const isOffset = layer.fillStyle === 'offset';
  const scanOffsetMm = validatedScanOffsetMm(device, layer.bidirectionalScanOffsetMm);
  const fillRunwayPolicy = isOffset ? undefined : fillRunwayPolicyForDevice(device);
  // ADR-239: Follow Shape loops get tangential feed-matched entries on the
  // 4040-safe profile; scanline/island sweeps use fillRunwayPolicy instead.
  const entryRunwayMm = isOffset ? contourEntryRunwayMm(device, layer.fillOverscanMm) : undefined;
  return {
    ...args.common,
    kind: 'fill' as const,
    fillStyle: layer.fillStyle,
    ...(fillRunwayPolicy === undefined ? {} : { fillRunwayPolicy }),
    ...(entryRunwayMm === undefined ? {} : { entryRunwayMm }),
    ...(isOffset ? {} : { scanDirection: args.scanDirection }),
    ...(isOffset || scanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm: scanOffsetMm }),
    overscanMm: Math.max(0, layer.fillOverscanMm),
    segments: args.segments,
  };
}
