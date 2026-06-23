import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildToolpath, compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { compareMasks } from './compare';
import { rasterizeGcodeBurn } from './gcode-rasterize';
import { writePerceptualArtifact } from './png';
import { rasterizePolylines } from './rasterize';
import { rasterizeToolpathBurn } from './toolpath-rasterize';

const BLACK = '#000000';
const MASK_SIZE_PX = 32;
const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: MASK_SIZE_PX,
  bedHeight: MASK_SIZE_PX,
  origin: 'rear-left',
} as const;

describe('rasterizeToolpathBurn', () => {
  it('turns compiled fill toolpath cuts into a source-comparable ink mask', () => {
    const contour = rectClosed(6, 6, 24, 24);
    const job = compileJob(sceneForFill([contour]), DEVICE);
    const toolpath = buildToolpath(job);

    const predicted = rasterizeToolpathBurn(toolpath, MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const emitted = rasterizeGcodeBurn(grblStrategy.emit(job, DEVICE), MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const truth = rasterizePolylines([contour], MASK_SIZE_PX, MASK_SIZE_PX);
    writePerceptualArtifact('fill-toolpath-solid-square', predicted, truth);
    writePerceptualArtifact('fill-gcode-solid-square', emitted, truth);
    const metrics = compareMasks(predicted, truth);
    const gcodeMetrics = compareMasks(emitted, truth);

    expect(metrics.iou).toBeGreaterThanOrEqual(0.9);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.9);
    expect(gcodeMetrics.iou).toBeGreaterThanOrEqual(0.9);
    expect(gcodeMetrics.recall).toBeGreaterThanOrEqual(0.9);
  });

  it('shows the hole in a compiled annulus fill artifact', () => {
    const outer = rectClosed(4, 4, 28, 28);
    const inner = rectClosed(12, 12, 20, 20);
    const job = compileJob(sceneForFill([outer, inner]), DEVICE);
    const toolpath = buildToolpath(job);

    const predicted = rasterizeToolpathBurn(toolpath, MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const emitted = rasterizeGcodeBurn(grblStrategy.emit(job, DEVICE), MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const truth = rasterizePolylines([outer, inner], MASK_SIZE_PX, MASK_SIZE_PX);
    writePerceptualArtifact('fill-toolpath-annulus', predicted, truth);
    writePerceptualArtifact('fill-gcode-annulus', emitted, truth);
    const metrics = compareMasks(predicted, truth);
    const gcodeMetrics = compareMasks(emitted, truth);

    expect(pixelAt(predicted, 16, 16)).toBe(0);
    expect(pixelAt(emitted, 16, 16)).toBe(0);
    expect(pixelAt(predicted, 8, 8)).toBe(1);
    expect(pixelAt(emitted, 8, 8)).toBe(1);
    expect(metrics.iou).toBeGreaterThanOrEqual(0.85);
    expect(gcodeMetrics.iou).toBeGreaterThanOrEqual(0.85);
  });

  it('renders emitted cross-hatch fill G-code as the same filled area', () => {
    const contour = rectClosed(8, 8, 24, 24);
    const job = compileJob(
      sceneForFill([contour], { fillBidirectional: true, fillCrossHatch: true, hatchSpacingMm: 2 }),
      DEVICE,
    );
    const toolpath = buildToolpath(job);

    const predicted = rasterizeToolpathBurn(toolpath, MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const emitted = rasterizeGcodeBurn(grblStrategy.emit(job, DEVICE), MASK_SIZE_PX, MASK_SIZE_PX, {
      burnWidthMm: 1,
    });
    const truth = rasterizePolylines([contour], MASK_SIZE_PX, MASK_SIZE_PX);
    writePerceptualArtifact('fill-toolpath-cross-hatch-square', predicted, truth);
    writePerceptualArtifact('fill-gcode-cross-hatch-square', emitted, truth);

    expect(compareMasks(predicted, truth).iou).toBeGreaterThanOrEqual(0.78);
    expect(compareMasks(emitted, truth).iou).toBeGreaterThanOrEqual(0.78);
  });
});

function sceneForFill(
  polylines: ReadonlyArray<Polyline>,
  layerOverrides: Partial<ReturnType<typeof createLayer>> = {},
): Scene {
  return {
    objects: [objectFor(polylines)],
    layers: [
      {
        ...createLayer({ id: BLACK, color: BLACK, mode: 'fill' }),
        hatchSpacingMm: 1,
        fillOverscanMm: 0,
        fillBidirectional: false,
        ...layerOverrides,
      },
    ],
  };
}

function objectFor(polylines: ReadonlyArray<Polyline>): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'fixture',
    source: 'fixture.svg',
    bounds: { minX: 0, minY: 0, maxX: MASK_SIZE_PX, maxY: MASK_SIZE_PX },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: BLACK, polylines }],
  };
}

function rectClosed(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

function pixelAt(
  mask: { readonly width: number; readonly data: Uint8Array },
  x: number,
  y: number,
): number {
  return mask.data[y * mask.width + x] ?? 0;
}
