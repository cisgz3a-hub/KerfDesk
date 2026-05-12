/**
 * T3-36: frame-vs-burn equivalence coverage.
 *
 * The frame path and burn path can each be correct in isolation but still
 * disagree when origin mode, machine origin corner, raster overscan, or
 * relative/current positioning changes. This test compiles representative
 * scenes, builds frame G-code from the same bounds the UI should pass to the
 * frame command, parses both streams semantically, and asserts the frame trace
 * covers the actual burned bounds.
 *
 * Run: npx tsx tests/frame-vs-burn-equivalence.test.ts
 */
import { readFileSync } from 'node:fs';
import { compileGcode } from '../src/app/PipelineService';
import {
  buildFrameCorners,
  buildFrameGcode,
  resolveFrameSceneBounds,
} from '../src/app/frameGcode';
import { createBlankProfile, type MachineOriginCorner } from '../src/core/devices/DeviceProfile';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import {
  createEllipse,
  createLine,
  createRect,
  type ImageGeometry,
  type SceneObject,
} from '../src/core/scene/SceneObject';
import type { GcodeStartMode } from '../src/core/output/GcodeOrigin';
import type { AABB } from '../src/core/types';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { computeOutputBounds } from '../src/geometry/bounds';
import { analyzeBurnBounds } from './helpers/analyzeBurnBounds';
import { parseGcode } from './helpers/parseGcode';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function boundsWidth(bounds: AABB): number {
  return bounds.maxX - bounds.minX;
}

function boundsHeight(bounds: AABB): number {
  return bounds.maxY - bounds.minY;
}

function isFiniteBounds(bounds: AABB): boolean {
  return (
    Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.maxY)
    && boundsWidth(bounds) >= 0
    && boundsHeight(bounds) >= 0
  );
}

function boundsClose(a: AABB, b: AABB, tolerance = 0.06): boolean {
  return (
    Math.abs(a.minX - b.minX) <= tolerance
    && Math.abs(a.minY - b.minY) <= tolerance
    && Math.abs(a.maxX - b.maxX) <= tolerance
    && Math.abs(a.maxY - b.maxY) <= tolerance
  );
}

function fmtBounds(bounds: AABB): string {
  return `(${bounds.minX.toFixed(3)}, ${bounds.minY.toFixed(3)})-(${bounds.maxX.toFixed(3)}, ${bounds.maxY.toFixed(3)})`;
}

function assertBoundsClose(actual: AABB, expected: AABB, message: string, tolerance = 0.06): void {
  assert(
    isFiniteBounds(actual) && isFiniteBounds(expected) && boundsClose(actual, expected, tolerance),
    `${message}; actual=${fmtBounds(actual)} expected=${fmtBounds(expected)} tol=${tolerance}`,
  );
}

type SceneType = 'rectangle' | 'circle' | 'multi-layer-mixed' | 'raster-with-overscan' | 'near-edge';

const ORIGIN_MODES: GcodeStartMode[] = ['absolute', 'current', 'savedOrigin'];
const ORIGIN_CORNERS: MachineOriginCorner[] = ['front-left', 'rear-left', 'front-right', 'rear-right'];
const SCENE_TYPES: SceneType[] = ['rectangle', 'circle', 'multi-layer-mixed', 'raster-with-overscan', 'near-edge'];

function makeScene(type: SceneType): Scene {
  switch (type) {
    case 'rectangle': {
      const scene = createScene(400, 300, 'T3-36 rectangle');
      scene.compileOptions = { optimizeOrder: false };
      scene.objects.push(createRect(scene.layers[0].id, 42, 31, 70, 44, 'frame-rect'));
      return scene;
    }

    case 'circle': {
      const scene = createScene(400, 300, 'T3-36 circle');
      scene.compileOptions = { optimizeOrder: false };
      scene.objects.push(createEllipse(scene.layers[0].id, 120, 90, 28, 18, 'frame-ellipse'));
      return scene;
    }

    case 'multi-layer-mixed': {
      const scene = createScene(400, 300, 'T3-36 mixed');
      scene.compileOptions = { optimizeOrder: false };
      const engrave = createLayer(0, 'engrave', 'Engrave');
      const score = createLayer(1, 'score', 'Score');
      const cut = createLayer(2, 'cut', 'Cut');
      engrave.settings.smartOverscanEnabled = false;
      engrave.settings.fill.overscanning = 0;
      engrave.settings.fill.interval = 2;
      scene.layers = [engrave, score, cut];
      scene.activeLayerId = cut.id;
      scene.objects.push(createRect(engrave.id, 65, 46, 34, 20, 'engrave-fill'));
      scene.objects.push(createLine(score.id, 55, 126, 142, 126, 'score-line'));
      scene.objects.push(createRect(cut.id, 35, 35, 130, 112, 'outer-cut'));
      return scene;
    }

    case 'raster-with-overscan': {
      const scene = createScene(400, 300, 'T3-36 raster');
      scene.compileOptions = { optimizeOrder: false };
      const layer = createLayer(0, 'image', 'Image');
      layer.settings.speed = 2400;
      layer.settings.power = { min: 0, max: 70 };
      layer.settings.image.imageMode = 'threshold';
      layer.settings.image.imageThreshold = 128;
      layer.settings.smartOverscanEnabled = false;
      layer.settings.fill.overscanning = 1.25;
      layer.settings.fill.biDirectional = true;
      scene.layers = [layer];
      scene.activeLayerId = layer.id;

      const width = 8;
      const height = 5;
      const data = new Uint8Array(width * height).fill(0);
      const geometry: ImageGeometry = {
        type: 'image',
        src: 'data:image/png;base64,t3-36',
        originalWidth: width,
        originalHeight: height,
        cropX: 0,
        cropY: 0,
        cropWidth: width,
        cropHeight: height,
        grayscaleData: data,
        grayscaleWidth: width,
        grayscaleHeight: height,
      };
      scene.objects.push({
        id: generateId(),
        type: 'image',
        name: 'overscan-raster',
        layerId: layer.id,
        parentId: null,
        transform: { ...IDENTITY_MATRIX, tx: 72, ty: 57 },
        geometry,
        visible: true,
        locked: false,
        powerScale: 1,
        _bounds: null,
        _worldTransform: null,
      } satisfies SceneObject);
      return scene;
    }

    case 'near-edge': {
      const scene = createScene(400, 300, 'T3-36 near edge');
      scene.compileOptions = { optimizeOrder: false };
      scene.objects.push(createRect(scene.layers[0].id, 358, 262, 34, 28, 'near-edge-cut'));
      return scene;
    }
  }
}

function makeProfile(originCorner: MachineOriginCorner) {
  const profile = createBlankProfile(`T3-36 ${originCorner}`);
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  profile.originCorner = originCorner;
  profile.maxSpindle = 1000;
  profile.returnToOrigin = false;
  profile.smartOverscanEnabled = false;
  return profile;
}

async function runMatrixCase(
  startMode: GcodeStartMode,
  originCorner: MachineOriginCorner,
  sceneType: SceneType,
): Promise<void> {
  const scene = makeScene(sceneType);
  const profile = makeProfile(originCorner);
  const savedOrigin = startMode === 'savedOrigin' ? { x: 87, y: 64 } : null;
  const compiled = await compileGcode(
    scene,
    startMode,
    savedOrigin,
    null,
    'grbl',
    null,
    null,
    profile,
  );
  assert(compiled !== null, `${startMode}/${originCorner}/${sceneType}: compile produced G-code`);
  if (!compiled) return;

  const outputBounds = computeOutputBounds(scene);
  const frameSourceBounds = resolveFrameSceneBounds({
    outputBounds,
    compiledCanvasBurnBounds: compiled.canvasBurnBounds ?? null,
    compiledCanvasPlanBounds: compiled.canvasPlanBounds,
    hasFreshCompile: true,
  });
  const frameCorners = buildFrameCorners(
    frameSourceBounds,
    {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: profile.bedHeight,
      bedWidthMm: profile.bedWidth,
    },
    compiled.canvasPlanBounds,
  );
  const frameGcode = buildFrameGcode(frameCorners, {
    startMode,
    laserMode: 'dot',
    maxSpindle: profile.maxSpindle,
  });

  const burnBounds = analyzeBurnBounds(parseGcode(compiled.gcode)).burnBounds;
  const frameBurnBounds = analyzeBurnBounds(parseGcode(frameGcode.join('\n'))).burnBounds;
  assertBoundsClose(
    frameBurnBounds,
    burnBounds,
    `${startMode}/${originCorner}/${sceneType}: frame-dot burn bounds match compiled burn bounds`,
    sceneType === 'circle' ? 0.3 : 0.06,
  );

  if (sceneType === 'raster-with-overscan') {
    assert(
      !boundsClose(outputBounds, compiled.canvasPlanBounds, 0.06),
      `${startMode}/${originCorner}/${sceneType}: fixture proves raw object bounds differ from compiled burn bounds`,
    );
  }
}

async function main(): Promise<void> {
  console.log('\n=== T3-36 frame-vs-burn equivalence ===\n');

  {
    const outputBounds = { minX: 10, minY: 20, maxX: 30, maxY: 40 };
    const compiledCanvasPlanBounds = { minX: 11, minY: 21, maxX: 29, maxY: 39 };
    assertBoundsClose(
      resolveFrameSceneBounds({ outputBounds, compiledCanvasBurnBounds: null, compiledCanvasPlanBounds, hasFreshCompile: true }),
      compiledCanvasPlanBounds,
      'fresh compile bounds win over raw output bounds',
      0.001,
    );
    const compiledCanvasBurnBounds = { minX: 12, minY: 22, maxX: 28, maxY: 38 };
    assertBoundsClose(
      resolveFrameSceneBounds({ outputBounds, compiledCanvasBurnBounds, compiledCanvasPlanBounds, hasFreshCompile: true }),
      compiledCanvasBurnBounds,
      'fresh burn bounds win over fresh plan bounds',
      0.001,
    );
    assertBoundsClose(
      resolveFrameSceneBounds({ outputBounds, compiledCanvasBurnBounds, compiledCanvasPlanBounds, hasFreshCompile: false }),
      outputBounds,
      'stale compile falls back to raw output bounds',
      0.001,
    );
  }

  for (const startMode of ORIGIN_MODES) {
    for (const originCorner of ORIGIN_CORNERS) {
      for (const sceneType of SCENE_TYPES) {
        await runMatrixCase(startMode, originCorner, sceneType);
      }
    }
  }

  {
    const appSource = readFileSync('src/ui/components/App.tsx', 'utf8');
    assert(
      appSource.includes('resolveFrameSceneBounds') && appSource.includes('lastResult.canvasBurnBounds'),
      'App frames from fresh compiled canvas burn bounds when available',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
