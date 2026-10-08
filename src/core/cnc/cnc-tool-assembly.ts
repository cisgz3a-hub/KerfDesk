import type { CncTool, CncToolHolderSegment } from '../scene/cnc-tool';

export type CncToolAssemblyMetadata = Pick<
  CncTool,
  'fluteLengthMm' | 'stickoutMm' | 'shankDiameterMm' | 'holderSegments'
>;

/** Optional dimensions are field-safe. A malformed holder is unknown, never a partial clear envelope. */
export function normalizeCncToolAssembly(raw: unknown): CncToolAssemblyMetadata {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const fluteLengthMm = record['fluteLengthMm'];
  const stickoutMm = record['stickoutMm'];
  const shankDiameterMm = record['shankDiameterMm'];
  const holderSegments = normalizeHolderSegments(record['holderSegments']);
  return {
    ...(positive(fluteLengthMm) ? { fluteLengthMm } : {}),
    ...(positive(stickoutMm) ? { stickoutMm } : {}),
    ...(positive(shankDiameterMm) ? { shankDiameterMm } : {}),
    ...(holderSegments === null ? {} : { holderSegments }),
  };
}

function normalizeHolderSegments(raw: unknown): ReadonlyArray<CncToolHolderSegment> | null {
  if (!Array.isArray(raw) || raw.length > 32) return null;
  const out: CncToolHolderSegment[] = [];
  for (const item of raw) {
    const segment = normalizeSegment(item);
    if (segment === null) return null;
    out.push(segment);
  }
  return out;
}

function normalizeSegment(raw: unknown): CncToolHolderSegment | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = item['name'];
  const startMm = item['startMm'];
  const lengthMm = item['lengthMm'];
  const diameterMm = item['diameterMm'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > 120) return null;
  if (!finite(startMm) || startMm < 0 || !positive(lengthMm) || !positive(diameterMm)) return null;
  if (!Number.isFinite(startMm + lengthMm)) return null;
  return { name, startMm, lengthMm, diameterMm };
}

export function cncToolAssemblySignature(tool: CncTool): string {
  return JSON.stringify([
    tool.kind,
    tool.diameterMm,
    tool.tipAngleDeg ?? null,
    tool.tipDiameterMm ?? null,
    tool.fluteLengthMm ?? null,
    tool.stickoutMm ?? null,
    tool.shankDiameterMm ?? null,
    tool.holderSegments ?? null,
  ]);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}
