// Material Test grid with selectable axes (ADR-381, extending ADR-044).
//
// One axis becomes operations — one per value — and the other rides on each
// cell: power as the cell's power scale, anything else as the cell's own
// operation settings. The operation axis is the row axis unless rows vary
// power, so a test never needs more than 20 operations (a project holds 256).
// Objects are listed lowest-risk first on both axes, and output follows that
// order, so an operator watching the first cells can stop a test that is
// already too strong. With speed rows and power columns the scene is the one
// ADR-044 generated, byte for byte.

import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type RasterImage,
  type Scene,
  type SceneObject,
} from '../scene';
import type { ObjectOperationSettingsOverride } from '../scene/scene-object';
import {
  CALIBRATION_LABEL_COLOR,
  createCalibrationLabelLayer,
  formatCalibrationNumber,
} from './calibration-labels';
import {
  clampMaterialTestInterval,
  clampMaterialTestPasses,
  clampMaterialTestPower,
  clampMaterialTestSpeed,
  effectiveMaterialTestSpeed,
  materialTestAxesIssue,
  materialTestAxisMaximum,
  materialTestAxisValues,
  materialTestImageLinesPerMm,
  materialTestRiskOrder,
  type MaterialTestAxis,
  type MaterialTestAxisValue,
  type MaterialTestBaseSettings,
  type MaterialTestMode,
  type MaterialTestParameter,
} from './material-test-axes';
import { materialTestColorAllocator } from './material-test-colors';
import {
  materialTestBorderObject,
  materialTestCellX,
  materialTestCellY,
  materialTestLabelObjects,
  materialTestLayout,
  materialTestRectangle,
  type MaterialTestLayout,
} from './material-test-grid-layout';
import { MATERIAL_TEST_RAMP } from './material-test-ramp';

export const MATERIAL_TEST_SOURCE = 'material-test-grid';
export const DEFAULT_MATERIAL_TEST_ID_PREFIX = 'material-test';
const OPERATION_COLOR_BASE = 0x100000;
const BORDER_COLOR_BASE = 0x300000;

export type MaterialTestAxesGridOptions = {
  readonly mode: MaterialTestMode;
  readonly rowAxis: MaterialTestAxis;
  readonly columnAxis: MaterialTestAxis;
  readonly base: MaterialTestBaseSettings;
  /** Active profile compile ceiling. Omit only for profile-agnostic callers. */
  readonly maxFeedMmPerMin?: number;
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
  readonly gapMm?: number;
  readonly origin?: { readonly x: number; readonly y: number };
  /** Burn value labels beside the rows and above the columns (default on). */
  readonly labels?: boolean;
  /** Burn a rectangle around the whole test (default off). */
  readonly border?: boolean;
  /** Prefix of every generated id; a second test in one project needs its own. */
  readonly idPrefix?: string;
  /** Layer and artwork colors the project already uses. */
  readonly reservedColors?: ReadonlySet<string>;
};

export type MaterialTestAxesCell = {
  readonly row: number;
  readonly column: number;
  readonly objectId: string;
  readonly layerId: string;
  /** Feed the compiler will emit for this cell. */
  readonly speed: number;
  readonly requestedSpeed: number;
  readonly effectiveSpeed: number;
  readonly power: number;
  readonly powerScale: number;
  readonly passes: number;
  /** Fill line interval or image scan-line interval; absent in Line mode. */
  readonly intervalMm?: number;
  readonly bounds: Bounds;
};

export type MaterialTestAxesGrid = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<MaterialTestAxesCell>;
};

type AxisKey = 'row' | 'column';

type AxisPlan = {
  readonly parameter: MaterialTestParameter;
  readonly values: ReadonlyArray<MaterialTestAxisValue>;
  readonly order: ReadonlyArray<number>;
};

type GridPlan = {
  readonly options: MaterialTestAxesGridOptions;
  readonly prefix: string;
  readonly row: AxisPlan;
  readonly column: AxisPlan;
  readonly layerAxis: AxisKey;
  readonly hasPowerAxis: boolean;
  /** Operation power; power-axis cells scale down from it. */
  readonly powerReference: number;
  readonly base: MaterialTestBaseSettings;
};

type CellSetting = {
  readonly power: number;
  readonly requestedSpeed: number;
  readonly effectiveSpeed: number;
  readonly passes: number;
  readonly intervalMm: number | undefined;
};

export function generateMaterialTestAxesGrid(
  options: MaterialTestAxesGridOptions,
): MaterialTestAxesGrid {
  const issue = materialTestAxesIssue(options.rowAxis, options.columnAxis, options.mode);
  if (issue !== null) throw new Error(issue);
  const plan = gridPlan(options);
  const layout = materialTestLayout(
    options,
    plan.row.values.map((value) => value.label),
    plan.column.values.map((value) => value.label),
  );
  const allocateColor = materialTestColorAllocator(options.reservedColors);
  const layers = operationLayers(plan, allocateColor);
  const { objects, cells } = cellObjects(plan, layout, layers);
  if (options.labels !== false) {
    const labelLayer = {
      ...createCalibrationLabelLayer(`${plan.prefix}-labels`),
      color: allocateColor(parseInt(CALIBRATION_LABEL_COLOR.slice(1), 16)),
    };
    objects.push(
      ...materialTestLabelObjects({
        prefix: plan.prefix,
        rowParameter: plan.row.parameter,
        columnParameter: plan.column.parameter,
        layout,
        labelLayer,
      }),
    );
    layers.push(labelLayer);
  }
  if (options.border === true) {
    const borderLayer = {
      ...createCalibrationLabelLayer(`${plan.prefix}-border`),
      name: 'Material test border',
      color: allocateColor(BORDER_COLOR_BASE),
    };
    objects.push(materialTestBorderObject(plan.prefix, objects, borderLayer));
    layers.push(borderLayer);
  }
  return { scene: { objects, layers }, cells };
}

function gridPlan(options: MaterialTestAxesGridOptions): GridPlan {
  const axisPlan = (axis: MaterialTestAxis): AxisPlan => {
    const values = materialTestAxisValues(axis, options.mode, options.maxFeedMmPerMin);
    return {
      parameter: axis.parameter,
      values,
      order: materialTestRiskOrder(axis.parameter, values),
    };
  };
  const powerAxis = [options.rowAxis, options.columnAxis].find(
    (axis) => axis.parameter === 'power',
  );
  const base = clampedBase(options.base, options.mode);
  return {
    options,
    prefix: options.idPrefix ?? DEFAULT_MATERIAL_TEST_ID_PREFIX,
    row: axisPlan(options.rowAxis),
    column: axisPlan(options.columnAxis),
    layerAxis: options.rowAxis.parameter === 'power' ? 'column' : 'row',
    hasPowerAxis: powerAxis !== undefined,
    powerReference: powerAxis === undefined ? base.power : materialTestAxisMaximum(powerAxis),
    base,
  };
}

function clampedBase(
  base: MaterialTestBaseSettings,
  mode: MaterialTestMode,
): MaterialTestBaseSettings {
  return {
    ...base,
    power: clampMaterialTestPower(base.power),
    speed: clampMaterialTestSpeed(base.speed),
    passes: clampMaterialTestPasses(base.passes),
    intervalMm: clampMaterialTestInterval(base.intervalMm, mode),
  };
}

// Settings for one operation value (`index` on the operation axis) or, with
// `column` given as well, for one cell. Parameters no axis varies use the base.
function settingFor(
  plan: GridPlan,
  pick: (parameter: MaterialTestParameter) => MaterialTestAxisValue | undefined,
): CellSetting {
  const speed = pick('speed');
  const requestedSpeed = speed?.requested ?? plan.base.speed;
  return {
    power: pick('power')?.requested ?? plan.powerReference,
    requestedSpeed,
    effectiveSpeed:
      speed?.effective ?? effectiveMaterialTestSpeed(requestedSpeed, plan.options.maxFeedMmPerMin),
    passes: pick('passes')?.requested ?? plan.base.passes,
    intervalMm:
      plan.options.mode === 'line'
        ? undefined
        : (pick('interval')?.requested ?? plan.base.intervalMm),
  };
}

function cellSetting(plan: GridPlan, row: number, column: number): CellSetting {
  return settingFor(plan, (parameter) => {
    if (plan.row.parameter === parameter) return plan.row.values[row];
    if (plan.column.parameter === parameter) return plan.column.values[column];
    return undefined;
  });
}

function operationLayers(plan: GridPlan, allocateColor: (base: number) => string): Layer[] {
  const axis = plan[plan.layerAxis];
  return axis.values.map((value, index) => {
    const setting = settingFor(plan, (parameter) =>
      parameter === axis.parameter ? value : undefined,
    );
    return operationLayer(plan, {
      id: `${plan.prefix}-${plan.layerAxis}-${index}`,
      name: `Material test ${operationValueName(axis.parameter, value)}`,
      color: allocateColor(OPERATION_COLOR_BASE + index),
      setting,
    });
  });
}

// Every key written here already exists on createLayer's output, so the key
// order — and with the default axes the JSON — matches the ADR-044 layers.
function operationLayer(
  plan: GridPlan,
  args: {
    readonly id: string;
    readonly name: string;
    readonly color: string;
    readonly setting: CellSetting;
  },
): Layer {
  const mode = plan.options.mode;
  const interval = args.setting.intervalMm;
  return {
    ...createLayer({ id: args.id, name: args.name, color: args.color, mode }),
    power: args.setting.power,
    speed: args.setting.requestedSpeed,
    passes: args.setting.passes,
    airAssist: plan.base.airAssist,
    ...(mode === 'fill' && interval !== undefined ? { hatchSpacingMm: interval } : {}),
    ...(mode === 'image' && interval !== undefined
      ? {
          ditherAlgorithm: plan.base.ditherAlgorithm,
          linesPerMm: materialTestImageLinesPerMm(interval),
        }
      : {}),
  };
}

function operationValueName(
  parameter: MaterialTestParameter,
  value: MaterialTestAxisValue,
): string {
  switch (parameter) {
    case 'speed':
      return (
        `${formatCalibrationNumber(value.requested)} requested / ` +
        `${formatCalibrationNumber(value.effective)} effective mm/min`
      );
    case 'passes':
      return `${value.label} ${value.requested === 1 ? 'pass' : 'passes'}`;
    case 'interval':
      return `${value.label} mm interval`;
    case 'power':
      return `${value.label}% power`;
    default:
      return parameter satisfies never;
  }
}

function cellObjects(
  plan: GridPlan,
  layout: MaterialTestLayout,
  layers: ReadonlyArray<Layer>,
): { objects: SceneObject[]; cells: MaterialTestAxesCell[] } {
  const objects: SceneObject[] = [];
  const cells: MaterialTestAxesCell[] = [];
  for (const { row, column } of burnOrder(plan)) {
    const layer = layers[plan.layerAxis === 'row' ? row : column];
    if (layer === undefined) continue;
    const setting = cellSetting(plan, row, column);
    const x = materialTestCellX(layout, column);
    const y = materialTestCellY(layout, row);
    const objectId = `${plan.prefix}-cell-r${row}-c${column}`;
    const powerScale = plan.powerReference > 0 ? (setting.power / plan.powerReference) * 100 : 100;
    objects.push(
      cellObject(plan, {
        id: objectId,
        layer,
        x,
        y,
        width: layout.cellWidth,
        height: layout.cellHeight,
        ...(plan.hasPowerAxis ? { powerScale } : {}),
        override: cellOverride(plan, setting),
      }),
    );
    cells.push({
      row,
      column,
      objectId,
      layerId: layer.id,
      speed: setting.effectiveSpeed,
      requestedSpeed: setting.requestedSpeed,
      effectiveSpeed: setting.effectiveSpeed,
      power: setting.power,
      powerScale: plan.hasPowerAxis ? powerScale : 100,
      passes: setting.passes,
      ...(setting.intervalMm === undefined ? {} : { intervalMm: setting.intervalMm }),
      bounds: { minX: x, minY: y, maxX: x + layout.cellWidth, maxY: y + layout.cellHeight },
    });
  }
  return { objects, cells };
}

// Operation values outermost, each operation's cells lowest-risk first inside:
// compile keeps an operation's cells together, so this is the output order.
function burnOrder(
  plan: GridPlan,
): ReadonlyArray<{ readonly row: number; readonly column: number }> {
  const outer = plan[plan.layerAxis].order;
  const inner = plan[plan.layerAxis === 'row' ? 'column' : 'row'].order;
  return outer.flatMap((a) =>
    inner.map((b) => (plan.layerAxis === 'row' ? { row: a, column: b } : { row: b, column: a })),
  );
}

// The per-cell axis when it is not power: an operation-owned override keeps
// the value on the cell while the operation stays shared (schema v5 scope).
function cellOverride(
  plan: GridPlan,
  setting: CellSetting,
): ObjectOperationSettingsOverride | undefined {
  const parameter = plan[plan.layerAxis === 'row' ? 'column' : 'row'].parameter;
  switch (parameter) {
    case 'power':
      return undefined;
    case 'speed':
      return { speed: setting.requestedSpeed };
    case 'passes':
      return { passes: setting.passes };
    case 'interval':
      if (setting.intervalMm === undefined) return undefined;
      return plan.options.mode === 'image'
        ? { linesPerMm: materialTestImageLinesPerMm(setting.intervalMm) }
        : { hatchSpacingMm: setting.intervalMm };
    default:
      return parameter satisfies never;
  }
}

type CellObjectArgs = {
  readonly id: string;
  readonly layer: Layer;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly powerScale?: number;
  readonly override: ObjectOperationSettingsOverride | undefined;
};

function cellObject(plan: GridPlan, args: CellObjectArgs): SceneObject {
  const extras = {
    ...(args.powerScale === undefined ? {} : { powerScale: args.powerScale }),
    ...(args.override === undefined
      ? {}
      : { operationOverride: { byOperation: { [args.layer.id]: args.override } } }),
  };
  const shared = {
    id: args.id,
    source: MATERIAL_TEST_SOURCE,
    operationIds: [args.layer.id],
    bounds: { minX: 0, minY: 0, maxX: args.width, maxY: args.height },
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
  };
  if (plan.options.mode !== 'image') {
    const square: ImportedSvg = {
      kind: 'imported-svg',
      ...shared,
      paths: [
        { color: args.layer.color, polylines: [materialTestRectangle(args.width, args.height)] },
      ],
      ...extras,
    };
    return square;
  }
  const image: RasterImage = {
    kind: 'raster-image',
    ...shared,
    dataUrl: MATERIAL_TEST_RAMP.dataUrl,
    pixelWidth: MATERIAL_TEST_RAMP.width,
    pixelHeight: MATERIAL_TEST_RAMP.height,
    color: args.layer.color,
    dither: args.layer.ditherAlgorithm,
    linesPerMm: args.override?.linesPerMm ?? args.layer.linesPerMm,
    lumaBase64: MATERIAL_TEST_RAMP.lumaBase64,
    ...extras,
  };
  return image;
}
