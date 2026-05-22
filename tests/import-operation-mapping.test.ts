/**
 * LF-EXT-K40-004: import-derived operation mapping must stay visible
 * and testable. K40-style color/layer conventions are useful only if
 * imported geometry lands on inspectable LaserForge operation layers.
 *
 * Run: npx tsx tests/import-operation-mapping.test.ts
 */
import { createScene, type Scene } from '../src/core/scene/Scene';
import { importSvgIntoSceneWithReport, importSvgToScene } from '../src/import/svg/SvgToScene';
import { importDxfIntoScene } from '../src/import/dxf';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function objectMode(scene: Scene, objectIndex: number): string | undefined {
  const object = scene.objects[objectIndex];
  return scene.layers.find(layer => layer.id === object?.layerId)?.settings.mode;
}

function layerModesByName(scene: Scene): Record<string, string> {
  return Object.fromEntries(scene.layers.map(layer => [layer.name, layer.settings.mode]));
}

const colorMappedSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <line id="red-cut" stroke="red" fill="none" x1="1" y1="1" x2="10" y2="1" />
  <line id="blue-engrave" stroke="blue" fill="none" x1="1" y1="6" x2="10" y2="6" />
  <line id="green-score" stroke="green" fill="none" x1="1" y1="11" x2="10" y2="11" />
  <rect id="black-fill" fill="black" x="1" y="16" width="8" height="4" />
</svg>`;

function lineEntity(layer: string, y: number): string[] {
  return [
    '0', 'LINE',
    '8', layer,
    '10', '0',
    '20', String(y),
    '11', '10',
    '21', String(y),
  ];
}

function operationLayerDxf(): string {
  return [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '4',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    ...lineEntity('Cut', 0),
    ...lineEntity('Engrave Fill', 5),
    ...lineEntity('Score Mark', 10),
    ...lineEntity('1', 15),
    ...lineEntity('2', 20),
    ...lineEntity('UnknownLayer', 25),
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

console.log('\n=== import operation mapping ===\n');

{
  const scene = importSvgToScene(colorMappedSvg, 'svg operation map');
  assert(scene.objects.length === 4, 'SVG color fixture imports all supported objects');
  assert(objectMode(scene, 0) === 'cut', 'red SVG stroke maps to cut layer');
  assert(objectMode(scene, 1) === 'engrave', 'blue SVG stroke maps to engrave layer');
  assert(objectMode(scene, 2) === 'score', 'green SVG stroke maps to score layer');
  assert(objectMode(scene, 3) === 'engrave', 'black SVG fill maps to engrave layer');
}

{
  const base = createScene(40, 40, 'existing scene');
  const activeLayerId = base.activeLayerId;
  const report = importSvgIntoSceneWithReport(colorMappedSvg, base, activeLayerId);
  assert(report.warnings.length === 0, 'color-mapped SVG import has no unsupported warnings');
  assert(objectMode(report.scene, 0) === 'cut', 'existing-scene import preserves red cut mapping');
  assert(objectMode(report.scene, 1) === 'engrave', 'existing-scene import preserves blue engrave mapping');
  assert(objectMode(report.scene, 2) === 'score', 'existing-scene import preserves green score mapping');
  assert(objectMode(report.scene, 3) === 'engrave', 'existing-scene import preserves black fill engrave mapping');
}

{
  const scene = importDxfIntoScene(operationLayerDxf(), createScene(100, 100, 'dxf operation map'));
  const modes = layerModesByName(scene);
  assert(scene.objects.length === 6, 'DXF operation fixture imports every line entity');
  assert(modes.Cut === 'cut', 'DXF Cut layer maps to cut');
  assert(modes['Engrave Fill'] === 'engrave', 'DXF engrave/fill layer maps to engrave');
  assert(modes['Score Mark'] === 'score', 'DXF score/mark layer maps to score');
  assert(modes['1'] === 'engrave', 'DXF numeric layer 1 maps to engrave');
  assert(modes['2'] === 'score', 'DXF numeric layer 2 maps to score');
  assert(modes.UnknownLayer === 'cut', 'unknown DXF layer defaults to cut for visible inspection');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
