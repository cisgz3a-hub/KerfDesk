// ADR-497: what the Material Test dialog's preview draws. Generate's own
// axes give the rows and columns, so the preview's values and labels are the
// ones the job burns, speeds capped at the profile's maximum feed. It never
// feeds output.

import {
  effectiveCalibrationSpeed,
  type MaterialTestParameter,
} from '../../core/job/material-test-axes';
import {
  materialTestCellDimensions,
  materialTestGridAxes,
  type MaterialTestGridOptions,
} from '../../core/job/material-test-grid';

export type MaterialTestPreviewCell = {
  readonly row: number;
  readonly column: number;
  /** Feed the job emits, after the profile's maximum feed. */
  readonly speed: number;
  readonly power: number;
  readonly passes: number;
  /** Hatch spacing of an engraved cell; absent for a cut. */
  readonly intervalMm?: number;
  /** Energy relative to the grid's strongest cell: 0 burns nothing, 1 is the deepest. */
  readonly energy: number;
};

export type MaterialTestPreviewAxis = {
  readonly parameter: MaterialTestParameter;
  readonly name: string;
  readonly unit: string;
  /** Burned label text, gentlest first. */
  readonly labels: ReadonlyArray<string>;
};

export type MaterialTestPreviewModel = {
  readonly mode: 'fill' | 'line';
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly rows: MaterialTestPreviewAxis;
  readonly columns: MaterialTestPreviewAxis;
  /** Row by row, gentlest cell first. */
  readonly cells: ReadonlyArray<MaterialTestPreviewCell>;
  readonly summary: string;
};

const PARAMETER_TEXT: Readonly<
  Record<MaterialTestParameter, { readonly name: string; readonly unit: string }>
> = {
  speed: { name: 'speed', unit: 'mm/min' },
  power: { name: 'power', unit: '%' },
  passes: { name: 'passes', unit: '' },
  interval: { name: 'hatch spacing', unit: 'mm' },
};

export function materialTestPreview(options: MaterialTestGridOptions): MaterialTestPreviewModel {
  const { mode, rowAxis, columnAxis, fixed } = materialTestGridAxes(options);
  const settled = rowAxis.values.flatMap((rowValue, row) =>
    columnAxis.values.map((columnValue, column) => {
      const settings = {
        ...fixed,
        [columnAxis.parameter]: columnValue,
        [rowAxis.parameter]: rowValue,
      };
      const speed = effectiveCalibrationSpeed(settings.speed, options.maxFeedMmPerMin);
      // Energy per area: power × passes over speed, and over hatch spacing
      // for an engraving, whose lines sit closer as the spacing narrows.
      const spacing = mode === 'fill' ? settings.interval : 1;
      return {
        row,
        column,
        speed,
        power: settings.power,
        passes: settings.passes,
        ...(mode === 'fill' ? { intervalMm: settings.interval } : {}),
        dose: (settings.power * settings.passes) / (speed * spacing),
      };
    }),
  );
  const doses = settled.map((cell) => cell.dose);
  const deepest = Math.max(0, ...doses);
  const cells = settled.map(({ dose, ...cell }) => ({
    ...cell,
    energy: deepest > 0 ? dose / deepest : 0,
  }));
  const rows = previewAxis(rowAxis.parameter, rowAxis.labels);
  const columns = previewAxis(columnAxis.parameter, columnAxis.labels);
  return {
    mode,
    ...materialTestCellDimensions(options),
    rows,
    columns,
    cells,
    summary: previewSummary(mode, rows, columns, Math.min(...doses), deepest),
  };
}

function previewAxis(
  parameter: MaterialTestParameter,
  labels: ReadonlyArray<string>,
): MaterialTestPreviewAxis {
  return { parameter, ...PARAMETER_TEXT[parameter], labels };
}

function previewSummary(
  mode: 'fill' | 'line',
  rows: MaterialTestPreviewAxis,
  columns: MaterialTestPreviewAxis,
  faintest: number,
  deepest: number,
): string {
  const card = `${rows.labels.length} by ${columns.labels.length} ${mode === 'fill' ? 'engraved' : 'cut'} test card`;
  return (
    `${card}: rows vary ${axisSpan(rows)}; columns vary ${axisSpan(columns)}. ` +
    `Darker cells get more energy${energySpan(faintest, deepest)}.`
  );
}

function axisSpan(axis: MaterialTestPreviewAxis): string {
  const first = axis.labels[0] ?? '';
  const last = axis.labels[axis.labels.length - 1] ?? first;
  const unit = axis.unit === '' ? '' : axis.unit === '%' ? '%' : ` ${axis.unit}`;
  return first === last
    ? `${axis.name} at ${first}${unit}`
    : `${axis.name} from ${first} to ${last}${unit}`;
}

function energySpan(faintest: number, deepest: number): string {
  if (!(faintest > 0) || !(deepest > 0)) return '';
  const ratio = deepest / faintest;
  if (ratio < 1.005) return '; every cell gets the same';
  const times = ratio.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `; the deepest gets ${times} times the faintest`;
}
