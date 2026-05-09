/**
 * T3-39: malformed custom G-code templates are rejected.
 *
 * Run: npx tsx tests/malformed/bad-template.test.ts
 */
import {
  emptyTemplateContext,
} from '../../src/core/plan/GcodeTemplates';
import { validateGcodeTemplates } from '../../src/core/preflight/GcodeTemplateValidator';

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

function findingsFor(args: { customStart?: string; customEnd?: string; footerTemplate?: string }) {
  return validateGcodeTemplates({
    ...args,
    templateContext: emptyTemplateContext(),
    bedWidthMm: 300,
    bedHeightMm: 300,
    maxSpindle: 1000,
  });
}

console.log('\n=== T3-39 bad template ===\n');

{
  const findings = findingsFor({ customEnd: 'G0 X0 Y0', footerTemplate: '' });
  assert(findings.some(f => f.code === 'FOOTER_MISSING_M5' && f.severity === 'error'), 'custom end/footer without M5 is rejected');
}

{
  const findings = findingsFor({ customStart: '$X' });
  assert(findings.some(f => f.code === 'TEMPLATE_UNLOCK' && f.severity === 'error'), '$X unlock in template is rejected');
}

{
  const findings = findingsFor({ customStart: 'M4 S500' });
  assert(findings.some(f => f.code === 'TEMPLATE_LASER_ON_NO_MOTION' && f.severity === 'error'), 'laser-on template line is rejected');
}

{
  const findings = findingsFor({ customStart: 'G1 X9999 F1000' });
  assert(findings.some(f => f.code === 'TEMPLATE_MOTION_OUT_OF_BED' && f.severity === 'error'), 'template motion outside bed is rejected');
}

{
  const findings = findingsFor({ customStart: 'G1 X1 F0' });
  assert(findings.some(f => f.code === 'TEMPLATE_F_OUT_OF_RANGE' && f.severity === 'error'), 'template F0 is rejected');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
