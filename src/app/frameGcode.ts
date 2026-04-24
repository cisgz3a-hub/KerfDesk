import { type AABB } from '../core/types';
import {
  transformPointToMachine,
  type MachineTransformOptions,
} from '../core/plan/MachineTransform';
import { type GcodeStartMode } from '../core/output/GcodeOrigin';

export type { MachineTransformOptions as FrameTransformOpts } from '../core/plan/MachineTransform';

export function buildFrameCorners(
  sceneBounds: AABB,
  transformOpts: MachineTransformOptions,
): { x: number; y: number }[] {
  const corners = [
    { x: sceneBounds.minX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.minY },
  ];
  return corners.map(p => transformPointToMachine(p, sceneBounds, transformOpts));
}

export interface FrameGcodeOpts {
  startMode: GcodeStartMode;
  laserMode: 'off' | 'dot';
  maxSpindle: number;
}

export function buildFrameGcode(
  corners: readonly { x: number; y: number }[],
  opts: FrameGcodeOpts,
): string[] {
  const eps = 0.0005;
  const { startMode, laserMode, maxSpindle } = opts;
  const frameDotS = Math.max(0, Math.round(0.005 * maxSpindle));

  if (startMode === 'current') {
    const out: string[] = ['G91', 'G21'];
    out.push(laserMode === 'dot' ? `M4 S${frameDotS}` : 'M5 S0');
    let prev = corners[0]!;
    for (let i = 1; i < corners.length; i++) {
      const c = corners[i]!;
      const dx = c.x - prev.x;
      const dy = c.y - prev.y;
      if (Math.abs(dx) >= eps || Math.abs(dy) >= eps) {
        if (laserMode === 'dot') {
          out.push(`G1 X${dx.toFixed(3)} Y${dy.toFixed(3)} F3000`);
        } else {
          out.push(`G0 X${dx.toFixed(3)} Y${dy.toFixed(3)}`);
        }
      }
      prev = c;
    }
    out.push('M5 S0');
    out.push('G90');
    return out;
  }

  const out: string[] = ['G90', 'G21'];
  out.push(laserMode === 'dot' ? `M4 S${frameDotS}` : 'M5 S0');
  for (const c of corners) {
    if (laserMode === 'dot') {
      out.push(`G1 X${c.x.toFixed(3)} Y${c.y.toFixed(3)} F3000`);
    } else {
      out.push(`G0 X${c.x.toFixed(3)} Y${c.y.toFixed(3)}`);
    }
  }
  out.push('M5 S0');
  return out;
}
