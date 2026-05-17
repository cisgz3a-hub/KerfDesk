/**
 * T2-75: deep geometry/settings validation on load. Pre-T2-75 a
 * corrupted but still parseable JSON could load successfully and
 * crash later during compile/render/preflight — far from the load
 * site. Audit 4D Required Priority 9.
 *
 * Run: npx tsx tests/geometry-deep-validation.test.ts
 */
import {
  validateRectGeometry,
  validateEllipseGeometry,
  validateLineGeometry,
  validatePolygonGeometry,
  validateTextGeometry,
  validateImageGeometry,
  validateLayerSettings,
  applyValidationMode,
  GeometryValidationError,
} from '../src/io/validation/geometryValidation';
import { deserializeSceneWithReport } from '../src/io/SceneSerializer';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-75 Geometry deep validation ===\n');

void (async () => {

// 1. validateRectGeometry: clean rect → no issues
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: 100, height: 50, cornerRadius: 0 });
  assert(r.issues.length === 0, `clean rect: 0 issues (got ${r.issues.length})`);
  assert(r.value.width === 100 && r.value.height === 50, `values preserved`);
}

// 2. validateRectGeometry: NaN width → repaired to 1, issue raised
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: NaN, height: 50, cornerRadius: 0 });
  assert(r.issues.length === 1, `NaN width: 1 issue`);
  assert(r.issues[0].kind === 'invalid-rect-width', `kind='invalid-rect-width'`);
  assert(r.value.width === 1, `repaired width=1`);
  assert(r.value.height === 50, `valid height preserved`);
}

// 3. validateRectGeometry: negative dimensions repaired
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: -10, height: -5, cornerRadius: 0 });
  assert(r.issues.length === 2, `two issues (width + height)`);
  assert(r.value.width === 1 && r.value.height === 1, `both repaired to 1`);
}

// 4. validateRectGeometry: Infinity x → repaired
{
  const r = validateRectGeometry({ type: 'rect', x: Infinity, y: 5, width: 10, height: 10, cornerRadius: 0 });
  assert(r.issues.some((i) => i.kind === 'invalid-rect-position'),
    `Infinity x: position issue raised`);
  assert(r.value.x === 0, `repaired x=0`);
  assert(r.value.y === 5, `valid y preserved`);
}

// 5. validateRectGeometry: negative cornerRadius → repaired
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: 10, height: 10, cornerRadius: -2 });
  assert(r.issues.some((i) => i.kind === 'invalid-rect-corner-radius'),
    `negative cornerRadius issue raised`);
  assert(r.value.cornerRadius === 0, `repaired cornerRadius=0`);
}

// 6. validateEllipseGeometry: zero rx → repaired
{
  const r = validateEllipseGeometry({ type: 'ellipse', cx: 5, cy: 5, rx: 0, ry: 10 });
  assert(r.issues.some((i) => i.kind === 'invalid-ellipse-rx'),
    `rx=0: issue raised`);
  assert(r.value.rx === 1, `repaired rx=1`);
  assert(r.value.ry === 10, `valid ry preserved`);
}

// 7. validateEllipseGeometry: NaN center → repaired
{
  const r = validateEllipseGeometry({ type: 'ellipse', cx: NaN, cy: NaN, rx: 5, ry: 5 });
  assert(r.issues.some((i) => i.kind === 'invalid-ellipse-center'),
    `NaN center: issue raised`);
  assert(r.value.cx === 0 && r.value.cy === 0, `center repaired to (0,0)`);
}

// 8. validateLineGeometry: Infinity endpoint → repaired
{
  const r = validateLineGeometry({ type: 'line', x1: Infinity, y1: 0, x2: 100, y2: 0 });
  assert(r.issues.some((i) => i.kind === 'invalid-line-endpoint'),
    `Infinity x1: issue raised`);
  assert(r.value.x1 === 0, `repaired x1=0`);
  assert(r.value.x2 === 100, `valid x2 preserved`);
}

// 9. validatePolygonGeometry: empty points → defaulted to 2-point segment
{
  const r = validatePolygonGeometry({ type: 'polygon', points: [], closed: true });
  assert(r.issues.some((i) => i.kind === 'invalid-polygon-points'),
    `empty points: issue raised`);
  assert(r.value.points.length === 2, `defaulted to 2 points (got ${r.value.points.length})`);
}

// 10. validatePolygonGeometry: per-point NaN → individual repair
{
  const r = validatePolygonGeometry({
    type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: NaN, y: 5 }, { x: 10, y: 10 }],
    closed: false,
  });
  assert(r.issues.some((i) => i.kind === 'invalid-polygon-point-coordinate'),
    `NaN point: issue raised`);
  assert(r.value.points.length === 3, `point count preserved`);
  assert(r.value.points[1].x === 0 && r.value.points[1].y === 0,
    `bad point repaired to (0,0)`);
  assert(r.value.points[2].x === 10, `valid point preserved`);
}

// 11. validateTextGeometry: zero fontSize → repaired
{
  const r = validateTextGeometry({ type: 'text' as const, text: 'hi', fontSize: 0, fontFamily: 'sans' });
  assert(r.issues.some((i) => i.kind === 'invalid-text-fontsize'),
    `fontSize=0: issue raised`);
  assert(r.value.fontSize === 10, `repaired fontSize=10`);
}

// 12. validateTextGeometry: non-string text → repaired
{
  const r = validateTextGeometry({
    type: 'text' as const,
    text: 12 as unknown as string,
    fontSize: 10,
    fontFamily: 'sans',
  });
  assert(r.issues.some((i) => i.kind === 'invalid-text-empty'),
    `non-string text: issue raised`);
  assert(r.value.text === '', `repaired text=''`);
}

// 13. validateImageGeometry: zero originalWidth → repaired
{
  const r = validateImageGeometry({
    type: 'image' as const,
    originalWidth: 0, originalHeight: 0,
    cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100,
  });
  assert(r.issues.some((i) => i.kind === 'invalid-image-dimensions'),
    `zero originalWidth: issue raised`);
  assert(r.value.originalWidth === 1 && r.value.originalHeight === 1,
    `dimensions repaired to 1×1`);
}

// 14. validateImageGeometry: invalid crop → defaulted to full image
{
  const r = validateImageGeometry({
    type: 'image' as const,
    originalWidth: 100, originalHeight: 80,
    cropX: -1, cropY: 0, cropWidth: 200, cropHeight: 80,
  });
  assert(r.issues.some((i) => i.kind === 'invalid-image-crop'),
    `negative cropX: issue raised`);
  assert(r.value.cropX === 0 && r.value.cropY === 0
      && r.value.cropWidth === 100 && r.value.cropHeight === 80,
    `crop reset to full image`);
}

// 15. validateLayerSettings: invalid power → default 0..100
{
  const r = validateLayerSettings({ power: { min: 50, max: 10 } });
  assert(r.issues.some((i) => i.kind === 'invalid-layer-power'),
    `min > max: issue raised`);
  assert(r.value.power?.min === 0 && r.value.power?.max === 100,
    `power repaired to 0..100`);
}

// 16. validateLayerSettings: zero speed → default 1000
{
  const r = validateLayerSettings({ speed: 0 });
  assert(r.issues.some((i) => i.kind === 'invalid-layer-speed'),
    `speed=0: issue raised`);
  assert(r.value.speed === 1000, `speed repaired to 1000`);
}

// 17. validateLayerSettings: non-integer passes → default 1
{
  const r = validateLayerSettings({ passes: 2.5 });
  assert(r.issues.some((i) => i.kind === 'invalid-layer-passes'),
    `non-integer passes: issue raised`);
  assert(r.value.passes === 1, `passes repaired to 1`);
}

// 18. validateLayerSettings: negative fill interval → default 0.1
{
  const r = validateLayerSettings({ fill: { interval: -0.5 } });
  assert(r.issues.some((i) => i.kind === 'invalid-layer-fill-interval'),
    `negative fill interval: issue raised`);
  assert(r.value.fill?.interval === 0.1, `interval repaired to 0.1`);
}

// 19. validateLayerSettings: clean settings → 0 issues, exact values preserved
{
  const r = validateLayerSettings({
    power: { min: 10, max: 80 }, speed: 500, passes: 2, fill: { interval: 0.05 },
  });
  assert(r.issues.length === 0, `clean settings: 0 issues`);
  assert(r.value.power?.min === 10 && r.value.power?.max === 80, `power preserved`);
  assert(r.value.speed === 500, `speed preserved`);
  assert(r.value.passes === 2, `passes preserved`);
  assert(r.value.fill?.interval === 0.05, `fill interval preserved`);
}

// 20. applyValidationMode: 'strict' throws when issues present
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: -1, height: -1, cornerRadius: 0 });
  let caught: unknown = null;
  try { applyValidationMode(r, 'strict'); } catch (e) { caught = e; }
  assert(caught instanceof GeometryValidationError,
    `strict mode + issues: throws GeometryValidationError`);
  if (caught instanceof GeometryValidationError) {
    assert(caught.issues.length === 2,
      `error.issues populated (got ${caught.issues.length})`);
  }
}

// 21. applyValidationMode: 'strict' returns value when no issues
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 });
  const v = applyValidationMode(r, 'strict');
  assert(v.width === 10, `strict mode + 0 issues: returns value`);
}

// 22. applyValidationMode: 'auto-repair' returns repaired value
{
  const r = validateRectGeometry({ type: 'rect', x: 0, y: 0, width: -1, height: 10, cornerRadius: 0 });
  const v = applyValidationMode(r, 'auto-repair');
  assert(v.width === 1, `auto-repair: returns repaired value`);
}

// 23. Issue shape: every issue has kind / field / observed / message
{
  const r = validateRectGeometry({ type: 'rect', x: NaN, y: 0, width: -1, height: 0, cornerRadius: -1 });
  for (const issue of r.issues) {
    assert(typeof issue.kind === 'string' && issue.kind.length > 0,
      `issue.kind is non-empty string`);
    assert(typeof issue.field === 'string' && issue.field.length > 0,
      `issue.field is non-empty string`);
    assert(typeof issue.message === 'string' && issue.message.length > 0,
      `issue.message is non-empty string`);
  }
}

// 24. Project-load integration: finite invalid geometry/settings repaired and reported
{
  const project = {
    format: 'laserforge',
    version: '1.0',
    scene: {
      id: 'deep-validation-load',
      canvas: { width: 200, height: 100 },
      layers: [{
        id: 'layer-1',
        name: 'Bad layer',
        settings: {
          mode: 'cut',
          power: { min: 75, max: 25 },
          speed: 0,
          passes: 1.5,
          fill: { interval: -0.5 },
        },
      }],
      objects: [{
        id: 'bad-rect',
        type: 'rect',
        name: 'Bad rect',
        layerId: 'layer-1',
        geometry: { type: 'rect', x: 0, y: 0, width: -20, height: 0, cornerRadius: -1 },
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      }],
      activeLayerId: 'layer-1',
    },
  };
  const report = deserializeSceneWithReport(JSON.stringify(project));
  const rect = report.scene.objects[0].geometry;
  const settings = report.scene.layers[0].settings;
  assert(rect.type === 'rect' && rect.width === 1 && rect.height === 1 && rect.cornerRadius === 0,
    'project load repairs finite invalid rectangle geometry');
  assert(settings.power.min === 0 && settings.power.max === 100,
    'project load repairs invalid layer power range');
  assert(settings.speed === 1000 && settings.passes === 1 && settings.fill.interval === 0.1,
    'project load repairs invalid speed, passes, and fill interval');
  assert(report.repairs.some(r => r.kind === 'invalid-object-geometry-repaired'
    && /bad-rect/.test(r.details ?? '')
    && /geometry\.width/.test(r.details ?? '')
    && /geometry\.height/.test(r.details ?? '')
    && /geometry\.cornerRadius/.test(r.details ?? '')),
    'project load report identifies repaired geometry fields');
  assert(report.repairs.some(r => r.kind === 'invalid-layer-settings-repaired'
    && /layer-1/.test(r.details ?? '')
    && /settings\.power/.test(r.details ?? '')
    && /settings\.speed/.test(r.details ?? '')
    && /settings\.passes/.test(r.details ?? '')
    && /settings\.fill\.interval/.test(r.details ?? '')),
    'project load report identifies repaired layer setting fields');
}

// 25. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/io/validation/geometryValidation.ts'), 'utf-8');
  assert(/T2-75/.test(src), 'T2-75 marker in geometryValidation.ts');
  for (const id of [
    'validateRectGeometry', 'validateEllipseGeometry', 'validateLineGeometry',
    'validatePolygonGeometry', 'validateTextGeometry', 'validateImageGeometry',
    'validateLayerSettings', 'applyValidationMode', 'GeometryValidationError',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
