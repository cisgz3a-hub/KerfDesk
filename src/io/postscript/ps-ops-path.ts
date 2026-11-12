// Path construction and painting operators (PLRM §8.1 "Path construction",
// "Painting"). Clipping is recorded but not applied: the full shapes import.

import { apply, invert } from './ps-matrix';
import type { OpTable } from './ps-ops-stack';
import { pathPointCount } from './ps-budget';
import type { PsVm } from './ps-vm';
import { PsError, type Vec } from './ps-types';

const pt = (x: number, y: number): Vec => ({ x, y });

export const PATH_OPS: OpTable = {
  newpath: (vm) => vm.newPath(),
  moveto: (vm) => {
    const [x, y] = vm.popNumbers(2);
    vm.moveTo(pt(x ?? 0, y ?? 0));
  },
  rmoveto: (vm) => {
    const [dx, dy] = vm.popNumbers(2);
    vm.moveTo(vm.relativeUserPoint(pt(dx ?? 0, dy ?? 0)));
  },
  lineto: (vm) => {
    const [x, y] = vm.popNumbers(2);
    vm.lineTo(pt(x ?? 0, y ?? 0));
  },
  rlineto: (vm) => {
    const [dx, dy] = vm.popNumbers(2);
    vm.lineTo(vm.relativeUserPoint(pt(dx ?? 0, dy ?? 0)));
  },
  curveto: (vm) => {
    const [x1, y1, x2, y2, x3, y3] = vm.popNumbers(6);
    vm.curveTo(pt(x1 ?? 0, y1 ?? 0), pt(x2 ?? 0, y2 ?? 0), pt(x3 ?? 0, y3 ?? 0));
  },
  rcurveto: (vm) => {
    const [x1, y1, x2, y2, x3, y3] = vm.popNumbers(6);
    const rel = (x: number, y: number): Vec => vm.relativeUserPoint(pt(x, y));
    vm.curveTo(rel(x1 ?? 0, y1 ?? 0), rel(x2 ?? 0, y2 ?? 0), rel(x3 ?? 0, y3 ?? 0));
  },
  closepath: (vm) => vm.closePath(),
  arc: (vm) => arcOperator(vm, true),
  arcn: (vm) => arcOperator(vm, false),
  arct: (vm) => tangentArc(vm),
  arcto: (vm) => {
    const [xt1, yt1, xt2, yt2] = tangentArc(vm);
    [xt1, yt1, xt2, yt2].forEach((v) => vm.push(v ?? 0));
  },
  currentpoint: (vm) => {
    const p = vm.currentUserPoint();
    vm.push(p.x);
    vm.push(p.y);
  },
  pathbbox: pathBox,
  flattenpath: () => undefined,
  reversepath: (vm) => vm.note('reversed'),
  strokepath: () => {
    throw new PsError(
      'unsupported',
      'The file outlines strokes (strokepath), which KerfDesk cannot read.',
    );
  },
  fill: (vm) => vm.paint({ fill: true, stroke: false, evenOdd: false }),
  eofill: (vm) => vm.paint({ fill: true, stroke: false, evenOdd: true }),
  stroke: (vm) => vm.paint({ fill: false, stroke: true, evenOdd: false }),
  rectfill: (vm) => rectangle(vm, () => vm.paint({ fill: true, stroke: false, evenOdd: false })),
  rectstroke: (vm) => {
    const top = vm.operands[vm.operands.length - 1];
    if (typeof top === 'object' && top?.kind === 'array') vm.pop();
    rectangle(vm, () => vm.paint({ fill: false, stroke: true, evenOdd: false }));
  },
  clip: (vm) => vm.note('clip'),
  eoclip: (vm) => vm.note('clip'),
  rectclip: (vm) => {
    rectangle(vm, () => undefined);
    vm.note('clip');
  },
  initclip: () => undefined,
  clippath: (vm) => vm.note('clip'),
  shfill: (vm) => {
    vm.pop();
    vm.note('shading');
  },
  image: imageRefusal,
  colorimage: imageRefusal,
  imagemask: imageRefusal,
};

function imageRefusal(): never {
  throw new PsError(
    'image',
    'The file contains an embedded image. Save it again without images, or import it as PDF or SVG.',
  );
}

/** `x y w h` or a numeric array of rectangles; draws then runs `paint` on a scratch path. */
function rectangle(vm: PsVm, paint: () => void): void {
  const top = vm.operands[vm.operands.length - 1];
  const values =
    typeof top === 'object' && top?.kind === 'array'
      ? vm.popArray().items.map((v) => (typeof v === 'number' ? v : 0))
      : vm.popNumbers(4);
  const saved = vm.gstate;
  vm.gstate = { ...saved, path: [], current: null };
  for (let i = 0; i + 3 < values.length; i += 4) {
    const [x = 0, y = 0, w = 0, h = 0] = values.slice(i, i + 4);
    vm.moveTo(pt(x, y));
    vm.lineTo(pt(x + w, y));
    vm.lineTo(pt(x + w, y + h));
    vm.lineTo(pt(x, y + h));
    vm.closePath();
  }
  paint();
  vm.gstate = saved;
}

function arcOperator(vm: PsVm, counterClockwise: boolean): void {
  const [x = 0, y = 0, r = 0, a1 = 0, rawA2 = 0] = vm.popNumbers(5);
  let a2 = rawA2;
  if (counterClockwise) while (a2 < a1) a2 += 360;
  else while (a2 > a1) a2 -= 360;
  appendArc(vm, pt(x, y), r, (a1 * Math.PI) / 180, (a2 * Math.PI) / 180, true);
}

/** Append a circular arc in user space as cubic Béziers of at most 90°. */
function appendArc(vm: PsVm, c: Vec, r: number, t0: number, t1: number, connect: boolean): void {
  const at = (t: number): Vec => pt(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  const start = at(t0);
  if (connect && vm.gstate.current !== null) vm.lineTo(start);
  else if (vm.gstate.current === null) vm.moveTo(start);
  const sweep = t1 - t0;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / count;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < count; i += 1) {
    const a = t0 + i * step;
    const b = a + step;
    const p0 = at(a);
    const p3 = at(b);
    vm.curveTo(
      pt(p0.x - k * r * Math.sin(a), p0.y + k * r * Math.cos(a)),
      pt(p3.x + k * r * Math.sin(b), p3.y - k * r * Math.cos(b)),
      p3,
    );
  }
}

/** arct/arcto: line toward (x1,y1), then a tangent arc of radius r toward (x2,y2). */
function tangentArc(vm: PsVm): number[] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, r = 0] = vm.popNumbers(5);
  const p0 = vm.currentUserPoint();
  const u = unit(p0.x - x1, p0.y - y1);
  const v = unit(x2 - x1, y2 - y1);
  const cross = u.x * v.y - u.y * v.x;
  if (u.len === 0 || v.len === 0 || Math.abs(cross) < 1e-12 || r === 0) {
    vm.lineTo(pt(x1, y1));
    return [x1, y1, x1, y1];
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
  const d = r / Math.tan(angle / 2);
  const t1 = pt(x1 + u.x * d, y1 + u.y * d);
  const t2 = pt(x1 + v.x * d, y1 + v.y * d);
  const bisector = unit(u.x + v.x, u.y + v.y);
  const h = r / Math.sin(angle / 2);
  const center = pt(x1 + bisector.x * h, y1 + bisector.y * h);
  const a0 = Math.atan2(t1.y - center.y, t1.x - center.x);
  // The tangent arc is always the short way round (less than 180°).
  let sweep = Math.atan2(t2.y - center.y, t2.x - center.x) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep <= -Math.PI) sweep += 2 * Math.PI;
  appendArc(vm, center, r, a0, a0 + sweep, true);
  return [t1.x, t1.y, t2.x, t2.y];
}

function unit(x: number, y: number): { x: number; y: number; len: number } {
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0, len } : { x: x / len, y: y / len, len };
}

function pathBox(vm: PsVm): void {
  const path = vm.gstate.path;
  vm.charge(pathPointCount(path));
  if (path.length === 0) throw new PsError('nocurrentpoint', 'pathbbox needs a path.');
  const inverse = invert(vm.gstate.ctm);
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (device: Vec): void => {
    const p = apply(inverse, device);
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  };
  // Walked in place: one pass, no copy of a path that may hold millions of points.
  for (const subpath of path) {
    include(subpath.start);
    for (const seg of subpath.segments) {
      if (seg.kind !== 'line') {
        include(seg.c1);
        include(seg.c2);
      }
      include(seg.to);
    }
  }
  [box.minX, box.minY, box.maxX, box.maxY].forEach((n) => vm.push(n));
}
