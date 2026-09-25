// Geometry of a Material Test grid (ADR-381): where each cell sits, the burned
// value labels above the columns and beside the rows, and the optional border.
// material-test-axes-grid.ts decides what each cell burns.

import {
  combinedBBox,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type SceneObject,
} from '../scene';
import { calibrationLabelWidthMm, createCalibrationLabelObject } from './calibration-labels';

export const MATERIAL_TEST_BORDER_SOURCE = 'material-test-border';
const DEFAULT_GAP_MM = 1;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;
const MIN_CELL_SIZE_MM = 0.1;
const BORDER_MARGIN_MM = 2;

export type MaterialTestLayoutOptions = {
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
  readonly gapMm?: number;
  readonly origin?: { readonly x: number; readonly y: number };
  readonly labels?: boolean;
  readonly border?: boolean;
};

export type MaterialTestLayout = {
  readonly origin: { readonly x: number; readonly y: number };
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly labelSize: number;
  readonly leftGutter: number;
  readonly topGutter: number;
  readonly rowLabels: ReadonlyArray<string>;
  readonly columnLabels: ReadonlyArray<string>;
};

export function materialTestLayout(
  options: MaterialTestLayoutOptions,
  rowLabels: ReadonlyArray<string>,
  columnLabels: ReadonlyArray<string>,
): MaterialTestLayout {
  const cellWidth = Math.max(MIN_CELL_SIZE_MM, finiteOr(options.cellWidthMm, MIN_CELL_SIZE_MM));
  const cellHeight = Math.max(MIN_CELL_SIZE_MM, finiteOr(options.cellHeightMm, MIN_CELL_SIZE_MM));
  const gap = Math.max(0, finiteOr(options.gapMm ?? DEFAULT_GAP_MM, DEFAULT_GAP_MM));
  const outer = options.origin ?? DEFAULT_ORIGIN;
  // The border sits outside the labels, so a bordered test shifts inward and
  // its frame still starts at the requested origin.
  const inset = options.border === true ? BORDER_MARGIN_MM : 0;
  const labelSize = Math.max(1.4, Math.min(2.5, cellWidth * 0.42, cellHeight * 0.45));
  const labelGap = Math.max(0.5, Math.min(gap, 2));
  const labelled = options.labels !== false;
  return {
    origin: { x: outer.x + inset, y: outer.y + inset },
    cellWidth,
    cellHeight,
    gap,
    labelSize,
    rowLabels,
    columnLabels,
    leftGutter: labelled
      ? Math.max(...rowLabels.map((label) => calibrationLabelWidthMm(label, labelSize))) + labelGap
      : 0,
    topGutter: labelled ? labelSize + labelGap : 0,
  };
}

export function materialTestCellX(layout: MaterialTestLayout, column: number): number {
  return layout.origin.x + layout.leftGutter + column * (layout.cellWidth + layout.gap);
}

export function materialTestCellY(layout: MaterialTestLayout, row: number): number {
  return layout.origin.y + layout.topGutter + row * (layout.cellHeight + layout.gap);
}

/** Row and column value labels, ids naming the axis setting they show. */
export function materialTestLabelObjects(args: {
  readonly prefix: string;
  readonly rowParameter: string;
  readonly columnParameter: string;
  readonly layout: MaterialTestLayout;
  readonly labelLayer: Layer;
}): ImportedSvg[] {
  const { layout, labelLayer } = args;
  const label = (id: string, text: string, x: number, y: number): ImportedSvg => {
    const object = createCalibrationLabelObject({
      id,
      operationId: labelLayer.id,
      text,
      x,
      y,
      sizeMm: layout.labelSize,
    });
    // Legacy bindings go by path color, so labels carry their operation's.
    return {
      ...object,
      paths: object.paths.map((path) => ({ ...path, color: labelLayer.color })),
    };
  };
  return [
    ...layout.columnLabels.map((text, column) =>
      label(
        `${args.prefix}-${args.columnParameter}-c${column}`,
        text,
        materialTestCellX(layout, column) +
          centerOffset(layout.cellWidth, calibrationLabelWidthMm(text, layout.labelSize)),
        layout.origin.y,
      ),
    ),
    ...layout.rowLabels.map((text, row) =>
      label(
        `${args.prefix}-${args.rowParameter}-r${row}`,
        text,
        layout.origin.x,
        materialTestCellY(layout, row) + centerOffset(layout.cellHeight, layout.labelSize),
      ),
    ),
  ];
}

export function materialTestBorderObject(
  prefix: string,
  contents: ReadonlyArray<SceneObject>,
  borderLayer: Layer,
): ImportedSvg {
  const box = combinedBBox(contents) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const width = box.maxX - box.minX + 2 * BORDER_MARGIN_MM;
  const height = box.maxY - box.minY + 2 * BORDER_MARGIN_MM;
  return {
    kind: 'imported-svg',
    id: `${prefix}-border-frame`,
    source: MATERIAL_TEST_BORDER_SOURCE,
    operationIds: [borderLayer.id],
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: box.minX - BORDER_MARGIN_MM,
      y: box.minY - BORDER_MARGIN_MM,
    },
    paths: [{ color: borderLayer.color, polylines: [materialTestRectangle(width, height)] }],
  };
}

export function materialTestRectangle(width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ],
  };
}

function centerOffset(span: number, childSpan: number): number {
  return Math.max(0, (span - childSpan) / 2);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
