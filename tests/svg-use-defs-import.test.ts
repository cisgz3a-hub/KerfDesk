/**
 * T3-30 Stage 1: SVG <use> should resolve <defs> geometry.
 * Run: npx tsx tests/svg-use-defs-import.test.ts
 */
import { parseSvg } from '../src/import/svg/SvgParser';
import { importSvgToScene } from '../src/import/svg/SvgToScene';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function objectMode(scene: ReturnType<typeof importSvgToScene>, objectIndex: number): string | undefined {
  const object = scene.objects[objectIndex];
  if (!object) return undefined;
  return scene.layers.find(layer => layer.id === object.layerId)?.settings.mode;
}

console.log('\n=== SVG <use> + <defs> import ===\n');

const symbolSvg = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100mm" height="60mm" viewBox="0 0 100 60">
  <defs>
    <path id="slash" d="M 0 0 L 10 10" />
    <g id="badge">
      <rect id="badge-box" x="0" y="0" width="8" height="6" />
      <line id="badge-line" x1="0" y1="3" x2="8" y2="3" />
    </g>
  </defs>
  <use href="#slash" x="10" y="20" stroke="blue" fill="none" />
  <use xlink:href="#slash" transform="translate(30 5)" stroke="red" fill="none" />
  <use href="#badge" x="50" y="10" stroke="green" fill="none" />
</svg>`;

{
  const parsed = parseSvg(symbolSvg);
  assert(parsed.elements.length === 4, 'defs geometry imports only through three use instances');
  assert(parsed.elements[0]?.attrs.id === 'slash', 'first use resolves referenced path');
  assert(parsed.elements[0]?.worldTransform.tx === 10, 'use x becomes translated X');
  assert(parsed.elements[0]?.worldTransform.ty === 20, 'use y becomes translated Y');
  assert(parsed.elements[1]?.attrs.id === 'slash', 'xlink:href use resolves referenced path');
  assert(parsed.elements[1]?.worldTransform.tx === 30, 'use transform translate applies to referenced path');
  assert(parsed.elements[1]?.worldTransform.ty === 5, 'use transform translate Y applies to referenced path');
  assert(parsed.elements[2]?.attrs.id === 'badge-box', 'use of group resolves first child');
  assert(parsed.elements[3]?.attrs.id === 'badge-line', 'use of group resolves second child');
  assert(parsed.elements[2]?.worldTransform.tx === 50, 'group use translation applies to child rect');
  assert(parsed.elements[3]?.computedStyle.stroke === 'green', 'use presentation style inherits into referenced group children');
}

{
  const scene = importSvgToScene(symbolSvg, 'Use defs import');
  assert(scene.objects.length === 4, 'scene imports four use-expanded objects');
  assert(objectMode(scene, 0) === 'engrave', 'blue use maps first referenced path to engrave');
  assert(objectMode(scene, 1) === 'cut', 'red xlink use maps second referenced path to cut');
  assert(objectMode(scene, 2) === 'score', 'green group use maps referenced child to score');
  assert(objectMode(scene, 3) === 'score', 'green group use maps all referenced children to score');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
