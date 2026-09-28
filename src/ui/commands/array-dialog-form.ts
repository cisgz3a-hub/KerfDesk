// The Array dialog's settings and the request they make (ADR-307, LightBurn
// gap LBG-T13/T14). A setting left at its default adds nothing to the
// request, so an untouched dialog asks for exactly what it always did.

import { circularSweep } from '../../core/scene/array-circular-layout';
import type {
  ArrayMirrorAxes,
  ArraySpec,
  CircularArcSpec,
  CircularArraySpec,
  GridArraySpec,
} from '../../core/scene/array-layout-types';
import type { Bounds } from '../../core/scene/scene-object';
import { formatDisplayMillimetres as formatNumber } from '../format-display-millimetres';
import {
  displayedCentre,
  offsetFromObject,
  resolvedCentre,
  type ArrayCentre,
  type ArrayDialogContext,
} from './array-dialog-centre';

export type ArraySpread = 'full' | 'end' | 'step';

export type ArrayForm = {
  readonly mode: ArraySpec['kind'];
  readonly rows: string;
  readonly columns: string;
  readonly spacingX: string;
  readonly spacingY: string;
  readonly spaceBy: 'gap' | 'centres';
  readonly rowShift: string;
  readonly columnShift: string;
  readonly reverseColumns: boolean;
  readonly reverseRows: boolean;
  readonly mirrorColumns: ArrayMirrorAxes;
  readonly mirrorRows: ArrayMirrorAxes;
  readonly count: string;
  readonly totalAngle: string;
  readonly centre: ArrayCentre;
  readonly centerX: string;
  readonly centerY: string;
  readonly radius: string;
  readonly startAngle: string;
  readonly rotateCopies: boolean;
  readonly spread: ArraySpread;
  readonly endAngle: string;
  readonly stepAngle: string;
};

export function defaultArrayForm(bounds: Bounds): ArrayForm {
  return {
    mode: 'grid',
    rows: '2',
    columns: '2',
    spacingX: '2',
    spacingY: '2',
    spaceBy: 'gap',
    rowShift: '0',
    columnShift: '0',
    reverseColumns: false,
    reverseRows: false,
    mirrorColumns: 'none',
    mirrorRows: 'none',
    count: '6',
    totalAngle: '360',
    centre: { kind: 'selection' },
    centerX: ((bounds.minX + bounds.maxX) / 2).toFixed(2),
    centerY: ((bounds.minY + bounds.maxY) / 2).toFixed(2),
    radius: '25',
    startAngle: '0',
    rotateCopies: false,
    spread: 'full',
    endAngle: '360',
    stepAngle: '60',
  };
}

/**
 * The settings the dialog reopens with in this session: everything but a
 * centre object, which may not be there next time, so the circle falls back
 * to the selection centre.
 */
export function rememberedArrayForm(form: ArrayForm): ArrayForm {
  return form.centre.kind === 'object' ? { ...form, centre: { kind: 'selection' } } : form;
}

export function arraySpecFromForm(form: ArrayForm, context: ArrayDialogContext): ArraySpec {
  switch (form.mode) {
    case 'grid':
      return gridSpec(form);
    case 'point-rotation':
      return {
        kind: 'point-rotation',
        count: positiveInteger(form.count),
        totalAngleDeg: finiteNumber(form.totalAngle),
      };
    case 'circular':
      return circularSpec(form, context);
  }
}

function gridSpec(form: ArrayForm): GridArraySpec {
  const extras: { -readonly [K in keyof GridArraySpec]?: GridArraySpec[K] } = {};
  const rowShift = finiteNumber(form.rowShift);
  const columnShift = finiteNumber(form.columnShift);
  if (form.spaceBy === 'centres') extras.spaceBy = 'centres';
  if (rowShift !== 0) extras.rowShift = rowShift;
  if (columnShift !== 0) extras.columnShift = columnShift;
  if (form.reverseColumns) extras.reverseColumns = true;
  if (form.reverseRows) extras.reverseRows = true;
  if (form.mirrorColumns !== 'none') extras.mirrorColumns = form.mirrorColumns;
  if (form.mirrorRows !== 'none') extras.mirrorRows = form.mirrorRows;
  return {
    kind: 'grid',
    rows: positiveInteger(form.rows),
    columns: positiveInteger(form.columns),
    spacingX: nonNegative(form.spacingX),
    spacingY: nonNegative(form.spacingY),
    ...extras,
  };
}

export function circularSpec(form: ArrayForm, context: ArrayDialogContext): CircularArraySpec {
  const centre = resolvedCentre(form, context);
  const arc = circularArc(form);
  return {
    kind: 'circular',
    count: positiveInteger(form.count),
    centerX: centre.x,
    centerY: centre.y,
    radius: nonNegative(form.radius),
    startAngleDeg: finiteNumber(form.startAngle),
    rotateCopies: form.rotateCopies,
    ...(arc === undefined ? {} : { arc }),
    ...(centre.objectId === undefined ? {} : { centerObjectId: centre.objectId }),
  };
}

function circularArc(form: ArrayForm): CircularArcSpec | undefined {
  switch (form.spread) {
    case 'full':
      return undefined;
    case 'end':
      return { kind: 'end', endAngleDeg: finiteNumber(form.endAngle) };
    case 'step':
      return { kind: 'step', stepAngleDeg: finiteNumber(form.stepAngle) };
  }
}

/**
 * Switch between a gap and a distance between centres. The numbers convert,
 * so the grid stays the same until they are changed.
 */
export function withSpaceBy(
  form: ArrayForm,
  spaceBy: ArrayForm['spaceBy'],
  bounds: Bounds,
): ArrayForm {
  if (spaceBy === form.spaceBy) return form;
  const sign = spaceBy === 'centres' ? 1 : -1;
  return {
    ...form,
    spaceBy,
    spacingX: shifted(form.spacingX, sign * (bounds.maxX - bounds.minX)),
    spacingY: shifted(form.spacingY, sign * (bounds.maxY - bounds.minY)),
  };
}

/**
 * Switch how a circular array spreads. The angles convert, so the copies stay
 * where they were until the angles are changed.
 */
export function withSpread(
  form: ArrayForm,
  spread: ArraySpread,
  context: ArrayDialogContext,
): ArrayForm {
  if (spread === form.spread) return form;
  const sweep = circularSweep(circularSpec(form, context));
  const start = finiteNumber(form.startAngle);
  if (spread === 'end') {
    // A whole turn from the start keeps every copy of an evenly spread circle.
    const end = form.spread === 'full' ? start + 360 : start + sweep.sweepDeg;
    return { ...form, spread, endAngle: formatNumber(end) };
  }
  if (spread === 'step') {
    return { ...form, spread, stepAngle: formatNumber(sweep.stepDeg) };
  }
  return { ...form, spread };
}

/**
 * Choose where the circle is centred. Choosing an object also sets the radius
 * and start angle to where the rest of the selection sits now, so the original
 * stays in place around it.
 */
export function withCentre(
  form: ArrayForm,
  centre: ArrayCentre,
  context: ArrayDialogContext,
): ArrayForm {
  if (centre.kind === 'point') {
    const shown = displayedCentre(form, context);
    return { ...form, centre, centerX: shown.x, centerY: shown.y };
  }
  if (centre.kind === 'selection') return { ...form, centre };
  const offset = offsetFromObject(context.selected, centre.id);
  // Something centred on the object has no angle to keep.
  if (offset === null || offset.radius < 1e-9) return { ...form, centre };
  return {
    ...form,
    centre,
    radius: formatNumber(offset.radius),
    startAngle: formatNumber(offset.angleDeg),
  };
}

/** Typing a centre coordinate makes the centre a typed point. */
export function withCenterField(
  form: ArrayForm,
  axis: 'x' | 'y',
  text: string,
  context: ArrayDialogContext,
): ArrayForm {
  const shown = displayedCentre(form, context);
  return {
    ...form,
    centre: { kind: 'point' },
    centerX: axis === 'x' ? text : shown.x,
    centerY: axis === 'y' ? text : shown.y,
  };
}

function shifted(text: string, delta: number): string {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return text;
  return formatNumber(Math.max(0, Math.max(0, value) + delta));
}

function positiveInteger(raw: string): number {
  return Math.max(1, Math.floor(finiteNumber(raw)));
}

function nonNegative(raw: string): number {
  return Math.max(0, finiteNumber(raw));
}

function finiteNumber(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
