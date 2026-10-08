import type { CncLayerSettings } from '../../core/scene';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 1024;

export function validateCncReliefAuthoringSettings(
  raw: Record<string, unknown>,
  path: string,
): string | null {
  const tool = raw['reliefRestFinishToolId'];
  if (tool !== undefined && !identifier(tool))
    return `${path}.reliefRestFinishToolId must name a cutter.`;
  const threshold = raw['reliefRestResidualMm'];
  if (threshold !== undefined && !nonNegative(threshold))
    return `${path}.reliefRestResidualMm must be finite non-negative millimetres.`;
  const scallop = raw['reliefRestScallopMm'];
  if (scallop !== undefined && !positive(scallop))
    return `${path}.reliefRestScallopMm must be finite positive millimetres.`;
  return projectionError(raw['reliefProjection'], path);
}
function projectionError(projection: unknown, path: string): string | null {
  if (projection === undefined) return null;
  if (
    !isRecord(projection) ||
    !identifier(projection['reliefObjectId']) ||
    !positive(projection['depthMm']) ||
    projection['depthConvention'] !== 'vertical' ||
    !positive(projection['sampleSpacingMm'])
  )
    return `${path}.reliefProjection requires a target relief, positive depth/sample spacing in millimetres and the vertical depth convention.`;
  return null;
}

/** Only admitted optional values survive; absent legacy settings remain absent. */
export function normalizeCncReliefAuthoringSettings(
  raw: Record<string, unknown>,
): Partial<CncLayerSettings> {
  const projection = raw['reliefProjection'];
  return {
    ...(identifier(raw['reliefRestFinishToolId'])
      ? { reliefRestFinishToolId: raw['reliefRestFinishToolId'] }
      : {}),
    ...(nonNegative(raw['reliefRestResidualMm'])
      ? { reliefRestResidualMm: raw['reliefRestResidualMm'] }
      : {}),
    ...(positive(raw['reliefRestScallopMm'])
      ? { reliefRestScallopMm: raw['reliefRestScallopMm'] }
      : {}),
    ...(isRecord(projection) &&
    identifier(projection['reliefObjectId']) &&
    positive(projection['depthMm']) &&
    projection['depthConvention'] === 'vertical' &&
    positive(projection['sampleSpacingMm'])
      ? {
          reliefProjection: {
            reliefObjectId: projection['reliefObjectId'],
            depthMm: projection['depthMm'],
            depthConvention: 'vertical' as const,
            sampleSpacingMm: projection['sampleSpacingMm'],
          },
        }
      : {}),
  };
}
