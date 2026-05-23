/**
 * SVG import must not turn non-rendering or unresolved clipped/masked artwork
 * into machine-output-capable scene objects.
 * Run: npx tsx tests/svg-renderability-and-clip-mask-safety.test.ts
 */
import { parseSvg } from '../src/import/svg/SvgParser';
import { importSvgToSceneWithReport } from '../src/import/svg/SvgToScene';

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

function importedIds(svg: string): string[] {
  return parseSvg(svg).elements.map(element => element.attrs.id).filter(Boolean);
}

console.log('\n=== SVG renderability and clip/mask safety ===\n');

{
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
    <g display="none">
      <line id="hidden-display-group" x1="0" y1="0" x2="120" y2="0" stroke="red" />
    </g>
    <g visibility="hidden">
      <path id="hidden-visibility-group" d="M0 10 L120 10" stroke="red" fill="none" />
    </g>
    <path id="transparent-opacity" d="M0 20 L120 20" stroke="red" fill="none" opacity="0" />
    <path id="transparent-stroke" d="M0 30 L120 30" stroke="red" fill="none" stroke-opacity="0" />
    <rect id="transparent-fill" x="0" y="40" width="120" height="10" stroke="none" fill="black" fill-opacity="0" />
    <line id="visible-control" x1="0" y1="60" x2="20" y2="60" stroke="red" />
  </svg>`;

  const ids = importedIds(svg);
  assert(!ids.includes('hidden-display-group'), 'display:none descendants do not import');
  assert(!ids.includes('hidden-visibility-group'), 'visibility:hidden descendants do not import');
  assert(!ids.includes('transparent-opacity'), 'opacity:0 geometry does not import');
  assert(!ids.includes('transparent-stroke'), 'stroke-opacity:0 with fill:none does not import');
  assert(!ids.includes('transparent-fill'), 'fill-opacity:0 with stroke:none does not import');
  assert(ids.includes('visible-control'), 'visible geometry still imports');

  const report = importSvgToSceneWithReport(svg, 'Renderability safety');
  assert(report.scene.objects.length === 1, 'only visible geometry becomes a scene object');
  assert(
    report.warnings.some(warning => warning.code === 'SVG_RENDERABILITY_SKIPPED'),
    'skipped non-rendering SVG geometry is reported',
  );
}

{
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
    <defs>
      <clipPath id="small"><rect x="0" y="0" width="10" height="10" /></clipPath>
      <mask id="fade"><rect x="0" y="0" width="10" height="10" /></mask>
    </defs>
    <path id="raw-clipped-long-line" d="M0 0 L1000 0" stroke="red" fill="none" clip-path="url(#small)" />
    <g mask="url(#fade)">
      <line id="raw-masked-long-line" x1="0" y1="20" x2="1000" y2="20" stroke="red" />
    </g>
    <line id="visible-control" x1="0" y1="60" x2="20" y2="60" stroke="red" />
  </svg>`;

  const parsed = parseSvg(svg);
  const ids = parsed.elements.map(element => element.attrs.id).filter(Boolean);
  assert(!ids.includes('raw-clipped-long-line'), 'clip-path affected raw geometry does not import');
  assert(!ids.includes('raw-masked-long-line'), 'mask affected raw geometry does not import');
  assert(ids.includes('visible-control'), 'unaffected geometry still imports');
  assert(parsed.warnings.some(warning => warning.feature === 'clipPath'), 'clipPath warning remains visible');
  assert(parsed.warnings.some(warning => warning.feature === 'mask'), 'mask warning remains visible');

  const report = importSvgToSceneWithReport(svg, 'Clip mask safety');
  assert(report.scene.objects.length === 1, 'unresolved clip/mask geometry cannot become scene output');
}

{
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
    <style>
      .css-hidden { display: none; }
      .css-invisible { visibility: hidden; }
      .css-transparent { opacity: 0; }
    </style>
    <line id="css-hidden-line" class="css-hidden" x1="0" y1="0" x2="120" y2="0" stroke="red" />
    <line id="css-invisible-line" class="css-invisible" x1="0" y1="10" x2="120" y2="10" stroke="red" />
    <line id="css-transparent-line" class="css-transparent" x1="0" y1="20" x2="120" y2="20" stroke="red" />
    <line id="visible-control" x1="0" y1="60" x2="20" y2="60" stroke="red" />
  </svg>`;

  const ids = importedIds(svg);
  assert(!ids.includes('css-hidden-line'), 'CSS display:none geometry does not import');
  assert(!ids.includes('css-invisible-line'), 'CSS visibility:hidden geometry does not import');
  assert(!ids.includes('css-transparent-line'), 'CSS opacity:0 geometry does not import');
  assert(ids.includes('visible-control'), 'visible geometry still imports after CSS renderability filtering');
}

{
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
    <line id="transparent-stroke-line" x1="0" y1="0" x2="120" y2="0" stroke="red" stroke-opacity="0" />
    <rect id="transparent-fill-rect" x="0" y="10" width="120" height="10" fill="black" fill-opacity="0" />
    <line id="visible-control" x1="0" y1="60" x2="20" y2="60" stroke="red" />
  </svg>`;

  const ids = importedIds(svg);
  assert(!ids.includes('transparent-stroke-line'), 'stroke-only transparent line does not import');
  assert(!ids.includes('transparent-fill-rect'), 'fill-only transparent rect does not import');
  assert(ids.includes('visible-control'), 'visible geometry still imports after transparent-paint filtering');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
