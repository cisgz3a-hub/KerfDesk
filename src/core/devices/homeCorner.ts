import type { MachineOriginCorner } from './DeviceProfile';

/**
 * Infer the XY corner GRBL searches during homing from $23.
 *
 * GRBL defaults to positive homing on X/Y. Bit 0 inverts X, bit 1 inverts Y.
 * With LaserForge's normal bed vocabulary, X+ is right and Y+ is rear.
 */
export function inferHomeCornerFromGrblHomingDir(mask: number): MachineOriginCorner | null {
  if (!Number.isInteger(mask) || mask < 0 || mask > 3) return null;
  const xNegative = (mask & 1) !== 0;
  const yNegative = (mask & 2) !== 0;
  const side = xNegative ? 'left' : 'right';
  const depth = yNegative ? 'front' : 'rear';
  return `${depth}-${side}` as MachineOriginCorner;
}
