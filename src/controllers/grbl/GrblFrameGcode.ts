import { type GcodeStartMode } from '../../core/output/GcodeOrigin';

export interface GrblFrameGcodeOpts {
  startMode: GcodeStartMode;
  laserMode: 'off' | 'dot';
  maxSpindle: number;
  crosshairAfterFrame?: boolean;
  frameDotFeedRateMmPerMin?: number;
}

const CROSSHAIR_HALF_ARM_MM = 5;
const DEFAULT_FRAME_DOT_FEED_RATE_MM_PER_MIN = 3000;

function resolveFrameDotFeedRate(feedRateMmPerMin: number | undefined): number {
  if (typeof feedRateMmPerMin === 'number' && Number.isFinite(feedRateMmPerMin) && feedRateMmPerMin > 0) {
    return feedRateMmPerMin;
  }
  return DEFAULT_FRAME_DOT_FEED_RATE_MM_PER_MIN;
}

function formatFeedRate(feedRateMmPerMin: number): string {
  if (Number.isInteger(feedRateMmPerMin)) return String(feedRateMmPerMin);
  return feedRateMmPerMin.toFixed(3).replace(/\.?0+$/, '');
}

export function buildGrblFrameGcode(
  corners: readonly { x: number; y: number }[],
  opts: GrblFrameGcodeOpts,
): string[] {
  const eps = 0.0005;
  const { startMode, laserMode, maxSpindle, crosshairAfterFrame = false } = opts;
  const frameDotFeed = formatFeedRate(resolveFrameDotFeedRate(opts.frameDotFeedRateMmPerMin));
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
    let prev = { x: 0, y: 0 };
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i]!;
      const dx = c.x - prev.x;
      const dy = c.y - prev.y;
      if (Math.abs(dx) >= eps || Math.abs(dy) >= eps) {
        if (laserMode === 'dot') {
          out.push(`G1 X${dx.toFixed(3)} Y${dy.toFixed(3)} F${frameDotFeed}`);
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
        out.push(`G1 X${(-2 * H).toFixed(3)} Y${(0).toFixed(3)} F${frameDotFeed}`);
        out.push(`G1 X${H.toFixed(3)} Y${(0).toFixed(3)} F${frameDotFeed}`);
        out.push(`G1 X${(0).toFixed(3)} Y${H.toFixed(3)} F${frameDotFeed}`);
        out.push(`G1 X${(0).toFixed(3)} Y${(-2 * H).toFixed(3)} F${frameDotFeed}`);
        out.push(`G1 X${(0).toFixed(3)} Y${H.toFixed(3)} F${frameDotFeed}`);
      } else {
        out.push(`G0 X${(-2 * H).toFixed(3)} Y${(0).toFixed(3)}`);
        out.push(`G0 X${H.toFixed(3)} Y${(0).toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${H.toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${(-2 * H).toFixed(3)}`);
        out.push(`G0 X${(0).toFixed(3)} Y${H.toFixed(3)}`);
      }
      out.push('M5 S0');
    }
    const endPos = (crosshairAfterFrame && centroid) ? centroid : corners[0]!;
    if (Math.abs(endPos.x) >= eps || Math.abs(endPos.y) >= eps) {
      out.push(`G0 X${(-endPos.x).toFixed(3)} Y${(-endPos.y).toFixed(3)}`);
    }
    out.push('G90');
    return out;
  }

  const out: string[] = ['G90', 'G21', 'M5 S0'];
  if (corners.length > 0) {
    const first = corners[0]!;
    out.push(`G0 X${first.x.toFixed(3)} Y${first.y.toFixed(3)}`);
  }
  if (laserMode === 'dot') {
    out.push(`M4 S${frameDotS}`);
  }
  for (let i = corners.length > 0 ? 1 : 0; i < corners.length; i++) {
    const c = corners[i]!;
    if (laserMode === 'dot') {
      out.push(`G1 X${c.x.toFixed(3)} Y${c.y.toFixed(3)} F${frameDotFeed}`);
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
      out.push(`G1 X${(centroid.x - H).toFixed(3)} Y${centroid.y.toFixed(3)} F${frameDotFeed}`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)} F${frameDotFeed}`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${(centroid.y + H).toFixed(3)} F${frameDotFeed}`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${(centroid.y - H).toFixed(3)} F${frameDotFeed}`);
      out.push(`G1 X${centroid.x.toFixed(3)} Y${centroid.y.toFixed(3)} F${frameDotFeed}`);
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
