/**
 * GcodeTemplateValidator — semantic rules for custom G-code and templates.
 * Run: npx tsx tests/gcode-template-validator.test.ts
 */
import {
  buildPreflightTemplateContext,
  validateGcodeTemplates,
} from '../src/core/preflight/GcodeTemplateValidator';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  emptyTemplateContext,
} from '../src/core/plan/GcodeTemplates';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function codes(findings: { code: string }[]): Set<string> {
  return new Set(findings.map(f => f.code));
}

function baseInput(overrides: Partial<Parameters<typeof validateGcodeTemplates>[0]> = {}) {
  const ctx = { ...emptyTemplateContext(), bedWidthMm: 200, bedHeightMm: 200, maxSpeedMmPerMin: 3000 };
  return {
    templateContext: ctx,
    bedWidthMm: 200,
    bedHeightMm: 200,
    maxSpindle: 1000,
    ...overrides,
  } as Parameters<typeof validateGcodeTemplates>[0];
}

console.log('\n=== gcode-template-validator ===\n');

{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$X' }));
  assert(codes(f).has('TEMPLATE_UNLOCK'), 'TEMPLATE_UNLOCK');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$RST=*' }));
  assert(codes(f).has('TEMPLATE_EEPROM_RESET'), 'TEMPLATE_EEPROM_RESET $RST=*');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$RST=#' }));
  assert(codes(f).has('TEMPLATE_EEPROM_RESET'), 'TEMPLATE_EEPROM_RESET $RST=#');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$RST=$' }));
  assert(codes(f).has('TEMPLATE_EEPROM_RESET'), 'TEMPLATE_EEPROM_RESET $RST=$');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$SLP' }));
  assert(codes(f).has('TEMPLATE_SLEEP'), 'TEMPLATE_SLEEP');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$10=0' }));
  assert(codes(f).has('TEMPLATE_DOLLAR_WRITE'), 'TEMPLATE_DOLLAR_WRITE');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'M3 S500' }));
  assert(codes(f).has('TEMPLATE_LASER_ON_NO_MOTION'), 'TEMPLATE_LASER_ON_NO_MOTION M3 S500');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G91' }));
  assert(codes(f).has('TEMPLATE_G91_IN_HEADER'), 'TEMPLATE_G91_IN_HEADER');
}
{
  const f = validateGcodeTemplates(baseInput({ footerTemplate: 'G91' }));
  assert(!codes(f).has('TEMPLATE_G91_IN_HEADER'), 'G91 in footer is not TEMPLATE_G91_IN_HEADER');
}
{
  const f = validateGcodeTemplates(baseInput({ customStart: 'G91' }));
  assert(codes(f).has('TEMPLATE_G91_IN_HEADER'), 'T1-43 TEMPLATE_G91_IN_HEADER fires for customStart');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G90' }));
  assert(codes(f).has('TEMPLATE_G90_IN_HEADER'), 'T1-43 TEMPLATE_G90_IN_HEADER for G90 in header');
}
{
  const f = validateGcodeTemplates(baseInput({ customStart: 'G90' }));
  assert(codes(f).has('TEMPLATE_G90_IN_HEADER'), 'T1-43 TEMPLATE_G90_IN_HEADER for G90 in customStart');
}
{
  const f = validateGcodeTemplates(baseInput({ footerTemplate: 'G90' }));
  assert(!codes(f).has('TEMPLATE_G90_IN_HEADER'), 'T1-43 G90 in footer not flagged');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'g92 X0' }));
  assert(codes(f).has('TEMPLATE_G92'), 'TEMPLATE_G92 lowercase g92');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G10 L2 P1 X0 Y0' }));
  assert(codes(f).has('TEMPLATE_G10'), 'TEMPLATE_G10');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G0 X250' }));
  assert(codes(f).has('TEMPLATE_MOTION_OUT_OF_BED'), 'TEMPLATE_MOTION_OUT_OF_BED X above bed');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G0 Y250' }));
  assert(codes(f).has('TEMPLATE_MOTION_OUT_OF_BED'), 'TEMPLATE_MOTION_OUT_OF_BED Y above bed');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G0 X-0.05' }));
  assert(codes(f).has('TEMPLATE_MOTION_OUT_OF_BED'), 'TEMPLATE_MOTION_OUT_OF_BED negative X');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'M5\nG1 X10 S2000' }));
  assert(codes(f).has('TEMPLATE_S_EXCEEDS_MAX_SPINDLE'), 'TEMPLATE_S_EXCEEDS_MAX_SPINDLE');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G0 X10 F0.5' }));
  assert(codes(f).has('TEMPLATE_F_OUT_OF_RANGE'), 'TEMPLATE_F_OUT_OF_RANGE F<1');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'G0 X10 F200000' }));
  assert(codes(f).has('TEMPLATE_F_OUT_OF_RANGE'), 'TEMPLATE_F_OUT_OF_RANGE F>100000');
}
{
  const f = validateGcodeTemplates(baseInput({ customStart: 'G0 X1' }));
  assert(codes(f).has('TEMPLATE_CUSTOM_HAS_MOTION'), 'TEMPLATE_CUSTOM_HAS_MOTION customStart');
}
{
  const f = validateGcodeTemplates(baseInput({ customEnd: 'G1 Y1' }));
  assert(codes(f).has('TEMPLATE_CUSTOM_HAS_MOTION'), 'TEMPLATE_CUSTOM_HAS_MOTION customEnd');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: '$C' }));
  assert(codes(f).has('TEMPLATE_UNKNOWN_DOLLAR'), 'TEMPLATE_UNKNOWN_DOLLAR');
}
{
  const f = validateGcodeTemplates(baseInput({ customEnd: 'G0 X0', footerTemplate: '' }));
  assert(codes(f).has('FOOTER_MISSING_M5'), 'FOOTER_MISSING_M5 when tail lacks M5');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'M3' }));
  assert(codes(f).has('TEMPLATE_LASER_ON_NO_MOTION'), 'M3 alone triggers TEMPLATE_LASER_ON_NO_MOTION');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'M3 S0' }));
  assert(!codes(f).has('TEMPLATE_LASER_ON_NO_MOTION'), 'M3 S0 does not trigger laser-on error');
}
{
  const f = validateGcodeTemplates(baseInput({ headerTemplate: 'M4 s100' }));
  assert(codes(f).has('TEMPLATE_LASER_ON_NO_MOTION'), 'm4 s100 case-insensitive');
}

// Trusted built-ins: no findings
for (const [name, body] of Object.entries(BUILT_IN_HEADER_TEMPLATES)) {
  const f = validateGcodeTemplates(baseInput({ headerTemplate: body }));
  assert(f.length === 0, `trusted header "${name}" produces no findings`);
}
for (const [name, body] of Object.entries(BUILT_IN_FOOTER_TEMPLATES)) {
  const f = validateGcodeTemplates(baseInput({ footerTemplate: body }));
  const extra = f.filter(x => x.code !== 'FOOTER_MISSING_M5');
  assert(extra.length === 0, `trusted footer "${name}" produces no findings (except M5 tail rule)`);
  assert(!codes(f).has('FOOTER_MISSING_M5'), `trusted footer "${name}" includes M5 in combined check path`);
}

// User-edited copy of built-in: trust chain broken
{
  const tampered = `${BUILT_IN_HEADER_TEMPLATES['GRBL (generic)']}\n$X`;
  const f = validateGcodeTemplates(baseInput({ headerTemplate: tampered }));
  assert(codes(f).has('TEMPLATE_UNLOCK'), 'modified built-in header is validated');
}

// Rendered placeholder stays in bed
{
  const f = validateGcodeTemplates(
    baseInput({
      footerTemplate: 'M5\nG0 X{BED_WIDTH_MINUS_5} Y0',
      templateContext: { ...emptyTemplateContext(), bedWidthMm: 200, bedHeightMm: 200 },
    }),
  );
  assert(!codes(f).has('TEMPLATE_MOTION_OUT_OF_BED'), 'BED_WIDTH_MINUS_5 resolves inside bed');
}

{
  const f = validateGcodeTemplates(baseInput({ footerTemplate: 'M5\nG0 X9999 Y0' }));
  assert(codes(f).has('TEMPLATE_MOTION_OUT_OF_BED'), 'literal G0 X9999 after render');
}

// buildPreflightTemplateContext smoke
{
  const s0 = createScene(200, 200, 'V');
  const s = addObject(s0, createRect(s0.layers[0].id, 0, 0, 10, 10));
  const ctx = buildPreflightTemplateContext(s, 200, 200);
  assert(ctx.bedWidthMm === 200 && ctx.jobName !== '', 'buildPreflightTemplateContext fills bed + job');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
