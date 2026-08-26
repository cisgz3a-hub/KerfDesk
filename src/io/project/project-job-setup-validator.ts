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
    requireLiteral(placement, 'jobSetup.placement.startFrom', [
      'absolute',
      'current-position',
      'user-origin',
      'verified-origin',
    ]),
    requireLiteral(placement, 'jobSetup.placement.anchor', [
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
    requireBoolean(outputScope, 'jobSetup.outputScope.cutSelectedGraphics'),
    requireBoolean(outputScope, 'jobSetup.outputScope.useSelectionOrigin'),
    Array.isArray(selectedObjectIds)
      ? validateArray(selectedObjectIds, 'jobSetup.outputScope.selectedObjectIds', (entry, path) =>
          typeof entry === 'string' ? null : `missing or invalid \`${path}\``,
        )
      : 'missing or invalid `jobSetup.outputScope.selectedObjectIds`',
  ]);
}
