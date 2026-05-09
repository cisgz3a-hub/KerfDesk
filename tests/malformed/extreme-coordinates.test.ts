/**
 * T3-39: extreme and non-finite coordinate safety.
 *
 * Run: npx tsx tests/malformed/extreme-coordinates.test.ts
 */
import { createBlankProfile } from '../../src/core/devices/DeviceProfile';
import { PREFLIGHT_CODES, runPreflight, type PreflightContext } from '../../src/core/preflight/Preflight';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createRect } from '../../src/core/scene/SceneObject';
import type { RectGeometry } from '../../src/core/scene/SceneObject';
import { importSvgToSceneWithReport } from '../../src/import/svg/SvgToScene';

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

function hasNoNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value == null || typeof value !== 'object') return true;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (Array.isArray(value)) return value.every(hasNoNonFinite);
  return Object.values(value as Record<string, unknown>).every(hasNoNonFinite);
}

function makeCtx(scene: Scene): PreflightContext {
  const profile = createBlankProfile('T3-39 extreme');
  profile.bedWidth = 300;
  profile.bedHeight = 300;
  profile.maxSpindle = 1000;
  return {
    scene,
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
  };
}

console.log('\n=== T3-39 extreme coordinates ===\n');

{
  const report = importSvgToSceneWithReport(`
    <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm">
      <rect x="10000000000" y="0" width="5" height="5" fill="black"/>
    </svg>
  `);
  assert(report.scene.objects.length === 1, 'huge finite SVG coordinate imports as a scene object');
  assert(hasNoNonFinite(report.scene.objects[0]), 'huge finite SVG coordinate remains finite after import');
  const issues = runPreflight(makeCtx(report.scene));
  assert(
    issues.some(issue => issue.code === PREFLIGHT_CODES.DESIGN_OUTSIDE_BED && issue.severity === 'error'),
    'huge finite coordinate is blocked by bed/design preflight',
  );
}

{
  const scene = createScene(300, 300, 'manual NaN');
  const obj = createRect(scene.layers[0].id, 10, 10, 20, 20, 'NaN rect');
  (obj.geometry as RectGeometry).width = Number.NaN;
  scene.objects = [obj];
  const issues = runPreflight(makeCtx(scene));
  assert(
    issues.some(issue => issue.code === PREFLIGHT_CODES.GEOMETRY_NONFINITE && issue.severity === 'error'),
    'manual NaN geometry is blocked before compile/output',
  );
}

{
  const scene = createScene(300, 300, 'manual Infinity');
  const obj = createRect(scene.layers[0].id, 10, 10, 20, 20, 'Infinity transform');
  obj.transform.tx = Number.POSITIVE_INFINITY;
  scene.objects = [obj];
  const issues = runPreflight(makeCtx(scene));
  assert(
    issues.some(issue => issue.code === PREFLIGHT_CODES.GEOMETRY_NONFINITE && issue.severity === 'error'),
    'manual Infinity transform is blocked before compile/output',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
