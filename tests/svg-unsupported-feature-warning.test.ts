/**
 * T3-30 Stage 1b: SVG features we still cannot apply should warn.
 * Run: npx tsx tests/svg-unsupported-feature-warning.test.ts
 */
import { parseSvg } from '../src/import/svg/SvgParser';
import { formatSvgImportWarnings } from '../src/import/svg/SvgToScene';

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

console.log('\n=== SVG unsupported feature warnings ===\n');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
  <defs>
    <clipPath id="clip"><rect x="0" y="0" width="20" height="20" /></clipPath>
    <mask id="fade"><rect x="0" y="0" width="20" height="20" /></mask>
    <style>.cut { stroke: red; fill: none; }</style>
  </defs>
  <rect x="0" y="0" width="40" height="40" clip-path="url(#clip)" />
  <circle class="cut" cx="50" cy="20" r="10" mask="url(#fade)" />
</svg>`;

const parsed = parseSvg(svg);
const codes = parsed.warnings.map(warning => warning.code);
const message = formatSvgImportWarnings(parsed.warnings);

assert(codes.includes('SVG_FEATURE_UNSUPPORTED'), 'unsupported feature warning code is emitted');
assert(message.includes('clipPath'), 'warning mentions clipPath is not applied');
assert(message.includes('mask'), 'warning mentions mask is not applied');
assert(message.includes('<style>'), 'warning mentions CSS style rules are not applied');
assert(parsed.elements.length === 2, 'supported visible geometry still imports');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
