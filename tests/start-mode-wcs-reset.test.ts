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

void (async () => {

{
  const operationSent: string[] = [];
  const rawSent: string[] = [];
  const ctrl = {
    sendCommand: (s: string) => { rawSent.push(s); },
    operations: {
      resetWcsToMachineOrigin: async () => {
        operationSent.push('G10 L2 P1 X0 Y0 Z0');
        return { ok: true as const };
      },
    },
  };
  await sendResetWcsCommand(ctrl);
  assert(
    operationSent.length === 1 && operationSent[0] === 'G10 L2 P1 X0 Y0 Z0' && rawSent.length === 0,
    'sends G10 L2 P1 X0 Y0 Z0 through operations only',
  );
}

{
  let throws = false;
  try {
    await sendResetWcsCommand(null);
    await sendResetWcsCommand(undefined);
  } catch {
    throws = true;
  }
  assert(!throws, 'no-op with null/undefined controller');
}

{
  let throws = false;
  const ctrl = {
    operations: {
      resetWcsToMachineOrigin: async () => ({ ok: false as const, reason: 'disconnected' }),
    },
  };
  try {
    await sendResetWcsCommand(ctrl);
  } catch {
    throws = true;
  }
  assert(!throws, 'swallows reset operation errors');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
