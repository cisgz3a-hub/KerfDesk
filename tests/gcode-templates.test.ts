/**
 * G-code template substitution tests.
 * Run: node node_modules/tsx/dist/cli.mjs tests/gcode-templates.test.ts
 */

import {
  renderTemplate,
  emptyTemplateContext,
  BUILT_IN_HEADER_TEMPLATES,
  BUILT_IN_FOOTER_TEMPLATES,
} from '../src/core/plan/GcodeTemplates';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== GcodeTemplates ===\n');

{
  assert(renderTemplate('', emptyTemplateContext()) === '', 'empty template returns empty');
}

{
  const ctx = { ...emptyTemplateContext(), jobName: 'My Project' };
  assert(renderTemplate('Job: {JOB_NAME}', ctx) === 'Job: My Project', 'single variable');
}

{
  const ctx = {
    ...emptyTemplateContext(),
    jobName: 'Test',
    bedWidthMm: 300,
    bedHeightMm: 300,
  };
  const out = renderTemplate('Job {JOB_NAME} on {BED_WIDTH}x{BED_HEIGHT}', ctx);
  assert(out === 'Job Test on 300x300', 'multiple variables');
}

{
  const out = renderTemplate('Test {UNKNOWN} var', emptyTemplateContext());
  assert(out === 'Test {UNKNOWN} var', 'unknown variables stay literal');
}

{
  const out = renderTemplate('{DATE} {TIME}', emptyTemplateContext());
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(out), 'date and time format');
}

{
  const ctx = { ...emptyTemplateContext(), bedWidthMm: 299.5 };
  assert(renderTemplate('{BED_WIDTH}', ctx) === '300', 'bed width rounds to integer');
}

{
  const ctx = { ...emptyTemplateContext(), materialThicknessMm: 3.175 };
  assert(renderTemplate('{MATERIAL_THICKNESS}mm', ctx) === '3.17mm', 'material thickness 2 decimals');
}

{
  const empty = renderTemplate('{MATERIAL_NAME}', emptyTemplateContext());
  const named = renderTemplate('{MATERIAL_NAME}', {
    ...emptyTemplateContext(),
    materialName: 'Baltic birch 3mm',
  });
  assert(empty === 'none', 'empty material falls back to none');
  assert(named === 'Baltic birch 3mm', 'material name uses provided string');
}

{
  const empty = renderTemplate('{ESTIMATED_TIME}', emptyTemplateContext());
  const withTime = renderTemplate('{ESTIMATED_TIME}', {
    ...emptyTemplateContext(),
    estimatedTime: '4:32',
  });
  assert(empty === 'unknown', 'empty estimated time falls back to unknown');
  assert(withTime === '4:32', 'estimated time uses provided string');
}

{
  const ctx = { ...emptyTemplateContext(), jobName: 'X' };
  assert(renderTemplate('{JOB_NAME} {JOB_NAME}', ctx) === 'X X', 'duplicate variable substitutions');
}

{
  const ctx = { ...emptyTemplateContext(), totalLines: 12345 };
  assert(renderTemplate('{TOTAL_LINES}', ctx) === '12345', 'total lines substitution');
}

{
  const ctx = {
    ...emptyTemplateContext(),
    returnX: 100,
    returnY: 75.25,
  };
  assert(
    renderTemplate('G0 X{RETURN_X} Y{RETURN_Y}', ctx) === 'G0 X100.000 Y75.250',
    'return coordinates three decimals',
  );
}

{
  const ctx = {
    ...emptyTemplateContext(),
    jobName: 'Test',
    bedWidthMm: 300,
    bedHeightMm: 300,
    maxSpeedMmPerMin: 6000,
    materialName: 'Plywood',
    materialThicknessMm: 3.0,
  };
  for (const [name, tpl] of Object.entries(BUILT_IN_HEADER_TEMPLATES)) {
    const rendered = renderTemplate(tpl, ctx);
    assert(!/\{[A-Z_]+\}/.test(rendered), `header template "${name}" resolves placeholders`);
  }
}

{
  const ctx = {
    ...emptyTemplateContext(),
    totalLines: 5000,
    estimatedTime: '4:32',
    bedWidthMm: 300,
    bedHeightMm: 300,
  };
  for (const [name, tpl] of Object.entries(BUILT_IN_FOOTER_TEMPLATES)) {
    const rendered = renderTemplate(tpl, ctx);
    assert(!/\{[A-Z_]+\}/.test(rendered), `footer template "${name}" resolves placeholders`);
  }
}

console.log(`\n=== Summary ===\nPassed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
