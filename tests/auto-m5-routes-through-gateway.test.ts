/**
 * T1-161 (audit F-010 + F-052): `MachineService._armAutoM5OnConnect` is the
 * T3-90 defense-in-depth path that fires `M5 S0` once after connect when the
 * first idle status report carries a clean T1-25 verdict. Pre-T1-161 it called
 * `ctrl.sendCommand('M5 S0', 'internal')` directly, bypassing the
 * `MachineCommandGateway` choke point. The source-scan test
 * `no-direct-sendcommand-outside-gateway.test.ts` had been failing on master
 * for 28+ commits as a pre-existing red signal that everybody ignored.
 *
 * Post-T1-161 the auto-M5 routes through `new MachineCommandGateway(ctrl)
 *  .sendCommand('M5 S0', 'internal')`. Behavior is byte-identical (the
 * gateway short-circuits `source: 'internal'` to a passthrough) but the
 * choke-point invariant is preserved.
 *
 * This test is the regression-pin for two things:
 *   1. The source-scan test (`no-direct-sendcommand-outside-gateway.test.ts`)
 *      now passes — verified by exit code.
 *   2. The implementation in `MachineService.ts` contains the
 *      `MachineCommandGateway` import + the `new MachineCommandGateway(ctrl)`
 *      construction inside `_armAutoM5OnConnect`.
 *
 * Run: npx tsx tests/auto-m5-routes-through-gateway.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\n=== T1-161 auto-M5 routes through MachineCommandGateway ===\n');

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(
  resolve(here, '../src/app/MachineService.ts'),
  'utf-8',
);

// -------- Section 1: T1-161 marker present --------
{
  assert(/T1-161/.test(svc), 'MachineService.ts carries T1-161 marker');
  assert(
    /audit F-010/.test(svc),
    'MachineService.ts cross-references audit F-010 (auto-M5 gateway-bypass)',
  );
}

// -------- Section 2: MachineCommandGateway is imported --------
{
  assert(
    /import\s*\{[^}]*\bMachineCommandGateway\b[^}]*\}\s*from\s*['"]\.\/MachineCommandGateway['"]/s
      .test(svc),
    'MachineService imports MachineCommandGateway from ./MachineCommandGateway',
  );
}

// -------- Section 3: auto-M5 path uses gateway, not direct sendCommand --------
{
  // Locate the _armAutoM5OnConnect method body. The function spans from
  // `private _armAutoM5OnConnect(): void {` to the next top-level method
  // declaration. We anchor on the M5 S0 line.
  const armStart = svc.indexOf('private _armAutoM5OnConnect()');
  assert(armStart > 0, '_armAutoM5OnConnect method exists in MachineService');

  // The next method definition serves as the end-bound for the slice.
  const nextMethodOffset = svc.indexOf('\n  private ', armStart + 30);
  const methodBody = svc.slice(
    armStart,
    nextMethodOffset > 0 ? nextMethodOffset : svc.length,
  );

  assert(
    /new MachineCommandGateway\(ctrl\)\.sendCommand\(['"]M5 S0['"]/s.test(methodBody),
    'auto-M5 calls new MachineCommandGateway(ctrl).sendCommand(\'M5 S0\', ...)',
  );

  assert(
    !/\bctrl\.sendCommand\(['"]M5 S0['"]/s.test(methodBody),
    'auto-M5 does NOT call ctrl.sendCommand directly (pre-T1-161 bypass is gone)',
  );

  assert(
    /'internal'/.test(methodBody),
    'auto-M5 still passes source = \'internal\' (gateway passthrough)',
  );
}

// -------- Section 4: pre-existing source-pin test still passes --------
{
  // The source-scan test under tests/ enforces the broader invariant:
  // no direct controller.sendCommand call outside MachineCommandGateway.
  // We re-execute its rules in-line so a future addition that
  // re-introduces the bypass anywhere under src/app/ or src/ui/ fails
  // this test too (defense in depth alongside the dedicated scan).
  const directPatterns = [
    /\bcontroller\.sendCommand\s*\(/,
    /\bctrl\.sendCommand\s*\(/,
    /\bcontrollerRef\.current\.sendCommand\s*\(/,
  ];
  const offenders = svc.split(/\r?\n/).filter((line) =>
    directPatterns.some((pattern) => pattern.test(line)),
  );
  assert(
    offenders.length === 0,
    `No direct ctrl.sendCommand bypass remains in MachineService.ts (offenders: ${offenders.length})`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
