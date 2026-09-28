import {
  firstError,
  isObject,
  requireBoolean,
  requireLiteral,
  validateArray,
} from './project-shape-primitives';

export function validateProjectJobSetup(value: unknown): string | null {
  if (!isObject(value)) return 'missing or invalid `jobSetup`';
  const placement = value['placement'];
  const outputScope = value['outputScope'];
  if (!isObject(placement)) return 'missing or invalid `jobSetup.placement`';
  if (!isObject(outputScope)) return 'missing or invalid `jobSetup.outputScope`';
  const selectedObjectIds = outputScope['selectedObjectIds'];
  return firstError([
    validatePlacement(placement, 'jobSetup.placement'),
    value['parkedPlacement'] === undefined
      ? null
      : isObject(value['parkedPlacement'])
        ? validatePlacement(value['parkedPlacement'], 'jobSetup.parkedPlacement')
        : 'missing or invalid `jobSetup.parkedPlacement`',
    requireBoolean(outputScope, 'jobSetup.outputScope.cutSelectedGraphics'),
    requireBoolean(outputScope, 'jobSetup.outputScope.useSelectionOrigin'),
    Array.isArray(selectedObjectIds)
      ? validateArray(selectedObjectIds, 'jobSetup.outputScope.selectedObjectIds', (entry, path) =>
          typeof entry === 'string' ? null : `missing or invalid \`${path}\``,
        )
      : 'missing or invalid `jobSetup.outputScope.selectedObjectIds`',
    value['laserMaterial'] === undefined ? null : validateLaserMaterial(value['laserMaterial']),
  ]);
}

// ADR-496: optional, so projects saved before it and older builds agree.
function validateLaserMaterial(value: unknown): string | null {
  const path = 'jobSetup.laserMaterial';
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const name = value['name'];
  const thicknessMm = value['thicknessMm'];
  if (typeof name !== 'string' || name.trim() === '') return `missing or invalid \`${path}.name\``;
  if (
    thicknessMm !== undefined &&
    (typeof thicknessMm !== 'number' || !Number.isFinite(thicknessMm) || thicknessMm <= 0)
  ) {
    return `missing or invalid \`${path}.thicknessMm\``;
  }
  return requireBoolean(value, `${path}.autoApplyRecipes`);
}

function validatePlacement(placement: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireLiteral(placement, `${path}.startFrom`, [
      'absolute',
      'current-position',
      'user-origin',
      'verified-origin',
    ]),
    requireLiteral(placement, `${path}.anchor`, [
      'front-left',
      'front-center',
      'front-right',
      'center-left',
      'center',
      'center-right',
      'back-left',
      'back-center',
      'back-right',
    ]),
  ]);
}
