// ADR-497: the Material Test dialog's text draft, which fields it shows for
// the two settings the grid varies, and the grid options it becomes.

import type { MaterialTestGridOptions } from '../../core/job';
import {
  MATERIAL_TEST_PARAMETERS,
  MAX_TEST_INTERVAL_MM,
  MAX_TEST_PASSES,
  MIN_TEST_INTERVAL_MM,
  MIN_TEST_PASSES,
  type MaterialTestParameter,
} from '../../core/job/material-test-axes';
import type { CalibrationDraftField } from './calibration-draft-validation';

export type MaterialTestMode = 'fill' | 'line';

export type MaterialTestDraft = {
  readonly mode: string;
  readonly rowParameter: string;
  readonly columnParameter: string;
  readonly rows: string;
  readonly columns: string;
  readonly speedMin: string;
  readonly speedMax: string;
  readonly powerMin: string;
  readonly powerMax: string;
  readonly passesMin: string;
  readonly passesMax: string;
  readonly intervalMin: string;
  readonly intervalMax: string;
  readonly speed: string;
  readonly power: string;
  readonly passes: string;
  readonly interval: string;
  readonly cellWidthMm: string;
  readonly cellHeightMm: string;
  readonly gapMm: string;
};

export type MaterialTestNumberKey = Exclude<
  keyof MaterialTestDraft,
  'mode' | 'rowParameter' | 'columnParameter'
>;

type Field = CalibrationDraftField<MaterialTestNumberKey>;

export const DEFAULT_MATERIAL_TEST_DRAFT: MaterialTestDraft = {
  mode: 'fill',
  rowParameter: 'speed',
  columnParameter: 'power',
  rows: '10',
  columns: '10',
  speedMin: '1000',
  speedMax: '3000',
  powerMin: '10',
  powerMax: '40',
  passesMin: '1',
  passesMax: '5',
  intervalMin: '0.05',
  intervalMax: '0.2',
  speed: '1500',
  power: '30',
  passes: '1',
  interval: '0.1',
  cellWidthMm: '5',
  cellHeightMm: '5',
  gapMm: '1',
};

export const MATERIAL_TEST_DRAFT_FIELDS = Object.keys(DEFAULT_MATERIAL_TEST_DRAFT) as ReadonlyArray<
  keyof MaterialTestDraft
>;

export const MATERIAL_TEST_PARAMETER_NAMES: Readonly<Record<MaterialTestParameter, string>> = {
  speed: 'Speed',
  power: 'Power',
  passes: 'Passes',
  interval: 'Hatch spacing',
};

const COUNT_FIELDS: ReadonlyArray<Field> = [
  { key: 'rows', label: 'Rows', min: 1, max: 20, step: undefined },
  { key: 'columns', label: 'Columns', min: 1, max: 20, step: undefined },
];

const CELL_FIELDS: ReadonlyArray<Field> = [
  { key: 'cellWidthMm', label: 'Cell width', min: 0.1, max: undefined, step: 0.1 },
  { key: 'cellHeightMm', label: 'Cell height', min: 0.1, max: undefined, step: 0.1 },
  { key: 'gapMm', label: 'Gap', min: 0, max: undefined, step: 0.1 },
];

type ParameterFields = { readonly range: readonly [Field, Field]; readonly fixed: Field };

const PARAMETER_FIELDS: Readonly<Record<MaterialTestParameter, ParameterFields>> = {
  speed: parameterFields('speed', 'speedMin', 'speedMax', 'speed', 1, undefined, undefined),
  power: parameterFields('power', 'powerMin', 'powerMax', 'power', 0, 100, undefined),
  passes: parameterFields(
    'passes',
    'passesMin',
    'passesMax',
    'passes',
    MIN_TEST_PASSES,
    MAX_TEST_PASSES,
    1,
  ),
  interval: parameterFields(
    'hatch spacing',
    'intervalMin',
    'intervalMax',
    'interval',
    MIN_TEST_INTERVAL_MM,
    MAX_TEST_INTERVAL_MM,
    0.001,
  ),
};

export function materialTestMode(draft: MaterialTestDraft): MaterialTestMode {
  return draft.mode === 'line' ? 'line' : 'fill';
}

/** Settings this kind of test can vary: a cut has no hatch spacing. */
export function materialTestParameters(
  mode: MaterialTestMode,
): ReadonlyArray<MaterialTestParameter> {
  return MATERIAL_TEST_PARAMETERS.filter(
    (parameter) => mode === 'fill' || parameter !== 'interval',
  );
}

/** The row and column settings, always two different ones this mode allows. */
export function materialTestAxes(
  draft: MaterialTestDraft,
): readonly [MaterialTestParameter, MaterialTestParameter] {
  const allowed = materialTestParameters(materialTestMode(draft));
  const known = (value: string): MaterialTestParameter | undefined =>
    allowed.find((parameter) => parameter === value);
  const row = known(draft.rowParameter) ?? 'speed';
  const column = known(draft.columnParameter);
  if (column !== undefined && column !== row) return [row, column];
  return [row, allowed.find((parameter) => parameter !== row) ?? 'power'];
}

/** Choosing an axis's setting swaps the other axis off it; a cut drops hatch spacing. */
export function withMaterialTestChoice(
  draft: MaterialTestDraft,
  choice: 'mode' | 'rowParameter' | 'columnParameter',
  value: string,
): MaterialTestDraft {
  const [row, column] = materialTestAxes(draft);
  if (choice === 'mode') {
    const next = { ...draft, mode: value };
    const [nextRow, nextColumn] = materialTestAxes(next);
    return { ...next, rowParameter: nextRow, columnParameter: nextColumn };
  }
  if (choice === 'rowParameter') {
    return { ...draft, rowParameter: value, columnParameter: value === column ? row : column };
  }
  return { ...draft, columnParameter: value, rowParameter: value === row ? column : row };
}

/** Fields shown and checked: a range for each varied setting, one value for the rest. */
export function materialTestFields(draft: MaterialTestDraft): ReadonlyArray<Field> {
  const axes = materialTestAxes(draft);
  const settingFields = materialTestParameters(materialTestMode(draft)).flatMap((parameter) =>
    axes.includes(parameter)
      ? PARAMETER_FIELDS[parameter].range
      : [PARAMETER_FIELDS[parameter].fixed],
  );
  return [...COUNT_FIELDS, ...settingFields, ...CELL_FIELDS];
}

export function parseMaterialTestDraft(draft: MaterialTestDraft): MaterialTestGridOptions {
  const [rowParameter, columnParameter] = materialTestAxes(draft);
  return {
    mode: materialTestMode(draft),
    rowParameter,
    columnParameter,
    rows: numberValue(draft.rows),
    columns: numberValue(draft.columns),
    speedMin: numberValue(draft.speedMin),
    speedMax: numberValue(draft.speedMax),
    powerMin: numberValue(draft.powerMin),
    powerMax: numberValue(draft.powerMax),
    passesMin: numberValue(draft.passesMin),
    passesMax: numberValue(draft.passesMax),
    intervalMinMm: numberValue(draft.intervalMin),
    intervalMaxMm: numberValue(draft.intervalMax),
    speed: numberValue(draft.speed),
    power: numberValue(draft.power),
    passes: numberValue(draft.passes),
    intervalMm: numberValue(draft.interval),
    cellWidthMm: numberValue(draft.cellWidthMm),
    cellHeightMm: numberValue(draft.cellHeightMm),
    gapMm: numberValue(draft.gapMm),
  };
}

export function numberValue(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function parameterFields(
  name: string,
  minKey: MaterialTestNumberKey,
  maxKey: MaterialTestNumberKey,
  fixedKey: MaterialTestNumberKey,
  min: number,
  max: number | undefined,
  step: number | undefined,
): ParameterFields {
  const capitalized = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return {
    range: [
      { key: minKey, label: `Min ${name}`, min, max, step },
      { key: maxKey, label: `Max ${name}`, min, max, step },
    ],
    fixed: { key: fixedKey, label: capitalized, min, max, step },
  };
}
