// Material Test dialog draft (ADR-381): the operator's text as typed, the
// field rules that depend on the chosen axes and mode, and the request the
// dialog hands back. Every value is a string so incomplete input stays
// distinct from zero until Generate, like the other calibration dialogs.

import {
  MATERIAL_TEST_MAX_COUNT,
  MATERIAL_TEST_MAX_PASSES,
  MATERIAL_TEST_PARAMETERS,
  materialTestAxesIssue,
  type MaterialTestMode,
  type MaterialTestParameter,
} from '../../core/job/material-test-axes';
import type { MaterialTestInsertOptions } from '../../core/job/material-test-insertion';
import { persistCalibrationDraft, restoreCalibrationDraft } from './calibration-draft-storage';
import { calibrationDraftIssues, type CalibrationDraftField } from './calibration-draft-validation';

export type MaterialTestModeChoice = 'line' | 'fill' | 'image-dithered' | 'image-grayscale';
export type MaterialTestPlacement = 'insert' | 'new-project';

export type MaterialTestDraft = {
  readonly mode: string;
  readonly rowParameter: string;
  readonly rowStart: string;
  readonly rowEnd: string;
  readonly rowCount: string;
  readonly columnParameter: string;
  readonly columnStart: string;
  readonly columnEnd: string;
  readonly columnCount: string;
  readonly power: string;
  readonly speed: string;
  readonly passes: string;
  readonly intervalMm: string;
  readonly airAssist: string;
  readonly cellWidthMm: string;
  readonly cellHeightMm: string;
  readonly gapMm: string;
  readonly labels: string;
  readonly border: string;
  readonly placement: string;
};

export type MaterialTestDraftKey = keyof MaterialTestDraft;

export type MaterialTestRequest = {
  /** Everything but the profile feed ceiling, which the host adds. */
  readonly options: MaterialTestInsertOptions;
  readonly placement: MaterialTestPlacement;
};

// Fill, 10 x 10, speed rows 3000 -> 1000 and power columns 10 -> 40 with the
// layer defaults: exactly the ADR-044 test, so an untouched dialog generates
// the same scene it always did.
export const DEFAULT_MATERIAL_TEST_DRAFT: MaterialTestDraft = {
  mode: 'fill',
  rowParameter: 'speed',
  rowStart: '3000',
  rowEnd: '1000',
  rowCount: '10',
  columnParameter: 'power',
  columnStart: '10',
  columnEnd: '40',
  columnCount: '10',
  power: '30',
  speed: '1500',
  passes: '1',
  intervalMm: '0.1',
  airAssist: 'off',
  cellWidthMm: '5',
  cellHeightMm: '5',
  gapMm: '1',
  labels: 'on',
  border: 'off',
  placement: 'insert',
};

export const MATERIAL_TEST_AXIS_DEFAULTS: Readonly<
  Record<MaterialTestParameter, { readonly start: string; readonly end: string }>
> = {
  power: { start: '10', end: '40' },
  speed: { start: '3000', end: '1000' },
  interval: { start: '0.2', end: '0.05' },
  passes: { start: '1', end: '4' },
};

const DRAFT_KEY = 'laserforge.calibration.materialTestDraft.v2';
const LEGACY_DRAFT_KEY = 'laserforge.calibration.materialTestDraft.v1';
const DRAFT_FIELDS = Object.keys(
  DEFAULT_MATERIAL_TEST_DRAFT,
) as ReadonlyArray<MaterialTestDraftKey>;
const LEGACY_FIELDS = [
  'rows',
  'columns',
  'speedMin',
  'speedMax',
  'powerMin',
  'powerMax',
  'cellWidthMm',
  'cellHeightMm',
  'gapMm',
] as const;
const MODE_CHOICES: ReadonlyArray<MaterialTestModeChoice> = [
  'line',
  'fill',
  'image-dithered',
  'image-grayscale',
];

/** The last generated draft; a pre-ADR-381 speed x power draft carries over. */
export function restoreMaterialTestDraft(): MaterialTestDraft {
  const d = DEFAULT_MATERIAL_TEST_DRAFT;
  const legacy = restoreCalibrationDraft(
    LEGACY_DRAFT_KEY,
    {
      rows: d.rowCount,
      columns: d.columnCount,
      speedMin: d.rowEnd,
      speedMax: d.rowStart,
      powerMin: d.columnStart,
      powerMax: d.columnEnd,
      cellWidthMm: d.cellWidthMm,
      cellHeightMm: d.cellHeightMm,
      gapMm: d.gapMm,
    },
    LEGACY_FIELDS,
  );
  const carried: MaterialTestDraft = {
    ...d,
    rowCount: legacy.rows,
    rowStart: legacy.speedMax,
    rowEnd: legacy.speedMin,
    columnCount: legacy.columns,
    columnStart: legacy.powerMin,
    columnEnd: legacy.powerMax,
    cellWidthMm: legacy.cellWidthMm,
    cellHeightMm: legacy.cellHeightMm,
    gapMm: legacy.gapMm,
  };
  const restored = restoreCalibrationDraft(DRAFT_KEY, carried, DRAFT_FIELDS);
  return {
    ...restored,
    mode: modeChoice(restored.mode),
    rowParameter: parameterOf(restored.rowParameter, 'speed'),
    columnParameter: parameterOf(restored.columnParameter, 'power'),
    placement: restored.placement === 'new-project' ? 'new-project' : 'insert',
  };
}

export function persistMaterialTestDraft(draft: MaterialTestDraft): void {
  persistCalibrationDraft(DRAFT_KEY, draft);
}

export function modeChoice(value: string): MaterialTestModeChoice {
  return MODE_CHOICES.find((choice) => choice === value) ?? 'fill';
}

export function parameterOf(value: string, fallback: MaterialTestParameter): MaterialTestParameter {
  return MATERIAL_TEST_PARAMETERS.find((parameter) => parameter === value) ?? fallback;
}

export function testMode(choice: MaterialTestModeChoice): MaterialTestMode {
  return choice === 'image-dithered' || choice === 'image-grayscale' ? 'image' : choice;
}

export const AXIS_KEYS = {
  row: { parameter: 'rowParameter', start: 'rowStart', end: 'rowEnd', count: 'rowCount' },
  column: {
    parameter: 'columnParameter',
    start: 'columnStart',
    end: 'columnEnd',
    count: 'columnCount',
  },
} as const;

/**
 * Points one axis at another setting. The range resets to that setting's
 * defaults, except that picking the setting the other axis holds swaps the
 * two axes, ranges included, so the pair never ends up testing one setting.
 */
export function withAxisParameter(
  draft: MaterialTestDraft,
  axis: keyof typeof AXIS_KEYS,
  parameter: MaterialTestParameter,
): MaterialTestDraft {
  const own = AXIS_KEYS[axis];
  const other = AXIS_KEYS[axis === 'row' ? 'column' : 'row'];
  if (draft[own.parameter] === parameter) return draft;
  if (draft[other.parameter] === parameter) {
    return {
      ...draft,
      [own.parameter]: draft[other.parameter],
      [own.start]: draft[other.start],
      [own.end]: draft[other.end],
      [other.parameter]: draft[own.parameter],
      [other.start]: draft[own.start],
      [other.end]: draft[own.end],
    };
  }
  const defaults = MATERIAL_TEST_AXIS_DEFAULTS[parameter];
  return {
    ...draft,
    [own.parameter]: parameter,
    [own.start]: defaults.start,
    [own.end]: defaults.end,
  };
}

/** Fixed settings the dialog shows: the ones neither axis varies. */
export function fixedParameters(draft: MaterialTestDraft): ReadonlyArray<MaterialTestParameter> {
  const mode = testMode(modeChoice(draft.mode));
  return MATERIAL_TEST_PARAMETERS.filter(
    (parameter) =>
      parameter !== draft.rowParameter &&
      parameter !== draft.columnParameter &&
      !(parameter === 'interval' && mode === 'line'),
  );
}

export function materialTestDraftIssues(draft: MaterialTestDraft): ReadonlyArray<string> {
  const mode = testMode(modeChoice(draft.mode));
  const row = parameterOf(draft.rowParameter, 'speed');
  const column = parameterOf(draft.columnParameter, 'power');
  const axisIssue = materialTestAxesIssue({ parameter: row }, { parameter: column }, mode);
  const fields: ReadonlyArray<CalibrationDraftField<MaterialTestDraftKey>> = [
    { key: 'rowStart', label: 'Row start', ...valueRule(row, mode) },
    { key: 'rowEnd', label: 'Row end', ...valueRule(row, mode) },
    { key: 'rowCount', label: 'Rows', ...COUNT_RULE },
    { key: 'columnStart', label: 'Column start', ...valueRule(column, mode) },
    { key: 'columnEnd', label: 'Column end', ...valueRule(column, mode) },
    { key: 'columnCount', label: 'Columns', ...COUNT_RULE },
    ...fixedParameters(draft).map((parameter) => ({
      key: FIXED_KEYS[parameter],
      label: FIXED_LABELS[parameter],
      ...valueRule(parameter, mode),
    })),
    { key: 'cellWidthMm', label: 'Cell width', min: 0.1, max: undefined, step: 0.1 },
    { key: 'cellHeightMm', label: 'Cell height', min: 0.1, max: undefined, step: 0.1 },
    { key: 'gapMm', label: 'Gap', min: 0, max: undefined, step: 0.1 },
  ];
  return [...(axisIssue === null ? [] : [axisIssue]), ...calibrationDraftIssues(draft, fields)];
}

export function valueRule(
  parameter: MaterialTestParameter,
  mode: MaterialTestMode,
): { readonly min: number; readonly max: number | undefined; readonly step: number } {
  switch (parameter) {
    case 'power':
      return { min: 0, max: 100, step: 0.1 };
    case 'speed':
      return { min: 1, max: undefined, step: 1 };
    case 'passes':
      return { min: 1, max: MATERIAL_TEST_MAX_PASSES, step: 1 };
    case 'interval':
      return mode === 'image'
        ? { min: 0.04, max: 0.2, step: 0.001 }
        : { min: 0.05, max: 10, step: 0.001 };
    default:
      return parameter satisfies never;
  }
}

export function materialTestRequest(draft: MaterialTestDraft): MaterialTestRequest {
  const choice = modeChoice(draft.mode);
  return {
    placement: draft.placement === 'new-project' ? 'new-project' : 'insert',
    options: {
      mode: testMode(choice),
      rowAxis: {
        parameter: parameterOf(draft.rowParameter, 'speed'),
        start: numberValue(draft.rowStart),
        end: numberValue(draft.rowEnd),
        count: numberValue(draft.rowCount),
      },
      columnAxis: {
        parameter: parameterOf(draft.columnParameter, 'power'),
        start: numberValue(draft.columnStart),
        end: numberValue(draft.columnEnd),
        count: numberValue(draft.columnCount),
      },
      base: {
        power: numberValue(draft.power),
        speed: numberValue(draft.speed),
        passes: numberValue(draft.passes),
        intervalMm: numberValue(draft.intervalMm),
        airAssist: draft.airAssist === 'on',
        ditherAlgorithm: choice === 'image-grayscale' ? 'grayscale' : 'floyd-steinberg',
      },
      cellWidthMm: numberValue(draft.cellWidthMm),
      cellHeightMm: numberValue(draft.cellHeightMm),
      gapMm: numberValue(draft.gapMm),
      labels: draft.labels !== 'off',
      border: draft.border === 'on',
    },
  };
}

export function numberValue(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

export const FIXED_KEYS: Readonly<Record<MaterialTestParameter, MaterialTestDraftKey>> = {
  power: 'power',
  speed: 'speed',
  passes: 'passes',
  interval: 'intervalMm',
};

export const FIXED_LABELS: Readonly<Record<MaterialTestParameter, string>> = {
  power: 'Power',
  speed: 'Speed',
  passes: 'Passes',
  interval: 'Interval',
};

const COUNT_RULE = { min: 1, max: MATERIAL_TEST_MAX_COUNT, step: 1 } as const;
