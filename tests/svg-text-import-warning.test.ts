/**
 * T3-27: SVG <text> import should warn instead of disappearing silently.
 * Run: npx tsx tests/svg-text-import-warning.test.ts
 */
import { readFileSync } from 'node:fs';
import { createScene } from '../src/core/scene/Scene';
import { parseSvg } from '../src/import/svg/SvgParser';
import {
  formatSvgImportWarnings,
  importSvgIntoScene,
  importSvgIntoSceneWithReport,
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

console.log('\n=== SVG text import warning ===\n');

const svgWithText = `
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
  <rect x="5" y="5" width="20" height="10" />
  <text x="10" y="30">Hello Laser</text>
  <g><text x="10" y="45">Second</text></g>
</svg>`;

{
  const parsed = parseSvg(svgWithText);
  assert(parsed.elements.length === 1, 'renderable geometry still imports');
  assert(parsed.warnings.length === 1, 'text skip warning is summarized once');
  const warning = parsed.warnings[0];
  assert(warning.code === 'SVG_TEXT_SKIPPED', 'warning code is SVG_TEXT_SKIPPED');
  assert(warning.count === 2, 'warning counts both text elements');
  assert(warning.examples?.includes('Hello Laser') === true, 'warning includes a text sample');
}

{
  const scene = createScene(100, 60, 'SVG text warning');
  const layerId = scene.layers[0].id;
  const report = importSvgIntoSceneWithReport(svgWithText, scene, layerId);
  assert(report.scene.objects.length === 1, 'report import keeps supported geometry');
  assert(report.warnings.length === 1, 'report import carries parser warning');
  const message = formatSvgImportWarnings(report.warnings);
  assert(message.includes('2 text elements skipped'), 'formatted warning names skipped text count');
  assert(message.includes('Convert text to outlines'), 'formatted warning gives user action');
}

{
  const scene = createScene(100, 60, 'Legacy SVG import');
  const layerId = scene.layers[0].id;
  const updated = importSvgIntoScene(svgWithText, scene, layerId);
  assert(updated.objects.length === 1, 'legacy importSvgIntoScene still returns a Scene');
}

{
  const toolbarSource = readFileSync('src/ui/components/FileToolbar.tsx', 'utf8');
  const useImportSource = readFileSync('src/ui/hooks/useImport.ts', 'utf8');
  const barrelSource = readFileSync('src/import/svg/index.ts', 'utf8');
  assert(toolbarSource.includes('importSvgIntoSceneWithReport'), 'FileToolbar uses the warning-report SVG import');
  assert(toolbarSource.includes('formatSvgImportWarnings'), 'FileToolbar formats SVG import warnings for users');
  assert(useImportSource.includes('importSvgIntoSceneWithReport'), 'drag/drop import uses the warning-report SVG import');
  assert(useImportSource.includes('formatSvgImportWarnings'), 'drag/drop import formats SVG import warnings for users');
  assert(barrelSource.includes('SvgImportWarning'), 'SVG barrel exports warning types');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
