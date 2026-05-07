/**
 * T2-28: profile/controller-driven output target selection.
 * Run: npx tsx tests/output-target-resolution.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  resolveOutputTarget,
} from '../src/app/PipelineService';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function cloneCaps(overrides: Partial<ControllerCapabilities> = {}): ControllerCapabilities {
  return {
    ...grblCapabilities,
    ...overrides,
    output: {
      ...grblCapabilities.output,
      ...overrides.output,
    },
  };
}

function profileWith(overrides: Partial<DeviceProfile>): DeviceProfile {
  return {
    ...createBlankProfile('T2-28 profile'),
    ...overrides,
  };
}

async function run(): Promise<void> {
  console.log('\n=== T2-28 output target resolution ===\n');

  {
    const target = resolveOutputTarget(profileWith({}), grblCapabilities);
    assert(target.format === 'grbl', 'GRBL profile + GRBL capabilities resolves GRBL strategy');
    assert(target.dialect === 'grbl', 'GRBL default dialect is grbl');
    assert(target.controllerFormat === 'gcode-text', 'GRBL strategy requires gcode-text controller output');
    assert(target.source === 'controller-default', 'GRBL default came from controller-supported output');
  }

  {
    const target = resolveOutputTarget(
      profileWith({ outputFormat: 'marlin', outputDialect: 'marlin' }),
      cloneCaps({ output: { ...grblCapabilities.output, formats: ['gcode-text'] } }),
    );
    assert(target.format === 'marlin', 'Marlin profile + gcode-text capabilities resolves Marlin strategy');
    assert(target.dialect === 'marlin', 'Marlin profile controls output dialect');
    assert(target.source === 'profile-preference', 'compatible profile preference wins');
  }

  {
    const target = resolveOutputTarget(
      profileWith({ outputFormat: 'ruida', outputDialect: 'ruida' }),
      grblCapabilities,
    );
    assert(target.format === 'grbl', 'incompatible profile output falls back to controller default');
    assert(target.source === 'controller-default', 'fallback is explicitly tagged as controller default');
  }

  {
    const target = resolveOutputTarget(
      null,
      cloneCaps({ output: { ...grblCapabilities.output, formats: [] } }),
      'smoothie',
    );
    assert(target.format === 'smoothie', 'no supported controller formats falls back to caller legacy format');
    assert(target.source === 'legacy-fallback', 'legacy fallback is explicitly tagged');
  }

  {
    const here = dirname(fileURLToPath(import.meta.url));
    const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf8');
    const profileSrc = readFileSync(resolve(here, '../src/core/devices/DeviceProfile.ts'), 'utf8');
    const cgStart = pipelineSrc.indexOf('export async function compileGcode(');
    const cgEnd = pipelineSrc.indexOf('export async function compileToolpath(');
    const cgBody = pipelineSrc.slice(cgStart, cgEnd);
    const ctBody = pipelineSrc.slice(cgEnd);

    assert(/T2-28/.test(pipelineSrc), 'T2-28 marker present in PipelineService.ts');
    assert(/export function resolveOutputTarget/.test(pipelineSrc), 'resolveOutputTarget is exported');
    assert(/const outputTarget = resolveOutputTarget/.test(cgBody), 'compileGcode resolves output target before strategy lookup');
    assert(!/getOutputStrategy\(outputFormat\)/.test(cgBody), 'compileGcode no longer hardcodes outputFormat lookup');
    assert(/const outputTarget = resolveOutputTarget/.test(ctBody), 'compileToolpath resolves output target too');
    assert(/outputFormat\?:/.test(profileSrc), 'DeviceProfile carries optional outputFormat preference');
    assert(/outputDialect\?:/.test(profileSrc), 'DeviceProfile carries optional outputDialect preference');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
