import {
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  type ShapeObject,
} from '../../core/scene';
import {
  createRegistrationBox,
  createRegistrationCircle,
  REGISTRATION_BOX_OBJECT_ID,
} from '../../core/shapes';
import type { AppState } from './store';
import {
  applyReplaceRegistrationBoxes,
  registrationBoxDefaultPosition,
} from './registration-box-actions';

const MIN_JIG_SIZE_MM = 1;

export type RegistrationJigOutlineSpec =
  | { readonly kind: 'rectangle'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'circle'; readonly diameterMm: number };

export type RegistrationJigSetSpec = {
  readonly outline: RegistrationJigOutlineSpec;
  readonly rows: number;
  readonly columns: number;
  readonly spacingX: number;
  readonly spacingY: number;
};

export type RegistrationJigSetActions = {
  readonly replaceRegistrationJigSet: (spec: RegistrationJigSetSpec) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function registrationJigSetActions(set: Setter): RegistrationJigSetActions {
  return {
    replaceRegistrationJigSet: (spec) =>
      set((state) => applyReplaceRegistrationJigSet(state, spec, () => crypto.randomUUID())),
  };
}

export function applyReplaceRegistrationJigSet(
  state: AppState,
  spec: RegistrationJigSetSpec,
  idFactory: () => string,
): AppState | Partial<AppState> {
  const existing = findRegistrationBoxes(state.project.scene);
  if (existing.some((outline) => outline.provenance === 'captured-board')) return state;
  const dimensions = outlineDimensions(spec.outline);
  const rows = positiveInteger(spec.rows);
  const columns = positiveInteger(spec.columns);
  const spacingX = nonNegative(spec.spacingX);
  const spacingY = nonNegative(spec.spacingY);
  const footprint = {
    width: dimensions.width * columns + spacingX * (columns - 1),
    height: dimensions.height * rows + spacingY * (rows - 1),
  };
  const existingBounds = findRegistrationBoxBounds(state.project.scene);
  const origin =
    existingBounds ??
    registrationBoxDefaultPosition(
      state.project.device.bedWidth,
      state.project.device.bedHeight,
      footprint.width,
      footprint.height,
    );
  const boxes = createRegistrationJigOutlines(
    spec.outline,
    { rows, columns, spacingX, spacingY },
    { x: 'minX' in origin ? origin.minX : origin.x, y: 'minY' in origin ? origin.minY : origin.y },
    existing,
    idFactory,
  );
  const [firstBox, ...additionalBoxes] = boxes;
  return firstBox === undefined
    ? state
    : applyReplaceRegistrationBoxes(state, firstBox, additionalBoxes);
}

export function createRegistrationJigOutlines(
  outline: RegistrationJigOutlineSpec,
  grid: Omit<RegistrationJigSetSpec, 'outline'>,
  origin: { readonly x: number; readonly y: number },
  existing: ReadonlyArray<ShapeObject>,
  idFactory: () => string,
): ReadonlyArray<ShapeObject> {
  const dimensions = outlineDimensions(outline);
  const rows = positiveInteger(grid.rows);
  const columns = positiveInteger(grid.columns);
  const isLocked = existing.length > 0 && existing.every((candidate) => candidate.locked === true);
  const outlines: ShapeObject[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const id = existing[index]?.id ?? (index === 0 ? REGISTRATION_BOX_OBJECT_ID : idFactory());
      const position = {
        x: origin.x + column * (dimensions.width + nonNegative(grid.spacingX)),
        y: origin.y + row * (dimensions.height + nonNegative(grid.spacingY)),
      };
      const created = createOutline(outline, position, id);
      outlines.push(isLocked ? { ...created, locked: true } : created);
    }
  }
  return outlines;
}

function createOutline(
  outline: RegistrationJigOutlineSpec,
  position: { readonly x: number; readonly y: number },
  id: string,
): ShapeObject {
  return outline.kind === 'circle'
    ? createRegistrationCircle({ diameterMm: outline.diameterMm, ...position, id })
    : createRegistrationBox({
        widthMm: outline.widthMm,
        heightMm: outline.heightMm,
        ...position,
        id,
      });
}

function outlineDimensions(outline: RegistrationJigOutlineSpec): {
  readonly width: number;
  readonly height: number;
} {
  if (outline.kind === 'circle') {
    const diameter = jigSize(outline.diameterMm);
    return { width: diameter, height: diameter };
  }
  return { width: jigSize(outline.widthMm), height: jigSize(outline.heightMm) };
}

function positiveInteger(value: number): number {
  const count = Math.floor(value);
  return Number.isSafeInteger(count) && count >= 1 ? count : 1;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value));
}

function jigSize(value: number): number {
  return Math.max(MIN_JIG_SIZE_MM, finite(value));
}
