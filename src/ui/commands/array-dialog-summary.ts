// The Array dialog's status line: what Create array will make, worked out
// from the same request and layout maths the store action uses. It only
// explains; nothing here stops an array from being created (ADR-228).

import { circularSweep, isWholeTurns } from '../../core/scene/array-circular-layout';
import { gridSteps } from '../../core/scene/array-grid-layout';
import { arrayPlacements } from '../../core/scene/array-layout';
import type {
  ArraySpec,
  CircularArraySpec,
  GridArraySpec,
  PointRotationArraySpec,
} from '../../core/scene/array-layout-types';
import type { Bounds } from '../../core/scene/scene-object';
import { formatDisplayMillimetres as fmt } from '../format-display-millimetres';

/** `bounds` covers what is copied: the selection, less a circle's centre object. */
export function arraySummary(spec: ArraySpec, bounds: Bounds): string {
  switch (spec.kind) {
    case 'grid':
      return gridSummary(spec, bounds);
    case 'circular':
      return circularSummary(spec, bounds);
    case 'point-rotation':
      return pointRotationSummary(spec);
  }
}

function gridSummary(spec: GridArraySpec, bounds: Bounds): string {
  const rows = wholeCount(spec.rows);
  const columns = wholeCount(spec.columns);
  if (rows * columns === 1) return 'Only the original: add rows or columns to make copies.';
  const { stepX, stepY } = gridSteps(bounds, spec);
  const layout =
    rows === 1
      ? `1 row of ${columns}`
      : columns === 1
        ? `1 column of ${rows}`
        : `${rows} rows of ${columns}`;
  const pitch =
    rows === 1 ? fmt(stepX) : columns === 1 ? fmt(stepY) : `${fmt(stepX)} × ${fmt(stepY)}`;
  const size = gridFootprint(spec, bounds, { rows, columns, stepX, stepY });
  const stacked =
    stacks(columns, stepX, spec.columnShift ?? 0) || stacks(rows, stepY, spec.rowShift ?? 0)
      ? ' Some copies land on top of each other.'
      : '';
  return `${layout}: the original and ${copies(rows * columns - 1)}, ${pitch} mm centre to centre, ${fmt(size.width)} × ${fmt(size.height)} mm overall.${stacked}`;
}

// Worked out along each axis rather than from every placement, so a very
// large grid costs nothing to describe while its numbers are typed.
function gridFootprint(
  spec: GridArraySpec,
  bounds: Bounds,
  grid: { rows: number; columns: number; stepX: number; stepY: number },
): { readonly width: number; readonly height: number } {
  const across = axisRange(
    grid.columns,
    grid.stepX,
    spec.reverseColumns === true,
    grid.rows > 1 ? (spec.rowShift ?? 0) : 0,
  );
  const down = axisRange(
    grid.rows,
    grid.stepY,
    spec.reverseRows === true,
    grid.columns > 1 ? (spec.columnShift ?? 0) : 0,
  );
  return {
    width: across + Math.max(0, bounds.maxX - bounds.minX),
    height: down + Math.max(0, bounds.maxY - bounds.minY),
  };
}

function axisRange(count: number, step: number, reverse: boolean, shift: number): number {
  const far = (count - 1) * step * (reverse ? -1 : 1);
  const low = Math.min(0, far, Math.min(0, far) + shift);
  const high = Math.max(0, far, Math.max(0, far) + shift);
  return Number.isFinite(high - low) ? high - low : 0;
}

// Copies in a line with no step between them coincide, unless a shift keeps
// the only two apart.
function stacks(count: number, step: number, shift: number): boolean {
  return step === 0 && (count > 2 || (count === 2 && shift === 0));
}

function circularSummary(spec: CircularArraySpec, bounds: Bounds): string {
  const sweep = circularSweep(spec);
  const radius = `a ${fmt(Math.max(0, spec.radius))} mm radius`;
  const start = Number.isFinite(spec.startAngleDeg) ? spec.startAngleDeg : 0;
  const where =
    sweep.count === 1
      ? `Only the original, placed at ${fmt(start)}° on ${radius}.`
      : spec.arc === undefined
        ? `The original and ${copies(sweep.count - 1)}, ${fmt(sweep.stepDeg)}° apart all the way round ${radius}.`
        : `The original and ${copies(sweep.count - 1)}, ${fmt(Math.abs(sweep.stepDeg))}° apart from ${fmt(start)}° to ${fmt(start + sweep.sweepDeg)}°, on ${radius}.`;
  return `${where}${circularNotes(spec, bounds, sweep)}`;
}

function circularNotes(
  spec: CircularArraySpec,
  bounds: Bounds,
  sweep: ReturnType<typeof circularSweep>,
): string {
  const notes: string[] = [];
  if (spec.centerObjectId !== undefined) notes.push('The centre object stays where it is.');
  const original = originalChange(spec, bounds);
  if (original !== null) notes.push(original);
  const sameAngle = sweep.stepDeg === 0 || isWholeTurns(sweep.stepDeg);
  if (sweep.count > 1 && (sameAngle || (spec.radius <= 0 && !spec.rotateCopies))) {
    notes.push('Every copy lands in the same place.');
  } else if (sweep.count > 1 && Math.abs(sweep.sweepDeg) >= 360 - 1e-9) {
    notes.push('Copies past a full turn land over earlier ones.');
  }
  return notes.length === 0 ? '' : ` ${notes.join(' ')}`;
}

// The original becomes the first copy: say when that moves or turns it.
function originalChange(spec: CircularArraySpec, bounds: Bounds): string | null {
  const first = arrayPlacements(bounds, { ...spec, count: 1 })[0];
  if (first === undefined) return null;
  const moves = Math.abs(first.dx) > 1e-9 || Math.abs(first.dy) > 1e-9;
  const turn = ((first.rotationDeg % 360) + 360) % 360;
  const turns = turn > 1e-9 && turn < 360 - 1e-9;
  if (moves && turns) return 'The original moves and turns into the first position.';
  if (moves) return 'The original moves to the first position.';
  return turns ? 'The original turns to follow the circle.' : null;
}

function pointRotationSummary(spec: PointRotationArraySpec): string {
  const count = wholeCount(spec.count);
  if (count === 1) return 'Only the original: add copies to turn it.';
  const total = Number.isFinite(spec.totalAngleDeg) ? spec.totalAngleDeg : 0;
  const step = total / count;
  const same = step === 0 || isWholeTurns(step) ? ' Every copy lands in the same place.' : '';
  return `The original and ${copies(count - 1)}, turned ${fmt(Math.abs(step))}° apart about the selection centre.${same}`;
}

function copies(count: number): string {
  return count === 1 ? '1 copy' : `${count} copies`;
}

function wholeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
