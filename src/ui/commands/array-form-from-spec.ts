import type { ArraySpec, Bounds, GridArraySpec, CircularArraySpec } from '../../core/scene';
import { defaultArrayForm, type ArrayForm } from './array-dialog-form';

export function arrayFormFromSpec(spec: ArraySpec, bounds: Bounds): ArrayForm {
  const form = defaultArrayForm(bounds);
  switch (spec.kind) {
    case 'grid':
      return gridForm(spec, form);
    case 'point-rotation':
      return {
        ...form,
        mode: spec.kind,
        count: String(spec.count),
        totalAngle: String(spec.totalAngleDeg),
      };
    case 'circular':
      return circularForm(spec, form);
  }
}

function gridForm(spec: GridArraySpec, form: ArrayForm): ArrayForm {
  return {
    ...form,
    mode: spec.kind,
    rows: String(spec.rows),
    columns: String(spec.columns),
    spacingX: String(spec.spacingX),
    spacingY: String(spec.spacingY),
    spaceBy: spec.spaceBy ?? 'gap',
    rowShift: String(spec.rowShift ?? 0),
    columnShift: String(spec.columnShift ?? 0),
    reverseColumns: spec.reverseColumns ?? false,
    reverseRows: spec.reverseRows ?? false,
    mirrorColumns: spec.mirrorColumns ?? 'none',
    mirrorRows: spec.mirrorRows ?? 'none',
  };
}
function circularForm(spec: CircularArraySpec, form: ArrayForm): ArrayForm {
  return {
    ...form,
    mode: spec.kind,
    count: String(spec.count),
    centre: { kind: 'point' },
    centerX: String(spec.centerX),
    centerY: String(spec.centerY),
    radius: String(spec.radius),
    startAngle: String(spec.startAngleDeg),
    rotateCopies: spec.rotateCopies,
    spread: spec.arc?.kind ?? 'full',
    endAngle: String(spec.arc?.kind === 'end' ? spec.arc.endAngleDeg : 360),
    stepAngle: String(spec.arc?.kind === 'step' ? spec.arc.stepAngleDeg : 60),
  };
}
