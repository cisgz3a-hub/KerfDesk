// Material Test grid layout: where cells and burned labels sit (ADR-497
// widens the left gutter so the first column's runway stays right of the
// grid's origin).

import type { ImportedSvg } from '../scene';
import {
  calibrationLabelSizeToFit,
  calibrationLabelWidthMm,
  createCalibrationLabelObject,
} from './calibration-labels';

// A column label spans at most this share of the column pitch, so the clear
// space between two labels is always wider than the space between two digits.
const COLUMN_LABEL_PITCH_SHARE = 0.9;

export type MaterialTestLayout = {
  readonly origin: { readonly x: number; readonly y: number };
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly labelSize: number;
  /** One size for every column label, small enough that neighbours never touch. */
  readonly columnLabelSize: number;
  readonly labelGap: number;
  readonly labelGutter: number;
  readonly leftGutter: number;
  readonly topGutter: number;
  readonly rowLabels: ReadonlyArray<string>;
  readonly columnLabels: ReadonlyArray<string>;
};

export function materialTestLayout(args: {
  readonly origin: { readonly x: number; readonly y: number };
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly rowLabels: ReadonlyArray<string>;
  readonly columnLabels: ReadonlyArray<string>;
  readonly runwayMm: number;
}): MaterialTestLayout {
  const { runwayMm, ...rest } = args;
  const labelSize = labelSizeForCell(args.cellWidth, args.cellHeight);
  const labelGap = Math.max(0.5, Math.min(args.gap, 2));
  const labelGutter =
    Math.max(...args.rowLabels.map((label) => calibrationLabelWidthMm(label, labelSize))) +
    labelGap;
  // ADR-497 Amendment 1: the Interval Test's fit, applied to the column pitch.
  const columnLabelWidthMm = COLUMN_LABEL_PITCH_SHARE * (args.cellWidth + args.gap);
  const columnLabelSize = Math.min(
    labelSize,
    ...args.columnLabels.map((label) =>
      calibrationLabelSizeToFit(label, labelSize, columnLabelWidthMm),
    ),
  );
  const firstColumnLabel = args.columnLabels[0] ?? '';
  const firstColumnOverhang =
    (calibrationLabelWidthMm(firstColumnLabel, columnLabelSize) - args.cellWidth) / 2;
  return {
    ...rest,
    labelSize,
    columnLabelSize,
    labelGap,
    labelGutter,
    // The first column's runway, and its label, stay right of the grid's origin.
    leftGutter: Math.max(labelGutter, runwayMm, firstColumnOverhang),
    topGutter: labelSize + labelGap,
  };
}

export function materialTestLabelObjects(
  layout: MaterialTestLayout,
  operationId: string,
): ReadonlyArray<ImportedSvg> {
  const columnSize = layout.columnLabelSize;
  return [
    ...layout.columnLabels.map((label, column) =>
      createCalibrationLabelObject({
        id: `material-test-power-c${column}`,
        operationId,
        text: label,
        // Centred on the cell; a label wider than the cell runs into the gaps.
        x:
          cellX(layout, column) +
          (layout.cellWidth - calibrationLabelWidthMm(label, columnSize)) / 2,
        // A shrunk label keeps to the cells' edge of the top gutter.
        y: layout.origin.y + layout.labelSize - columnSize,
        sizeMm: columnSize,
      }),
    ),
    ...layout.rowLabels.map((label, row) =>
      createCalibrationLabelObject({
        id: `material-test-speed-r${row}`,
        operationId,
        text: label,
        x: layout.origin.x + layout.leftGutter - layout.labelGutter,
        y: cellY(layout, row) + centerOffset(layout.cellHeight, layout.labelSize),
        sizeMm: layout.labelSize,
      }),
    ),
  ];
}

function labelSizeForCell(width: number, height: number): number {
  return Math.max(1.4, Math.min(2.5, width * 0.42, height * 0.45));
}

export function cellX(layout: MaterialTestLayout, column: number): number {
  return layout.origin.x + layout.leftGutter + column * (layout.cellWidth + layout.gap);
}

export function cellY(layout: MaterialTestLayout, row: number): number {
  return layout.origin.y + layout.topGutter + row * (layout.cellHeight + layout.gap);
}

function centerOffset(span: number, childSpan: number): number {
  return Math.max(0, (span - childSpan) / 2);
}
