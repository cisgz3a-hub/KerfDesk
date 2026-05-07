import type { GcodeStartMode } from '../core/output/GcodeOrigin';

export interface CurrentFrameAnchor {
  x: number;
  y: number;
}

export interface MachinePositionLike {
  x: number;
  y: number;
}

export const CURRENT_FRAME_ANCHOR_TOLERANCE_MM = 0.25;

export function captureCurrentFrameAnchor(
  startMode: GcodeStartMode,
  machinePosition: MachinePositionLike | null | undefined,
): CurrentFrameAnchor | null {
  if (startMode !== 'current' || !machinePosition) return null;
  return {
    x: machinePosition.x,
    y: machinePosition.y,
  };
}

export function currentModeFrameAnchorAllowsStart(args: {
  startMode: GcodeStartMode;
  frameAnchor: CurrentFrameAnchor | null;
  machinePosition: MachinePositionLike | null | undefined;
  toleranceMm?: number;
}): boolean {
  if (args.startMode !== 'current') return true;
  if (!args.frameAnchor || !args.machinePosition) return false;

  const tolerance = args.toleranceMm ?? CURRENT_FRAME_ANCHOR_TOLERANCE_MM;
  return (
    Math.abs(args.machinePosition.x - args.frameAnchor.x) <= tolerance &&
    Math.abs(args.machinePosition.y - args.frameAnchor.y) <= tolerance
  );
}
