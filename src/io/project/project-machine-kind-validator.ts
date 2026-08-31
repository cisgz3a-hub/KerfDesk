import { isObject, requireLiteral } from './project-shape-primitives';

export function validateProjectMachineKind(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `machine`';
  return requireLiteral(value, 'machine.kind', ['laser', 'cnc']);
}
