import type { CncLayerSettings } from '../../core/scene';
import { isRecord } from '../../core/util/is-record';
import { isPositiveFiniteNumber, isNonNegativeFiniteNumber } from '../../core/util/finite';

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
  if (threshold !== undefined && !isNonNegativeFiniteNumber(threshold))
    return `${path}.reliefRestResidualMm must be finite non-negative millimetres.`;
  const scallop = raw['reliefRestScallopMm'];
  if (scallop !== undefined && !isPositiveFiniteNumber(scallop))
    return `${path}.reliefRestScallopMm must be finite positive millimetres.`;
  return projectionError(raw['reliefProjection'], path);
}
function projectionError(projection: unknown, path: string): string | null {
  if (projection === undefined) return null;
  if (
    !isRecord(projection) ||
    !identifier(projection['reliefObjectId']) ||
    !isPositiveFiniteNumber(projection['depthMm']) ||
    projection['depthConvention'] !== 'vertical' ||
    !isPositiveFiniteNumber(projection['sampleSpacingMm'])
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
    ...(isNonNegativeFiniteNumber(raw['reliefRestResidualMm'])
      ? { reliefRestResidualMm: raw['reliefRestResidualMm'] }
      : {}),
    ...(isPositiveFiniteNumber(raw['reliefRestScallopMm'])
      ? { reliefRestScallopMm: raw['reliefRestScallopMm'] }
      : {}),
    ...(isRecord(projection) &&
    identifier(projection['reliefObjectId']) &&
    isPositiveFiniteNumber(projection['depthMm']) &&
    projection['depthConvention'] === 'vertical' &&
    isPositiveFiniteNumber(projection['sampleSpacingMm'])
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
