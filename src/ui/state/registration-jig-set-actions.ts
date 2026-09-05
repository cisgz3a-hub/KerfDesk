import {
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  findRegistrationLayer,
  type Scene,
  type ShapeObject,
} from '../../core/scene';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
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
// This editor materializes every outline and its undo state in one synchronous
// scene transaction. Bound the combined allocation, not each axis separately.
export const MAX_REGISTRATION_JIG_OUTLINES = PROJECT_SCENE_LIMITS.objects;

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
  const issue = registrationJigSetIssue(spec, state.project.scene);
  if (issue !== null) throw new Error(issue);
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
  const issue = registrationJigSetIssue({ outline, ...grid });
  if (issue !== null) throw new Error(issue);
  const dimensions = outlineDimensions(outline);
  const rows = positiveInteger(grid.rows);
  const columns = positiveInteger(grid.columns);
  const strideX = columns > 1 ? dimensions.width + nonNegative(grid.spacingX) : 0;
  const strideY = rows > 1 ? dimensions.height + nonNegative(grid.spacingY) : 0;
  const lastX = origin.x + (columns - 1) * strideX;
  const lastY = origin.y + (rows - 1) * strideY;
  if (
    ![origin.x, origin.y, lastX, lastY, lastX + dimensions.width, lastY + dimensions.height].every(
      Number.isFinite,
    )
  ) {
    throw new Error('The jig positions cannot be represented as finite coordinates.');
  }
  const isLocked = existing.length > 0 && existing.every((candidate) => candidate.locked === true);
  const outlines: ShapeObject[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const id = existing[index]?.id ?? (index === 0 ? REGISTRATION_BOX_OBJECT_ID : idFactory());
      const position = {
        x: origin.x + column * strideX,
        y: origin.y + row * strideY,
      };
      const created = createOutline(outline, position, id);
      outlines.push(isLocked ? { ...created, locked: true } : created);
    }
  }
  return outlines;
}

export function registrationJigSetIssue(
  spec: RegistrationJigSetSpec,
  scene?: Scene,
): string | null {
  for (const [label, count] of [
    ['Rows', spec.rows],
    ['Columns', spec.columns],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 1)
      return `${label} must be a positive whole number.`;
  }
  const count = spec.rows * spec.columns;
  if (!Number.isSafeInteger(count) || count > MAX_REGISTRATION_JIG_OUTLINES) {
    return `This jig editor can construct at most ${MAX_REGISTRATION_JIG_OUTLINES} outlines at once. Rows × columns requests ${count}. Reduce the rows or columns.`;
  }
  const capacityIssue = jigSceneCapacityIssue(scene, count);
  if (capacityIssue !== null) return capacityIssue;
  const dimensionIssue = jigDimensionsIssue(spec);
  if (dimensionIssue !== null) return dimensionIssue;
  const size = outlineDimensions(spec.outline);
  if (
    !Number.isFinite(size.width * spec.columns + spec.spacingX * (spec.columns - 1)) ||
    !Number.isFinite(size.height * spec.rows + spec.spacingY * (spec.rows - 1))
  ) {
    return 'The jig footprint cannot be represented as finite coordinates.';
  }
  return null;
}

function jigSceneCapacityIssue(scene: Scene | undefined, count: number): string | null {
  if (scene === undefined) return null;
  const retained = scene.objects.length - findRegistrationBoxes(scene).length;
  const available = Math.max(0, PROJECT_SCENE_LIMITS.objects - retained);
  if (count > available)
    return `This project has room for ${available} jig outlines while retaining its artwork (project limit ${PROJECT_SCENE_LIMITS.objects} objects).`;
  if (findRegistrationLayer(scene) === null && scene.layers.length >= PROJECT_SCENE_LIMITS.layers) {
    return 'This project has no free operation slot for the registration outlines.';
  }
  return null;
}

function jigDimensionsIssue(spec: RegistrationJigSetSpec): string | null {
  const dimensions =
    spec.outline.kind === 'circle'
      ? ([['Diameter', spec.outline.diameterMm]] as const)
      : ([
          ['Width', spec.outline.widthMm],
          ['Height', spec.outline.heightMm],
        ] as const);
  for (const [label, value] of dimensions) {
    if (!Number.isFinite(value) || value < MIN_JIG_SIZE_MM)
      return `${label} must be at least ${MIN_JIG_SIZE_MM} mm.`;
  }
  for (const gap of [spec.spacingX, spec.spacingY]) {
    if (!Number.isFinite(gap) || gap < 0)
      return 'Jig spacing must be a finite number at or above zero.';
  }
  return null;
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
