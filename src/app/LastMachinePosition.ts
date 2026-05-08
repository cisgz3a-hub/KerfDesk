/**
 * Session-local helper for returning the head to the position it occupied
 * when the accepted job started.
 *
 * The helper deliberately plans relative jogs instead of absolute G-code.
 * Callers keep using ExecutionCoordinator.jog so the existing idle gate,
 * operation mutex, simulator notification, and controller jog implementation
 * remain the only path that moves the machine.
 */

export interface MachinePosition2D {
  x: number;
  y: number;
}

export interface MachinePositionLike extends MachinePosition2D {
  z?: number;
}

export interface LastMachinePosition extends MachinePosition2D {
  capturedAt: number;
  source: 'job-start';
}

export interface GoToLastPositionJog {
  axis: 'X' | 'Y';
  distance: number;
}

export const LAST_MACHINE_POSITION_TOLERANCE_MM = 0.01;

function isFinitePosition(position: MachinePositionLike | null | undefined): position is MachinePositionLike {
  return position != null
    && Number.isFinite(position.x)
    && Number.isFinite(position.y);
}

export function captureLastJobStartPosition(
  position: MachinePositionLike | null | undefined,
  now = Date.now(),
): LastMachinePosition | null {
  if (!isFinitePosition(position)) return null;
  return {
    x: position.x,
    y: position.y,
    capturedAt: now,
    source: 'job-start',
  };
}

export function buildGoToLastPositionJogs(args: {
  current: MachinePositionLike | null | undefined;
  target: LastMachinePosition | null | undefined;
  toleranceMm?: number;
}): GoToLastPositionJog[] {
  const { current, target, toleranceMm = LAST_MACHINE_POSITION_TOLERANCE_MM } = args;
  if (!isFinitePosition(current) || !isFinitePosition(target)) return [];

  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const moves: GoToLastPositionJog[] = [];

  if (Math.abs(dx) > toleranceMm) {
    moves.push({ axis: 'X', distance: dx });
  }
  if (Math.abs(dy) > toleranceMm) {
    moves.push({ axis: 'Y', distance: dy });
  }

  return moves;
}

export function describeLastMachinePosition(position: LastMachinePosition | null | undefined): string {
  if (!isFinitePosition(position)) return 'No last position';
  return `X${position.x.toFixed(1)} Y${position.y.toFixed(1)}`;
}
