/**
 * T3-2 case 2: template safety enforcement for dangerous user-supplied
 * G-code surfaces.
 * Run: npx tsx tests/template-safety-enforcement.test.ts
 */
import {
  emptyTemplateContext,
} from '../src/core/plan/GcodeTemplates';
import {
  validateGcodeTemplates,
  type TemplateFinding,
  type TemplateValidationInput,
} from '../src/core/preflight/GcodeTemplateValidator';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function baseInput(overrides: Partial<TemplateValidationInput> = {}): TemplateValidationInput {
  return {
    templateContext: {
      ...emptyTemplateContext(),
      bedWidthMm: 200,
      bedHeightMm: 200,
      maxSpeedMmPerMin: 3000,
    },
    bedWidthMm: 200,
    bedHeightMm: 200,
    maxSpindle: 1000,
    ...overrides,
  };
}

function assertRejected(
  label: string,
  input: Partial<TemplateValidationInput>,
  code: string,
): void {
  const findings = validateGcodeTemplates(baseInput(input));
  const matching = findings.filter(f => f.code === code);
  assert(
    matching.some(f => f.severity === 'error'),
    `${label} rejects with ${code}`,
  );
  assert(
    findings.every(isActionableFinding),
    `${label} findings carry source, line, and message`,
  );
}

function isActionableFinding(finding: TemplateFinding): boolean {
  return (
    finding.source.length > 0 &&
    finding.code.length > 0 &&
    finding.message.length > 0 &&
    Number.isInteger(finding.lineNumber)
  );
}

console.log('\n=== template-safety-enforcement ===\n');

assertRejected(
  'custom start with relative mode',
  { customStart: 'G91' },
  'TEMPLATE_G91_IN_HEADER',
);

assertRejected(
  'custom start with embedded relative mode',
  { customStart: 'G0 X0 G91' },
  'TEMPLATE_G91_IN_HEADER',
);

assertRejected(
  'custom start with laser-on command',
  { customStart: 'M3 S1000' },
  'TEMPLATE_LASER_ON_NO_MOTION',
);

assertRejected(
  'custom start with embedded laser-on command',
  { customStart: 'G0 X0 M3 S1000' },
  'TEMPLATE_LASER_ON_NO_MOTION',
);

assertRejected(
  'footer omitting laser-off',
  { footerTemplate: 'G0 X0 Y0' },
  'FOOTER_MISSING_M5',
);

assertRejected(
  'footer with work-coordinate mutation',
  { footerTemplate: 'M5\nG10 L2 P1 X0 Y0' },
  'TEMPLATE_G10',
);

assertRejected(
  'footer with embedded work-coordinate mutation',
  { footerTemplate: 'M5\nG90 G10 L2 P1 X0 Y0' },
  'TEMPLATE_G10',
);

assertRejected(
  'custom end with embedded temporary coordinate reset',
  { customEnd: 'G0 X0 G92 X0 Y0\nM5' },
  'TEMPLATE_G92',
);

assertRejected(
  'template injecting unlock command',
  { headerTemplate: '$X' },
  'TEMPLATE_UNLOCK',
);

assertRejected(
  'template motion outside bed bounds',
  { headerTemplate: 'G0 X201 Y50' },
  'TEMPLATE_MOTION_OUT_OF_BED',
);

assertRejected(
  'template embedded motion outside bed bounds',
  { headerTemplate: 'G21 G0 X201 Y50' },
  'TEMPLATE_MOTION_OUT_OF_BED',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
