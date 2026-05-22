import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

console.log('\n=== wizard GRBL support scope ===\n');

const here = dirname(fileURLToPath(import.meta.url));
const wizardSrc = readFileSync(resolve(here, '../src/ui/components/WelcomeWizard.tsx'), 'utf8');

assert(
  !/desc:\s*'[^']*\bK40\b[^']*'/.test(wizardSrc),
  'first-run machine presets do not advertise stock K40/Lihuiyu boards as GRBL-ready',
);

assert(
  /GRBL-compatible/.test(wizardSrc),
  'CO2 wizard copy names GRBL-compatible support scope explicitly',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
