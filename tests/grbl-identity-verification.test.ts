/**
 * T3-50: pin device-identity capture from `$I` (`[VER:...]`, `[OPT:...]`)
 * and `$$` lines, plus the `getDeviceIdentity()` snapshot accessor and
 * its lifecycle around connect / disconnect.
 *
 * The headline contract (T2-32 ConnectionManager-driven mandatory
 * identity verification with profile-mismatch refusal) is filed as a
 * future T3-50 follow-up — it depends on T2-32 which has not shipped.
 * What ships in this slice is the capture + accessor surface so
 * preflight (T3-57) and reconnect-same-machine (T3-51) can read it.
 *
 * Run: npx tsx tests/grbl-identity-verification.test.ts
 */

import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function flush(ms = 15): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

console.log('\n=== T3-50 GRBL device identity verification ===\n');

void (async () => {
  // 1. Pre-connect snapshot is empty.
  {
    const ctrl = new GrblController();
    const id = ctrl.getDeviceIdentity();
    assert(id.firmwareVersion === null, 'Pre-connect: firmwareVersion null');
    assert(id.buildOptions === null, 'Pre-connect: buildOptions null');
    assert(id.maxSpindle === null, 'Pre-connect: maxSpindle null');
    assert(id.bedWidthMm === null, 'Pre-connect: bedWidthMm null');
    assert(id.bedHeightMm === null, 'Pre-connect: bedHeightMm null');
    assert(id.homingDirection === null, 'Pre-connect: homingDirection null');
    assert(id.homingEnabled === null, 'Pre-connect: homingEnabled null');
    assert(id.laserMode === null, 'Pre-connect: laserMode null');
  }

  // 2. After connect + $$ + injected $I lines, the snapshot is populated.
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);

    // The default MockSerialPort `$$` response includes `$30=1000.000`,
    // `$32=0`, `$130=200.000`, `$131=200.000`, `$23=0`, `$22=0` (homing
    // disabled). Verify those fields populated.
    const settingsId = ctrl.getDeviceIdentity();
    assert(settingsId.maxSpindle === 1000, 'Post-$$: maxSpindle = 1000 (from $30)');
    assert(settingsId.bedWidthMm === 200, 'Post-$$: bedWidthMm = 200 (from $130)');
    assert(settingsId.bedHeightMm === 200, 'Post-$$: bedHeightMm = 200 (from $131)');
    assert(settingsId.homingDirection === 0, 'Post-$$: homingDirection = 0 (from $23)');
    assert(settingsId.homingEnabled === false, 'Post-$$: homingEnabled = false (from $22=0)');
    assert(settingsId.laserMode === false, 'Post-$$: laserMode = false (from $32=0)');
    assert(settingsId.firmwareVersion === null, 'Post-$$: firmwareVersion still null (no $I yet)');

    // Now inject the $I response lines manually to exercise the
    // [VER:...] / [OPT:...] parser branches.
    port.injectResponse('[VER:1.1h.20221128:]');
    port.injectResponse('[OPT:VL,15,128]');
    port.injectResponse('ok');
    await flush(15);

    const fullId = ctrl.getDeviceIdentity();
    assert(
      fullId.firmwareVersion === '1.1h.20221128',
      `Post-$I: firmwareVersion captured (got "${fullId.firmwareVersion}")`,
    );
    assert(
      fullId.buildOptions === 'VL,15,128',
      `Post-$I: buildOptions captured (got "${fullId.buildOptions}")`,
    );
    // $$ data is preserved across the $I response.
    assert(fullId.maxSpindle === 1000, 'Post-$I: maxSpindle preserved');
    assert(fullId.bedWidthMm === 200, 'Post-$I: bedWidthMm preserved');

    await ctrl.disconnect();
  }

  // 3. Forked-firmware [VER:...] with build-tag suffix preserves the
  //    full payload (without the trailing colon when empty).
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);

    port.injectResponse('[VER:1.1f.20170801:Wainlux]');
    port.injectResponse('[OPT:VR,15,128]');
    port.injectResponse('ok');
    await flush(15);

    const id = ctrl.getDeviceIdentity();
    assert(
      id.firmwareVersion === '1.1f.20170801:Wainlux',
      `Forked firmware: build-tag preserved (got "${id.firmwareVersion}")`,
    );
    assert(id.buildOptions === 'VR,15,128', 'Forked firmware: build options captured');

    await ctrl.disconnect();
  }

  // 4. Empty trailing colon stripped (stock GRBL `[VER:1.1h.20221128:]`
  //    payload ends with a colon when the build tag is empty).
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);

    port.injectResponse('[VER:1.1h.20221128:]');
    await flush(15);

    const id = ctrl.getDeviceIdentity();
    assert(
      id.firmwareVersion === '1.1h.20221128',
      `Empty build-tag: trailing colon stripped (got "${id.firmwareVersion}")`,
    );

    await ctrl.disconnect();
  }

  // 5. Snapshot is fresh per call — mutating one snapshot does not
  //    leak into a subsequent snapshot.
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);
    port.injectResponse('[VER:1.1h:]');
    await flush(15);

    const a = ctrl.getDeviceIdentity();
    const b = ctrl.getDeviceIdentity();
    assert(a !== b, 'Snapshot identity: returns a fresh object on each call');
    assert(
      a.firmwareVersion === b.firmwareVersion,
      'Snapshot identity: same field values across calls',
    );

    await ctrl.disconnect();
  }

  // 6. Disconnect clears the captured identity so a future reconnect
  //    surfaces only the newly-attached device's identity.
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);

    port.injectResponse('[VER:1.1h:]');
    port.injectResponse('[OPT:VL,15,128]');
    await flush(15);

    const before = ctrl.getDeviceIdentity();
    assert(before.firmwareVersion !== null, 'Before disconnect: firmwareVersion captured');

    await ctrl.disconnect();
    const after = ctrl.getDeviceIdentity();
    assert(after.firmwareVersion === null, 'After disconnect: firmwareVersion cleared');
    assert(after.buildOptions === null, 'After disconnect: buildOptions cleared');
    assert(after.maxSpindle === null, 'After disconnect: maxSpindle cleared');
    assert(after.bedWidthMm === null, 'After disconnect: bedWidthMm cleared');
  }

  // 7. Malformed identity lines are ignored (they fall through to
  //    other parsers without populating the identity fields).
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    void port.open();
    await ctrl.connect(port);
    await flush(30);

    // Lines that look superficially like identity but don't match
    // the [VER:...] / [OPT:...] shape — these must not be captured.
    port.injectResponse('[VERBOSE:1]');
    port.injectResponse('[OPTIONAL]');
    port.injectResponse('VER:1.1');         // no leading [
    port.injectResponse('[VER:1.1');        // no trailing ]
    await flush(15);

    const id = ctrl.getDeviceIdentity();
    assert(id.firmwareVersion === null, 'Malformed: [VERBOSE:...] does not populate firmwareVersion');
    assert(id.buildOptions === null, 'Malformed: [OPTIONAL] does not populate buildOptions');

    await ctrl.disconnect();
  }

  // 8. Source pin: T3-50 marker present in GrblController identity
  //    fields and parser, plus the disconnect-clears-identity sequence.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const grbl = fs.readFileSync(
      path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
      'utf-8',
    );

    assert(/T3-50/.test(grbl), 'Source: T3-50 marker present in GrblController');
    assert(
      /private\s+_firmwareVersion\s*:\s*string\s*\|\s*null/.test(grbl),
      'Source: _firmwareVersion field declared',
    );
    assert(
      /private\s+_buildOptions\s*:\s*string\s*\|\s*null/.test(grbl),
      'Source: _buildOptions field declared',
    );
    assert(
      /_tryParseIdentityLine\(/.test(grbl),
      'Source: _tryParseIdentityLine helper exists',
    );
    assert(
      /getDeviceIdentity\(\)\s*:\s*DeviceIdentity/.test(grbl),
      'Source: getDeviceIdentity() returns DeviceIdentity',
    );

    const iface = fs.readFileSync(
      path.resolve(here, '../src/controllers/ControllerInterface.ts'),
      'utf-8',
    );
    assert(
      /export interface DeviceIdentity\b/.test(iface),
      'Source: DeviceIdentity interface exported from ControllerInterface',
    );
  }

  console.log(`\nT3-50 device identity verification: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
