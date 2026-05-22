/**
 * sendResetWcsCommand — G10 L2 P1 X0 Y0 Z0 when leaving Origin mode.
 *
 * Run: npx tsx tests/start-mode-wcs-reset.test.ts
 */

import { sendResetWcsCommand } from '../src/app/sendResetWcsCommand';
import fs from 'node:fs';

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
  const result = await sendResetWcsCommand(ctrl);
  assert(
    operationSent.length === 1 && operationSent[0] === 'G10 L2 P1 X0 Y0 Z0' && rawSent.length === 0,
    'sends G10 L2 P1 X0 Y0 Z0 through operations only',
  );
  assert(result.ok === true, 'success path reports ok:true so callers can trust the reset result');
}

{
  const nullResult = await sendResetWcsCommand(null);
  const undefinedResult = await sendResetWcsCommand(undefined);
  assert(!nullResult.ok && nullResult.reason === 'no-controller', 'null controller reports no-controller failure');
  assert(!undefinedResult.ok && undefinedResult.reason === 'no-controller', 'undefined controller reports no-controller failure');
}

{
  const ctrl = {
    operations: {
      resetWcsToMachineOrigin: async () => ({ ok: false as const, reason: 'disconnected' }),
    },
  };
  const result = await sendResetWcsCommand(ctrl);
  assert(!result.ok && result.reason === 'disconnected', 'operation failure is returned to the caller');
}

{
  const ctrl = {
    operations: {
      resetWcsToMachineOrigin: async () => {
        throw new Error('port closed');
      },
    },
  };
  const result = await sendResetWcsCommand(ctrl);
  assert(!result.ok && /port closed/.test(result.reason), 'thrown reset failure is returned to the caller');
}

{
  const app = fs.readFileSync('src/ui/components/App.tsx', 'utf8');
  assert(
    /sendResetWcsCommand\(grbl\.controller\)[\s\S]{0,280}if \(!result\.ok\)[\s\S]{0,220}showAlert\(/.test(app),
    'App mode-switch path reports failed WCS reset instead of silently ignoring it',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
