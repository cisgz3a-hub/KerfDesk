import {
  cncHelicalContourCanEmit,
  cncHelicalContourRepresentedSeams,
  type CncHelicalContourPass,
} from '../job/helical-representation';
import { fmt } from './cnc-grbl-emit-head';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';

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
  if (!cncHelicalContourCanEmit(pass)) return null;
  const first = pass.polyline[0];
  if (first === undefined) return null;
  const startX = fmt(pass.start.x);
  const startY = fmt(pass.start.y);
  const revolutions = Math.max(1, Math.floor(pass.revolutions));
  const seams = cncHelicalContourRepresentedSeams(pass);
  const direction = pass.clockwise ? 'G2' : 'G3';
  const i = fmt(pass.center.x - pass.start.x);
  const j = fmt(pass.center.y - pass.start.y);
  const arcLines: string[] = [];
  for (let revolution = 1; revolution <= revolutions; revolution += 1) {
    const z = seams[revolution]?.text ?? fmt(0);
    arcLines.push(
      `${direction} X${startX} Y${startY} Z${z} I${i} J${j} F${formatGcodeFeedMmPerMin(plunge)}`,
    );
  }
  return {
    first,
    startX,
    startY,
    startZ: seams[0]?.text ?? fmt(0),
    finalZ: seams[seams.length - 1]?.text ?? fmt(0),
    arcLines,
  };
}
