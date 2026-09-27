// Holds the overlay shader's maths (through its CPU mirror) to the camera
// model itself (ADR-440): for any fragment, the texture coordinate sampled
// must be exactly where projectWorldPoint says the camera sees that bed point.

import { describe, expect, it } from 'vitest';
import {
  bedPoint,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
} from '../../../core/camera/model/camera-model';
import { surfaceHeightAt, type SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import { lookAt, overheadPose, wideLens } from '../../../core/camera/model/model-fixtures';
import { computeView } from '../../workspace/view-transform';
import {
  BED_OVERLAY_FRAGMENT_SHADER,
  BED_OVERLAY_FRAME_SAMPLER,
  BED_OVERLAY_UNIFORM_KINDS,
  BED_OVERLAY_VERTEX_SHADER,
  bedOverlayCompositeCoord,
  bedOverlayPasses,
  bedOverlaySampleCoord,
  bedOverlayUniforms,
  type BedOverlayTexCoord,
} from './bed-overlay-shader';

const CSS_WIDTH = 1200;
const CSS_HEIGHT = 800;
const DPR = 2;
const CANVAS_WIDTH = CSS_WIDTH * DPR;
const CANVAS_HEIGHT = CSS_HEIGHT * DPR;
const BED = 400;
const TOLERANCE = 1e-9;
const VIEW = computeView(CSS_WIDTH, CSS_HEIGHT, BED, BED, { zoomFactor: 1.7, panX: 30, panY: -12 });

function uniformsFor(lens: LensModel, pose: CameraPose, heightMm: number, opacity = 0.8) {
  return bedOverlayUniforms({
    lens,
    pose,
    surfaceHeightMm: heightMm,
    view: VIEW,
    canvasWidthPx: CANVAS_WIDTH,
    canvasHeightPx: CANVAS_HEIGHT,
    devicePixelRatio: DPR,
    bedWidthMm: BED,
    bedHeightMm: BED,
    opacity,
  });
}

// gl_FragCoord of the device pixel the workspace draws bed point (x, y) on:
// canvasPx = offset + mm * scale in CSS px, times dpr, with rows counted from
// the bottom of the backing store.
function fragmentOver(x: number, y: number): { fragX: number; fragY: number } {
  return {
    fragX: (VIEW.offsetX + x * VIEW.scale) * DPR,
    fragY: CANVAS_HEIGHT - (VIEW.offsetY + y * VIEW.scale) * DPR,
  };
}

// The inverse of fragmentOver.
function bedUnder(fragX: number, fragY: number): { x: number; y: number } {
  return {
    x: (fragX / DPR - VIEW.offsetX) / VIEW.scale,
    y: ((CANVAS_HEIGHT - fragY) / DPR - VIEW.offsetY) / VIEW.scale,
  };
}

function modelTexCoord(
  lens: LensModel,
  pose: CameraPose,
  x: number,
  y: number,
  heightMm: number,
): BedOverlayTexCoord | null {
  if (!(x >= 0 && x <= BED && y >= 0 && y <= BED)) return null;
  const pixel = projectWorldPoint(lens, pose, bedPoint(x, y, heightMm));
  if (pixel === null) return null;
  const u = (pixel.x + 0.5) / lens.imageWidth;
  const v = (pixel.y + 0.5) / lens.imageHeight;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
}

function expectSameCoord(actual: BedOverlayTexCoord | null, expected: BedOverlayTexCoord | null) {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(Math.abs((actual?.u ?? NaN) - expected.u)).toBeLessThan(TOLERANCE);
  expect(Math.abs((actual?.v ?? NaN) - expected.v)).toBeLessThan(TOLERANCE);
}

describe('bed overlay shader maths', () => {
  const lens = wideLens();
  const pose = overheadPose();

  it.each([0, 18])('samples where the camera model sees each bed point at %i mm', (height) => {
    const uniforms = uniformsFor(lens, pose, height);
    let sampled = 0;
    let discarded = 0;
    // Pixel centres across the whole backing store, off-bed margins included.
    for (let fragY = 0.5; fragY < CANVAS_HEIGHT; fragY += 37) {
      for (let fragX = 0.5; fragX < CANVAS_WIDTH; fragX += 41) {
        const bed = bedUnder(fragX, fragY);
        const expected = modelTexCoord(lens, pose, bed.x, bed.y, height);
        expectSameCoord(bedOverlaySampleCoord(uniforms, fragX, fragY), expected);
        if (expected === null) discarded += 1;
        else sampled += 1;
      }
    }
    // Guard against a vacuous pass: most of the bed is in view, and the left margin is not bed.
    expect(sampled).toBeGreaterThan(1500);
    expect(discarded).toBeGreaterThan(50);
  });

  it('puts a bed point drawn by the workspace on its camera pixel', () => {
    const uniforms = uniformsFor(lens, pose, 18);
    for (const [x, y] of [
      [123.4, 256.7],
      [20, 380],
      [390, 45],
    ] as const) {
      const { fragX, fragY } = fragmentOver(x, y);
      expectSameCoord(
        bedOverlaySampleCoord(uniforms, fragX, fragY),
        modelTexCoord(lens, pose, x, y, 18),
      );
    }
  });

  it('models parallax: a raised surface samples a different camera pixel', () => {
    const { fragX, fragY } = fragmentOver(300, 300);
    const onBed = bedOverlaySampleCoord(uniformsFor(lens, pose, 0), fragX, fragY);
    const raised = bedOverlaySampleCoord(uniformsFor(lens, pose, 18), fragX, fragY);
    expect(onBed).not.toBeNull();
    expect(raised).not.toBeNull();
    expect(Math.abs((onBed?.v ?? 0) - (raised?.v ?? 0)) * lens.imageHeight).toBeGreaterThan(5);
  });

  it('samples the principal point on the optical axis', () => {
    const straightDown = lookAt([200, 200, -300], [200, 200, 0]);
    const { fragX, fragY } = fragmentOver(200, 200);
    expectSameCoord(bedOverlaySampleCoord(uniformsFor(lens, straightDown, 0), fragX, fragY), {
      u: (lens.intrinsics.cx + 0.5) / lens.imageWidth,
      v: (lens.intrinsics.cy + 0.5) / lens.imageHeight,
    });
  });

  it('discards fragments off the bed', () => {
    const uniforms = uniformsFor(lens, pose, 0);
    for (const [x, y] of [
      [-0.5, 200],
      [400.5, 200],
      [200, -0.5],
      [200, 400.5],
    ] as const) {
      const { fragX, fragY } = fragmentOver(x, y);
      expect(bedOverlaySampleCoord(uniforms, fragX, fragY)).toBeNull();
    }
  });

  it('discards points behind the camera', () => {
    const lookingUp = lookAt([200, 200, -100], [200, 200, -400]);
    const { fragX, fragY } = fragmentOver(200, 200);
    expect(projectWorldPoint(lens, lookingUp, bedPoint(200, 200))).toBeNull();
    expect(bedOverlaySampleCoord(uniformsFor(lens, lookingUp, 0), fragX, fragY)).toBeNull();
  });

  it('discards points in front of the camera but outside its frame', () => {
    // Low over the bed's origin corner, the far corner is ~75° off-axis: in
    // front of the lens but beyond its ~65° half field of view.
    const lowOverCorner = lookAt([0, 0, -150], [0, 0, 0]);
    const pixel = projectWorldPoint(lens, lowOverCorner, bedPoint(400, 400));
    expect(pixel).not.toBeNull();
    expect((pixel?.x ?? 0) > lens.imageWidth || (pixel?.y ?? 0) > lens.imageHeight).toBe(true);
    const { fragX, fragY } = fragmentOver(400, 400);
    expect(bedOverlaySampleCoord(uniformsFor(lens, lowOverCorner, 0), fragX, fragY)).toBeNull();
  });

  it('clamps opacity and sanitises the canvas inputs', () => {
    expect(uniformsFor(lens, pose, 0, 1.5).uOpacity).toBe(1);
    expect(uniformsFor(lens, pose, 0, -0.2).uOpacity).toBe(0);
    expect(uniformsFor(lens, pose, 0, Number.NaN).uOpacity).toBe(0);
    const odd = bedOverlayUniforms({
      lens,
      pose,
      surfaceHeightMm: 0,
      view: VIEW,
      canvasWidthPx: 1000.4,
      canvasHeightPx: Number.NaN,
      devicePixelRatio: 0,
      bedWidthMm: BED,
      bedHeightMm: BED,
      opacity: 1,
    });
    expect(odd.uCanvasSize).toEqual([1000, 1]);
    expect(odd.uPixelRatio).toBe(1);
  });
});

describe('bed overlay height-area passes', () => {
  const lens = wideLens();
  const pose = overheadPose();
  const areas: ReadonlyArray<SurfaceHeightArea> = [
    { id: 'lid', x: 150, y: 150, width: 150, height: 150, surfaceHeightMm: 25 },
    { id: 'box', x: 60, y: 60, width: 140, height: 120, surfaceHeightMm: 40 },
    { id: 'hole', x: 320, y: 40, width: 50, height: 50, surfaceHeightMm: 0 },
    { id: 'off-bed', x: 450, y: 20, width: 40, height: 40, surfaceHeightMm: 10 },
  ];

  function passesFor(heightAreas: ReadonlyArray<SurfaceHeightArea>, baseMm = 3) {
    return bedOverlayPasses({
      lens,
      pose,
      surfaceHeightMm: baseMm,
      heightAreas,
      view: VIEW,
      canvasWidthPx: CANVAS_WIDTH,
      canvasHeightPx: CANVAS_HEIGHT,
      devicePixelRatio: DPR,
      bedWidthMm: BED,
      bedHeightMm: BED,
      opacity: 0.8,
    });
  }

  it('shows every bed point at the height surfaceHeightAt picks for it', () => {
    const passes = passesFor(areas);
    const seen = new Map<number, number>();
    for (let fragY = 0.5; fragY < CANVAS_HEIGHT; fragY += 29) {
      for (let fragX = 0.5; fragX < CANVAS_WIDTH; fragX += 31) {
        const bed = bedUnder(fragX, fragY);
        const height = surfaceHeightAt(areas, bed.x, bed.y, 3);
        const expected = modelTexCoord(lens, pose, bed.x, bed.y, height);
        expectSameCoord(bedOverlayCompositeCoord(passes, fragX, fragY), expected);
        if (expected !== null) seen.set(height, (seen.get(height) ?? 0) + 1);
      }
    }
    // Every height, the overlap included, was really drawn.
    for (const height of [0, 3, 25, 40]) expect(seen.get(height) ?? 0).toBeGreaterThan(5);
  });

  it('paints the lowest area first and leaves out areas that miss the bed', () => {
    const passes = passesFor(areas);
    expect(passes.map((pass) => pass.uSurfaceZ)).toEqual(
      [3, 0, 25, 40].map((height) => bedPoint(0, 0, height).z),
    );
    expect(passes[0]?.uClip).toEqual([0, 0, BED, BED]);
    expect(passes[3]?.uClip).toEqual([60, 60, 200, 180]);
  });

  it('cuts an area that hangs off the bed to the bed', () => {
    const passes = passesFor([
      { id: 'edge', x: 380, y: -10, width: 50, height: 30, surfaceHeightMm: 8 },
    ]);
    expect(passes[1]?.uClip).toEqual([380, 0, BED, 20]);
  });

  it('draws nothing in an area where the camera cannot see, rather than the material below', () => {
    // Low over the origin corner, this camera sees the near half of the bed only.
    const lowOverCorner = lookAt([0, 0, -150], [0, 0, 0]);
    const far: SurfaceHeightArea = {
      id: 'far',
      x: 0,
      y: 0,
      width: BED,
      height: BED,
      surfaceHeightMm: 0,
    };
    const passes = bedOverlayPasses({
      lens,
      pose: lowOverCorner,
      surfaceHeightMm: 0,
      heightAreas: [far],
      view: VIEW,
      canvasWidthPx: CANVAS_WIDTH,
      canvasHeightPx: CANVAS_HEIGHT,
      devicePixelRatio: DPR,
      bedWidthMm: BED,
      bedHeightMm: BED,
      opacity: 1,
    });
    const { fragX, fragY } = fragmentOver(400, 400);
    expect(bedOverlayCompositeCoord(passes, fragX, fragY)).toBeNull();
  });
});

describe('bed overlay shader source', () => {
  const uniforms = uniformsFor(wideLens(), overheadPose(), 0);

  it('starts both stages with the GLSL ES 3.00 version line', () => {
    // Anything before #version, even a newline, is a compile error.
    expect(BED_OVERLAY_VERTEX_SHADER.startsWith('#version 300 es\n')).toBe(true);
    expect(BED_OVERLAY_FRAGMENT_SHADER.startsWith('#version 300 es\n')).toBe(true);
  });

  it('declares every packed uniform with the type the renderer uploads', () => {
    expect(Object.keys(uniforms).sort()).toEqual(Object.keys(BED_OVERLAY_UNIFORM_KINDS).sort());
    for (const [name, kind] of Object.entries(BED_OVERLAY_UNIFORM_KINDS)) {
      expect(BED_OVERLAY_FRAGMENT_SHADER).toMatch(new RegExp(`\\buniform ${kind} ${name};`));
    }
  });

  it('declares nothing the packer does not supply', () => {
    const declared = [...BED_OVERLAY_FRAGMENT_SHADER.matchAll(/\buniform \w+ (\w+);/g)].map(
      (match) => match[1],
    );
    expect(declared.sort()).toEqual([...Object.keys(uniforms), BED_OVERLAY_FRAME_SAMPLER].sort());
  });
});
