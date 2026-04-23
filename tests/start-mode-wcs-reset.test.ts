/**
 * sendResetWcsCommand — G10 L2 P1 X0 Y0 Z0 when leaving Origin mode.
 *
 * Run: npx tsx tests/start-mode-wcs-reset.test.ts
 */

import { sendResetWcsCommand } from '../src/app/sendResetWcsCommand';

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

console.log('\n=== start-mode-wcs-reset ===');

{
  const sent: string[] = [];
  const ctrl = { sendCommand: (s: string) => { sent.push(s); } };
  sendResetWcsCommand(ctrl);
  assert(
    sent.length === 1 && sent[0] === 'G10 L2 P1 X0 Y0 Z0',
    'sends G10 L2 P1 X0 Y0 Z0 to clear WCS',
  );
}

{
  let throws = false;
  try {
    sendResetWcsCommand(null);
    sendResetWcsCommand(undefined);
  } catch {
    throws = true;
  }
  assert(!throws, 'no-op with null/undefined controller');
}

{
  let throws = false;
  const ctrl = { sendCommand: () => { throw new Error('disconnected'); } };
  try {
    sendResetWcsCommand(ctrl);
  } catch {
    throws = true;
  }
  assert(!throws, 'swallows sendCommand errors');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
