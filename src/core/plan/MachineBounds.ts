import type { GcodeStartMode } from '../output/GcodeOrigin';

export interface MachineBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MachineAnchor {
  x: number;
  y: number;
}

export function usesLocalWorkCoordinates(startMode: GcodeStartMode): boolean {
  return startMode === 'current' || startMode === 'savedOrigin';
}

export function physicalBoundsFromWorkBounds(
  bounds: MachineBounds,
  startMode: GcodeStartMode | undefined,
  workOrigin: MachineAnchor | null | undefined,
): MachineBounds {
  if (!startMode || !usesLocalWorkCoordinates(startMode) || !workOrigin) {
    return bounds;
  }

  return {
    minX: workOrigin.x + bounds.minX,
    minY: workOrigin.y + bounds.minY,
    maxX: workOrigin.x + bounds.maxX,
    maxY: workOrigin.y + bounds.maxY,
  };
}
