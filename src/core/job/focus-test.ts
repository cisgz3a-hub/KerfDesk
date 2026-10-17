import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import type { DeviceProfile } from '../devices';

/** Relative to the physical Z position at the start of each sample. */
export type FocusTestMotion = {
  readonly offsetMm: number;
  readonly travelFeedMmPerMin: number;
};

export type FocusTestOptions = {
  readonly steps: number;
  readonly minOffsetMm: number;
  readonly maxOffsetMm: number;
  readonly lineLengthMm: number;
  readonly spacingMm: number;
  readonly speed: number;
  readonly power: number;
  readonly travelFeedMmPerMin: number;
};

export function focusTestOptionsIssue(options: FocusTestOptions): string | null {
  if (Object.values(options).some((value) => !Number.isFinite(value)))
    return 'Enter finite numbers in every field.';
  if (!validSampleCount(options.steps)) return 'Samples must be a whole number from 2 to 101.';
  if (options.minOffsetMm >= options.maxOffsetMm)
    return 'Maximum Z offset must be greater than minimum Z offset.';
  if (Math.max(Math.abs(options.minOffsetMm), Math.abs(options.maxOffsetMm)) > 1000)
    return 'Z offsets must be within -1000 to 1000 mm.';
  const geometryIssue = focusGeometryIssue(options);
  if (geometryIssue !== null) return geometryIssue;
  if (options.speed <= 0 || options.travelFeedMmPerMin <= 0)
    return 'Cut and Z travel speeds must be greater than zero.';
  if (options.power < 0 || options.power > 100) return 'Power must be from 0 to 100 percent.';
  const offsets = focusTestOffsets(options);
  if (new Set(offsets).size !== options.steps)
    return 'Samples must have distinct Z offsets at 0.001 mm output precision.';
  return null;
}

function validSampleCount(steps: number): boolean {
  return Number.isInteger(steps) && steps >= 2 && steps <= 101;
}

function focusGeometryIssue(options: FocusTestOptions): string | null {
  return options.lineLengthMm < 1 ||
    options.lineLengthMm > 1000 ||
    options.spacingMm < 0.1 ||
    options.spacingMm > 100
    ? 'Line length must be 1–1000 mm and spacing 0.1–100 mm.'
    : null;
}

export function focusTestOffsets(
  options: Pick<FocusTestOptions, 'steps' | 'minOffsetMm' | 'maxOffsetMm'>,
): number[] {
  return Array.from({ length: options.steps }, (_, index) =>
    Number(
      (
        options.minOffsetMm +
        ((options.maxOffsetMm - options.minOffsetMm) * index) / (options.steps - 1)
      ).toFixed(3),
    ),
  );
}

export function generateFocusTest(options: FocusTestOptions): Scene {
  const issue = focusTestOptionsIssue(options);
  if (issue !== null) throw new Error(issue);
  const layers: Layer[] = [];
  const objects: ImportedSvg[] = [];
  for (const [index, offsetMm] of focusTestOffsets(options).entries()) {
    const id = `focus-test-${index + 1}`;
    const color = `#${(0x880000 + index * 0x100).toString(16).padStart(6, '0')}`;
    layers.push({
      ...createLayer({
        id,
        name: `Focus ${index + 1}: Z ${offsetMm.toFixed(3)} mm`,
        color,
        mode: 'line',
      }),
      speed: options.speed,
      power: options.power,
      focusTest: { offsetMm, travelFeedMmPerMin: options.travelFeedMmPerMin },
    });
    objects.push({
      kind: 'imported-svg',
      id: `${id}-line`,
      source: `focus-test:Z${offsetMm.toFixed(3)}mm`,
      operationIds: [id],
      bounds: { minX: 0, minY: 0, maxX: options.lineLengthMm, maxY: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 + index * options.spacingMm },
      paths: [
        {
          color,
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: options.lineLengthMm, y: 0 },
              ],
            },
          ],
        },
      ],
    });
  }
  return { layers, objects, groups: [] };
}

export function focusTestProfileIssue(device: DeviceProfile): string | null {
  const kind = device.controllerKind ?? 'grbl-v1.1';
  return kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc'
    ? null
    : 'Focus Test Z output currently supports GRBL, grblHAL and FluidNC only.';
}

export function focusTestWarnings(
  layers: ReadonlyArray<Pick<Layer, 'output' | 'focusTest'>>,
  device: DeviceProfile,
): string[] {
  const samples = layers.filter((layer) => layer.output && layer.focusTest !== undefined);
  if (samples.length === 0) return [];
  const offsets = samples.map((layer) => layer.focusTest?.offsetMm ?? 0);
  if (offsets.every((offset) => offset === 0))
    return [
      'The 2D estimate excludes Focus Test laser-off returns. Inspect G-code (3D) shows the exact emitted motion and its playback estimate. Sample labels are operation names, not engraved marks.',
    ];
  const warnings = [
    `Focus Test moves Z from ${Math.min(...offsets).toFixed(3)} to ${Math.max(...offsets).toFixed(3)} mm relative to starting focus. Positive Z follows the controller axis direction. Each completed sample returns to starting Z; an interrupted job may not. Frame traces XY only: verify material clearance and both Z directions. Physical focus and travel remain unqualified.`,
    'The 2D estimate excludes Focus Test Z travel and laser-off returns. Inspect G-code (3D) shows the exact emitted motion and its playback estimate. Sample labels are operation names, not engraved marks.',
  ];
  if (!device.capabilities?.includes('z-axis') || device.zTravelConfirmed !== true)
    warnings.push(
      'The profile does not confirm a controllable Z axis and usable travel. Check the machine before running Focus Test.',
    );
  if (
    device.zTravelMm !== undefined &&
    Math.max(0, ...offsets) - Math.min(0, ...offsets) > device.zTravelMm
  )
    warnings.push('The focus sweep span exceeds the configured Z travel.');
  return warnings;
}
