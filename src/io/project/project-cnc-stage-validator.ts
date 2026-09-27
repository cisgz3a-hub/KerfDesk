import { CNC_CUTTING_STAGES } from '../../core/scene/cnc-stage-recipe';
import {
  firstError,
  isObject,
  requirePositiveNumber,
  requireString,
} from './project-shape-primitives';

// A malformed physical recipe is a document-integrity error, never silently
// replaced with another cutter's feed or an arbitrary default.
export function validateCncStageRecipes(cnc: unknown, path: string): string | null {
  if (!isObject(cnc) || cnc['stageRecipes'] === undefined) return null;
  const recipes = cnc['stageRecipes'];
  if (!isObject(recipes)) return `missing or invalid \`${path}.stageRecipes\``;
  for (const [stage, value] of Object.entries(recipes)) {
    const at = `${path}.stageRecipes.${stage}`;
    if (!CNC_CUTTING_STAGES.some((key) => key === stage) || !isObject(value))
      return `missing or invalid \`${at}\``;
    const error = firstError([
      requireString(value, `${at}.toolId`),
      requirePositiveNumber(value, `${at}.feedMmPerMin`),
      requirePositiveNumber(value, `${at}.plungeMmPerMin`),
      requirePositiveNumber(value, `${at}.spindleRpm`),
      requirePositiveNumber(value, `${at}.depthPerPassMm`),
    ]);
    if (error !== null) return error;
  }
  return null;
}
