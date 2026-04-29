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
  crosshairAfterFrame?: boolean;
}

const CROSSHAIR_HALF_ARM_MM = 5;

export function buildFrameGcode(
  corners: readonly { x: number; y: number }[],
  opts: FrameGcodeOpts,
): string[] {
  const eps = 0.0005;
  const { startMode, laserMode, maxSpindle, crosshairAfterFrame = false } = opts;
  const frameDotS = Math.max(0, Math.round(0.005 * maxSpindle));
  const centroid = (() => {
    if (corners.length < 4) return null;
    const c0 = corners[0]!;
    const c1 = corners[1]!;
    const c2 = corners[2]!;
    const c3 = corners[3]!;
    return {
      x: (c0.x + c1.x + c2.x + c3.x) / 4,
      y: (c0.y + c1.y + c2.y + c3.y) / 4,
    };
  })();

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
    if (crosshairAfterFrame && centroid) {
      const H = CROSSHAIR_HALF_ARM_MM;
      const c0 = corners[0]!;
      const dxToRightTip = (centroid.x - c0.x) + H;
      const dyToRightTip = centroid.y - c0.y;
      out.push(`G0 X${dxToRightTip.toFixed(3)} Y${dyToRightTip.toFixed(3)}`);
      if (laserMode === 'dot') {
        out.push(`M4 S${frameDotS}`);
        out.push(`G1 X${(-2 * H).toFixed(3)} Y${(0).toFixed(3)} F3000`);
        out.push(`G1 X${H.toFixed(3)} Y${(0).toFixed(3)} F3000`);
        out.push(`G1 X${(0).toFixed(3)} Y${H.toFixed(3)} F3000`);
        out.push(`G1 X${(0).toFixed(3)} Y${(-2 * H).toFixed(3)} F3000`);
        out.push(`G1 X${(0).toFixed(3)} Y${H.toFixed(3)} F3000`);
      } else {
        out.push(`G0 X${(-2 * H).toFixed(3)} Y${(0).toFixed(3)}`);
        out.push(`G0 X${H.toFixed(3)} Y${(0).toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${H.toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${(-2 * H).toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${H.toFixed(3)}`);
      }
      out.push('M5 S0');
    }
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
  if (crosshairAfterFrame && centroid) {
    const H = CROSSHAIR_HALF_ARM_MM;
    out.push(`G0 X${(centroid.x + H).toFixed(3)} Y${centroid.y.toFixed(3)}`);
    if (laserMode === 'dot') {
      out.push(`M4 S${frameDotS}`);
      out.push(`G1 X${(centroid.x - H).toFixed(3)} Y${centroid.y.toFixed(3)} F3000`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)} F3000`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${(centroid.y + H).toFixed(3)} F3000`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${(centroid.y - H).toFixed(3)} F3000`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)} F3000`);
    } else {
      out.push(`G0 X${(centroid.x - H).toFixed(3)} Y${centroid.y.toFixed(3)}`);
      out.push(`G0 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)}`);
      out.push(`G0 X${centroid.x.toFixed(3)} Y${(centroid.y + H).toFixed(3)}`);
      out.push(`G0 X${centroid.x.toFixed(3)} Y${(centroid.y - H).toFixed(3)}`);
      out.push(`G0 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)}`);
    }
    out.push('M5 S0');
  }
  return out;
}
