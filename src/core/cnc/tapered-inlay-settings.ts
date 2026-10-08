import type { CncTaperedInlaySettings } from '../scene/cnc-tapered-inlay';
import type { CncTool } from '../scene';

const INLAY_LENGTH_KEYS = [
  'pocketStartDepthMm',
  'plugStartDepthMm',
  'pocketDepthMm',
  'engagementDepthMm',
  'glueGapMm',
  'surfaceClearanceMm',
  'fitClearanceMm',
  'pairSpacingMm',
  'plugBorderMm',
] as const;

export function normalizeCncTaperedInlay(raw: unknown): CncTaperedInlaySettings | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (value['kind'] !== 'tapered-v') return undefined;
  const lengths: Record<string, number> = {};
  for (const key of INLAY_LENGTH_KEYS) {
    const length = value[key];
    if (typeof length !== 'number' || !Number.isFinite(length) || length < 0 || length > 1000)
      return undefined;
    lengths[key] = length;
  }
  const settings = { kind: 'tapered-v', ...lengths } as CncTaperedInlaySettings;
  return taperedInlaySettingsIssue(settings) === null ? settings : undefined;
}

export function taperedInlaySettingsIssue(settings: CncTaperedInlaySettings): string | null {
  if (
    settings.kind !== 'tapered-v' ||
    INLAY_LENGTH_KEYS.some(
      (key) => !Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1000,
    )
  )
    return 'Tapered inlay dimensions must be finite nonnegative millimetres.';
  if (!(settings.pocketDepthMm > 0 && settings.engagementDepthMm > 0))
    return 'Tapered inlay pocket and engagement depths must be positive.';
  if (!(settings.surfaceClearanceMm > 0 && settings.pairSpacingMm > 0 && settings.plugBorderMm > 0))
    return 'Tapered inlay surface clearance, pair spacing and plug border must be positive.';
  if (Math.abs(settings.pocketDepthMm - settings.engagementDepthMm - settings.glueGapMm) > 0.000001)
    return 'Pocket depth must equal engagement depth plus the axial glue gap.';
  return null;
}

export function taperedInlayToolIssue(
  tool: CncTool,
  settings: CncTaperedInlaySettings,
): string | null {
  if (tool.kind !== 'v-bit') return 'Tapered inlays require the same V-bit for pocket and plug.';
  const angle = tool.tipAngleDeg;
  if (angle === undefined || !Number.isFinite(angle) || angle <= 0 || angle >= 180)
    return 'Tapered inlays require a known valid included V-bit angle.';
  if ((tool.tipDiameterMm ?? 0) !== 0)
    return 'Tapered inlay contact currently requires a pointed V-bit; a flat tip is unmodeled.';
  const slope = taperedInlaySlope(angle);
  const requiredDepth = Math.max(settings.pocketDepthMm, taperedInlayPlugDepth(settings));
  if (
    !(tool.diameterMm > 0) ||
    !Number.isFinite(tool.diameterMm) ||
    requiredDepth * slope > tool.diameterMm / 2 + 0.000001
  )
    return 'The V-bit cutting diameter cannot reach the requested pocket or plug depth.';
  const minimumBorder = (settings.engagementDepthMm + 2 * settings.surfaceClearanceMm) * slope;
  return settings.plugBorderMm + settings.fitClearanceMm + 0.001 < minimumBorder
    ? `Plug border needs at least ${Math.ceil((minimumBorder - settings.fitClearanceMm) * 1000) / 1000} mm for the requested tapered wall.`
    : null;
}

export function taperedInlaySlope(includedAngleDeg: number): number {
  return Math.tan((includedAngleDeg * Math.PI) / 360);
}

export function taperedInlayPlugDepth(settings: CncTaperedInlaySettings): number {
  return settings.engagementDepthMm + settings.surfaceClearanceMm;
}

/** Straight-wall radial offset after flipping the plug into the pocket. */
export function taperedInlayContactAtDepth(
  settings: CncTaperedInlaySettings,
  includedAngleDeg: number,
  pocketDepthMm: number,
): { readonly pocketInsetMm: number; readonly plugInsetMm: number; readonly radialGapMm: number } {
  const slope = taperedInlaySlope(includedAngleDeg);
  const pocketInsetMm = pocketDepthMm * slope;
  const plugDepthMm = settings.engagementDepthMm - pocketDepthMm;
  const plugInsetMm =
    settings.engagementDepthMm * slope + settings.fitClearanceMm - plugDepthMm * slope;
  return { pocketInsetMm, plugInsetMm, radialGapMm: plugInsetMm - pocketInsetMm };
}
