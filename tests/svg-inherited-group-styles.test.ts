/**
 * T3-28: SVG group presentation styles must survive flattening.
 * Run: npx tsx tests/svg-inherited-group-styles.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { parseSvg } from '../src/import/svg/SvgParser';
import {
  importSvgIntoSceneWithReport,
  importSvgToScene,
} from '../src/import/svg/SvgToScene';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function objectMode(scene: ReturnType<typeof importSvgToScene>, objectIndex: number): string | undefined {
  const object = scene.objects[objectIndex];
  return scene.layers.find(layer => layer.id === object.layerId)?.settings.mode;
}

console.log('\n=== SVG inherited group styles ===\n');

const groupedSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
  <g stroke="blue" fill="none" stroke-width="0.25">
    <path id="engrave-from-group" d="M 5 5 L 20 5" />
    <path id="cut-local-override" stroke="red" d="M 5 15 L 20 15" />
  </g>
  <g style="stroke: green; fill: none;">
    <line id="score-from-style-group" x1="5" y1="25" x2="20" y2="25" />
  </g>
</svg>`;

{
  const parsed = parseSvg(groupedSvg);
  const inherited = parsed.elements.find(el => el.attrs.id === 'engrave-from-group');
  const override = parsed.elements.find(el => el.attrs.id === 'cut-local-override');
  const styledGroup = parsed.elements.find(el => el.attrs.id === 'score-from-style-group');

  assert(inherited?.computedStyle?.stroke === 'blue', 'group stroke is inherited onto child element');
  assert(inherited?.computedStyle?.fill === 'none', 'group fill none is inherited onto child element');
  assert(inherited?.computedStyle?.strokeWidth === '0.25', 'group stroke-width is inherited onto child element');
  assert(override?.computedStyle?.stroke === 'red', 'child presentation attribute overrides inherited stroke');
  assert(styledGroup?.computedStyle?.stroke === 'green', 'group inline style is inherited onto child element');
}

{
  const scene = importSvgToScene(groupedSvg, 'Inherited style import');
  assert(scene.objects.length === 3, 'all supported shapes import');
  assert(objectMode(scene, 0) === 'engrave', 'blue group stroke maps first object to engrave layer');
  assert(objectMode(scene, 1) === 'cut', 'local red stroke maps second object to cut layer');
  assert(objectMode(scene, 2) === 'score', 'green group style maps third object to score layer');
}

{
  const base = createScene(100, 60, 'Existing scene');
  const activeCutLayerId = base.layers[0].id;
  const report = importSvgIntoSceneWithReport(groupedSvg, base, activeCutLayerId);
  assert(report.scene.objects.length === 3, 'existing-scene import keeps all supported shapes');
  assert(objectMode(report.scene, 0) === 'engrave', 'inherited color overrides active cut layer for import-into-scene');
  assert(report.warnings.length === 0, 'inherited style import has no warnings');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
