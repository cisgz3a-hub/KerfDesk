import { circularArcGeometry } from '../geometry/circular-arc';
import type { CncHelicalContourPass } from '../job';

const DECIMAL_PLACES = 3;

export type PreparedHelicalMotion = {
  readonly first: { readonly x: number; readonly y: number };
  readonly startX: string;
  readonly startY: string;
  readonly startZ: string;
  readonly finalZ: string;
  readonly arcLines: ReadonlyArray<string>;
};

export function prepareHelicalMotion(
  pass: CncHelicalContourPass,
  plunge: number,
): PreparedHelicalMotion | null {
  const first = pass.polyline[0];
  if (first === undefined || pass.polyline.length < 2 || !Number.isFinite(pass.startZMm))
    return null;
  if (!Number.isFinite(pass.zMm)) return null;
  if (circularArcGeometry({ ...pass, end: pass.start }).kind !== 'ok') return null;
  const startX = fmt(pass.start.x);
  const startY = fmt(pass.start.y);
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const direction = pass.clockwise ? 'G2' : 'G3';
  const i = fmt(pass.center.x - pass.start.x);
  const j = fmt(pass.center.y - pass.start.y);
  const arcLines: string[] = [];
  for (let revolution = 1; revolution <= revolutions; revolution += 1) {
    const progress = revolution / revolutions;
    const z = fmt(pass.startZMm + (pass.zMm - pass.startZMm) * progress);
    arcLines.push(`${direction} X${startX} Y${startY} Z${z} I${i} J${j} F${plunge}`);
  }
  return {
    first,
    startX,
    startY,
    startZ: fmt(pass.startZMm),
    finalZ: fmt(pass.zMm),
    arcLines,
  };
}

function fmt(value: number): string {
  return value.toFixed(DECIMAL_PLACES);
}
