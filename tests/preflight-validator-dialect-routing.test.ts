/**
 * T3-42: template validation must route by controller/output dialect.
 *
 * Run: npx tsx tests/preflight-validator-dialect-routing.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  emptyTemplateContext,
} from '../src/core/plan/GcodeTemplates';
import {
  validateGcodeTemplates,
  type TemplateFinding,
  type TemplateValidationInput,
} from '../src/core/preflight/GcodeTemplateValidator';
import { runPreflightSummary } from '../src/core/preflight/Preflight';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import type { MachineState } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function codes(findings: TemplateFinding[]): Set<string> {
  return new Set(findings.map(f => f.code));
}

function baseInput(overrides: Partial<TemplateValidationInput> = {}): TemplateValidationInput {
  return {
    templateContext: { ...emptyTemplateContext(), bedWidthMm: 200, bedHeightMm: 200, maxSpeedMmPerMin: 3000 },
    bedWidthMm: 200,
    bedHeightMm: 200,
    maxSpindle: 1000,
    ...overrides,
  };
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function sceneWithRect() {
  const scene = createScene(400, 300, 'dialect routing');
  return addObject(scene, createRect(scene.layers[0].id, 20, 20, 40, 30));
}

console.log('\n=== T3-42 preflight validator dialect routing ===\n');

{
  const findings = validateGcodeTemplates(baseInput({ customStart: '$X', dialect: 'grbl' }));
  assert(codes(findings).has('TEMPLATE_UNLOCK'), 'GRBL dialect still blocks $X unlock');
}

{
  const findings = validateGcodeTemplates(baseInput({ customStart: '$X', dialect: 'marlin' }));
  assert(!codes(findings).has('TEMPLATE_UNLOCK'), 'Marlin dialect does not treat $X as GRBL unlock');
  assert(!findings.some(f => f.severity === 'error'), 'Marlin $X does not block as a GRBL-specific error');
}

{
  const findings = validateGcodeTemplates(baseInput({
    customStart: '$X\nM3 S1000\nG92 X0',
    footerTemplate: '',
    dialect: 'ruida',
  }));
  assert(findings.length === 0, 'Ruida dialect skips G-code template validation entirely');
}

{
  const findings = validateGcodeTemplates(baseInput({ customStart: 'M3 S500', dialect: 'marlin' }));
  assert(codes(findings).has('TEMPLATE_LASER_ON_NO_MOTION'),
    'Marlin still gets generic laser-on-without-motion protection');
}

{
  const profile = createBlankProfile('MarlinRoute');
  profile.outputFormat = 'marlin';
  profile.startGcode = '$X';
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const summary = runPreflightSummary(
    sceneWithRect(),
    null,
    idle,
    400,
    300,
    { minX: 0, minY: 0, maxX: 60, maxY: 60 },
  );
  assert(!summary.issues.some(i => i.id === 'TEMPLATE_UNLOCK'),
    'Preflight routes profile.outputFormat=marlin away from GRBL unlock rule');
}

{
  const profile = createBlankProfile('GrblRoute');
  profile.outputFormat = 'grbl';
  profile.startGcode = '$X';
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  const summary = runPreflightSummary(
    sceneWithRect(),
    null,
    idle,
    400,
    300,
    { minX: 0, minY: 0, maxX: 60, maxY: 60 },
  );
  assert(summary.issues.some(i => i.id === 'TEMPLATE_UNLOCK' && i.severity === 'blocker'),
    'Preflight still blocks GRBL profile.outputFormat=grbl unlock rule');
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '../src/core/preflight/GcodeTemplateValidator.ts'), 'utf-8');
  assert(/T3-42/.test(source), 'GcodeTemplateValidator carries T3-42 marker');
  assert(/dialect\?:/.test(source), 'TemplateValidationInput accepts a dialect');
  assert(/getTemplateValidatorForDialect/.test(source), 'dialect router is declared');
  assert(/validateGrblResolvedText/.test(source), 'GRBL-specific validator is split out');
  assert(/validateGenericGcodeResolvedText/.test(source), 'generic G-code validator is split out');
  assert(/validateRuidaTemplates/.test(source), 'Ruida no-template validator is split out');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
