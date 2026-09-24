import { describe, expect, it } from 'vitest';
import type { CncHelicalContourPass } from '../job/job';
import { prepareHelicalMotion } from './cnc-grbl-helical';

type Xy = { readonly x: number; readonly y: number };

// Independent single-precision model of stock GRBL 1.1h mc_arc
// (motion_control.c): the centre is rebuilt as position + offset in float, and
// an arc whose computed angle lies within ARC_ANGULAR_TRAVEL_EPSILON (5e-7 rad,
// config.h) of zero on the wrong side runs as a single straight line.
function grblAngularTravel(position: Xy, target: Xy, offset: Xy, clockwise: boolean): number {
  const f = Math.fround;
  const centerX = f(f(position.x) + f(offset.x));
  const centerY = f(f(position.y) + f(offset.y));
  const rX = f(-f(offset.x));
  const rY = f(-f(offset.y));
  const rtX = f(f(target.x) - centerX);
  const rtY = f(f(target.y) - centerY);
  let travel = Math.atan2(f(f(rX * rtY) - f(rY * rtX)), f(f(rX * rtX) + f(rY * rtY)));
  if (clockwise) {
    if (travel >= -5e-7) travel -= 2 * Math.PI;
  } else if (travel <= 5e-7) {
    travel += 2 * Math.PI;
  }
  return travel;
}

function word(line: string, letter: string): number {
  const match = new RegExp(`${letter}(-?[0-9.]+)`).exec(line);
  if (match?.[1] === undefined) throw new Error(`missing ${letter} in ${line}`);
  return Number(match[1]);
}

// Start and offset from a real emitted pocket helix that GRBL 1.1h ran as a
// straight plunge when it was written as one same-point arc per revolution.
const start = { x: 232.609, y: 247.72 };
const helix = (clockwise: boolean): CncHelicalContourPass => ({
  kind: 'helical-contour',
  start,
  center: { x: start.x + 2.855, y: start.y + 0.921 },
  clockwise,
  startZMm: 0,
  zMm: -2,
  revolutions: 3,
  polyline: [start, { x: start.x + 5, y: start.y }],
  closed: false,
});

describe('prepareHelicalMotion on stock GRBL 1.1h arcs', () => {
  it('the float model reproduces the collapse of a same-point full circle', () => {
    const travel = grblAngularTravel(start, start, { x: 2.855, y: 0.921 }, false);
    expect(Math.abs(travel)).toBeLessThan(1e-5);
  });

  it.each([false, true])('never ends an arc where it started (clockwise %s)', (clockwise) => {
    const prepared = prepareHelicalMotion(helix(clockwise), 300);
    expect(prepared?.arcLines).toHaveLength(6);
    let position: Xy = { x: Number(prepared?.startX), y: Number(prepared?.startY) };
    for (const line of prepared?.arcLines ?? []) {
      const target = { x: word(line, 'X'), y: word(line, 'Y') };
      const offset = { x: word(line, 'I'), y: word(line, 'J') };
      const travel = grblAngularTravel(position, target, offset, clockwise);
      expect(Math.abs(Math.abs(travel) - Math.PI)).toBeLessThan(1e-3);
      expect(Math.sign(travel)).toBe(clockwise ? -1 : 1);
      // GRBL error:33 threshold: start and end radius must agree within 0.005 mm.
      const center = { x: position.x + offset.x, y: position.y + offset.y };
      const startRadius = Math.hypot(offset.x, offset.y);
      const endRadius = Math.hypot(target.x - center.x, target.y - center.y);
      expect(Math.abs(startRadius - endRadius)).toBeLessThan(0.005);
      position = target;
    }
    expect(position).toEqual({ x: 232.609, y: 247.72 });
  });

  it('descends evenly and ends each revolution on its represented seam', () => {
    const prepared = prepareHelicalMotion(helix(false), 300);
    const zs = prepared?.arcLines.map((line) => word(line, 'Z')) ?? [];
    expect(zs.filter((_, index) => index % 2 === 1)).toEqual([-0.667, -1.333, -2]);
    expect(zs.filter((_, index) => index % 2 === 0)).toEqual([-0.333, -1, -1.667]);
    expect(prepared?.finalZ).toBe('-2.000');
  });
});
