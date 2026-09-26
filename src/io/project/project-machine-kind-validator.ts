import { isObject, requireLiteral } from './project-shape-primitives';

export function validateProjectMachineKind(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `machine`';
  return requireLiteral(value, 'machine.kind', ['laser', 'cnc']);
}

// A CNC setup parked while the project is in Laser mode. Its fields are
// rebuilt from defaults on load, so only the kind is checked here.
export function validateParkedCncMachine(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'invalid `parkedCncMachine`';
  return requireLiteral(value, 'parkedCncMachine.kind', ['cnc']);
}
