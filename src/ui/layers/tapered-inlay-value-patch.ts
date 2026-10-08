import type { CncTaperedInlaySettings } from '../../core/scene/cnc-tapered-inlay';

type InlayLength = Exclude<keyof CncTaperedInlaySettings, 'kind'>;

/** Linked axial dimensions stay consistent while radial fit remains independent. */
export function taperedInlayValuePatch(
  current: CncTaperedInlaySettings,
  key: InlayLength,
  value: number,
): CncTaperedInlaySettings {
  if (key === 'pocketDepthMm') {
    const glueGapMm = Math.min(current.glueGapMm, Math.max(0, value - 0.01));
    return { ...current, pocketDepthMm: value, glueGapMm, engagementDepthMm: value - glueGapMm };
  }
  if (key === 'engagementDepthMm')
    return { ...current, engagementDepthMm: value, pocketDepthMm: value + current.glueGapMm };
  if (key === 'glueGapMm')
    return { ...current, glueGapMm: value, pocketDepthMm: current.engagementDepthMm + value };
  return { ...current, [key]: value };
}
