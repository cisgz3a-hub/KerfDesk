/**
 * T3-48: pin the `navigator.serial.getPorts()` device-reuse flow.
 *
 * The connect path now tries previously-authorized ports first via
 * `getPorts()`, matched by USB fingerprint when one is supplied,
 * before falling back to the existing `requestPort()` prompt. Default
 * `close()` no longer revokes the persistent grant, so a normal
 * disconnect → reconnect cycle reuses the device without re-prompting.
 * Explicit revocation lives in `forgetActiveDevice` (live port) and
 * `WebSerialPort.forgetKnownPorts` (static, fingerprint-aware).
 *
 * Run: npx tsx tests/serial-known-port-reuse.test.ts
 */

import { FakeNavigatorSerial } from './harness/fakeWebSerial';
import {
  WebSerialPort,
  type DeviceFingerprint,
} from '../src/communication/WebSerialPort';

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

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

console.log('\n=== T3-48 navigator.serial.getPorts device-reuse flow ===\n');

void (async () => {
  // 1. Fingerprint match: connectKnownPortOrPrompt opens the known
  //    port directly and never calls requestPort.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const known = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });
      // A second known port with a different fingerprint must NOT be
      // selected — proves the matcher is precise, not "first known".
      const wrongFamily = fake.preparePort({ vendorId: 0x9999, productId: 0x1111 });

      const ws = new WebSerialPort();
      const result = await ws.connectKnownPortOrPrompt(115200, {
        usbVendorId: 0x1a86,
        usbProductId: 0x7523,
      });

      assert(result.usedKnownPort === true, 'Fingerprint match: usedKnownPort=true');
      assert(known.openCalled === 1, 'Fingerprint match: known port opened exactly once');
      assert(wrongFamily.openCalled === 0, 'Fingerprint match: wrong-family port not opened');
      assert(result.fingerprint?.usbVendorId === 0x1a86, 'Fingerprint match: result.fingerprint.usbVendorId captured');
      assert(result.fingerprint?.usbProductId === 0x7523, 'Fingerprint match: result.fingerprint.usbProductId captured');
      assert(ws.isOpen === true, 'Fingerprint match: port is open after connect');

      await ws.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 2. No fingerprint match: connectKnownPortOrPrompt falls back to
  //    the requestPort prompt path.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const known = fake.preparePort({ vendorId: 0x0001, productId: 0x0002 });

      const ws = new WebSerialPort();
      const result = await ws.connectKnownPortOrPrompt(115200, {
        usbVendorId: 0xFFFF,
        usbProductId: 0xFFFF,
      });

      assert(result.usedKnownPort === false, 'No match: usedKnownPort=false');
      assert(known.openCalled === 1, 'No match: requestPort path opens the same fake port');
      assert(ws.isOpen === true, 'No match: port is open via prompt fallback');

      await ws.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 3. Single known port + no fingerprint: reuse without prompt.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const known = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });

      const ws = new WebSerialPort();
      const result = await ws.connectKnownPortOrPrompt(115200);

      assert(result.usedKnownPort === true, 'Single known + no fingerprint: usedKnownPort=true');
      assert(known.openCalled === 1, 'Single known + no fingerprint: known port opened');
      assert(result.fingerprint?.usbVendorId === 0x1a86, 'Single known + no fingerprint: fingerprint captured');

      await ws.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 4. Multiple known ports + no fingerprint: ambiguous → prompt.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      fake.preparePort({ vendorId: 0x0001 });
      fake.preparePort({ vendorId: 0x0002 });

      const ws = new WebSerialPort();
      const result = await ws.connectKnownPortOrPrompt(115200);

      assert(
        result.usedKnownPort === false,
        'Multiple known + no fingerprint: usedKnownPort=false (prompt fallback)',
      );

      await ws.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 5. No known ports: connectKnownPortOrPrompt falls through to the
  //    standard prompt and result.usedKnownPort=false.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      // No preparePort calls — getPorts() returns empty.
      const ws = new WebSerialPort();
      const result = await ws.connectKnownPortOrPrompt(115200);

      assert(result.usedKnownPort === false, 'No known ports: usedKnownPort=false');
      assert(ws.isOpen === true, 'No known ports: prompt fallback opens a fresh port');

      await ws.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 6. T3-48 close-no-forget: a normal close() does NOT revoke the
  //    persistent grant. This is the behavior change at the heart of
  //    T3-48 — without it, getPorts() would return an empty list on
  //    every reconnect.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const known = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });

      const ws = new WebSerialPort();
      await ws.requestAndOpen(115200);
      assert(ws.isOpen === true, 'close-no-forget: port opened');
      assert(known.forgetCalled === 0, 'close-no-forget: forget not called during open');

      await ws.close();
      assert(known.closeCalled === 1, 'close-no-forget: close() called the underlying close');
      assert(known.forgetCalled === 0, 'close-no-forget: close() did NOT call forget()');
      assert(ws.isOpen === false, 'close-no-forget: port reports closed');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 7. forgetActiveDevice: explicitly revoke the grant on the live
  //    port. Closes the port if still open, then calls forget().
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const known = fake.preparePort({ vendorId: 0x1a86 });

      const ws = new WebSerialPort();
      await ws.requestAndOpen(115200);
      await ws.forgetActiveDevice();

      assert(known.closeCalled >= 1, 'forgetActiveDevice: closes the underlying port');
      assert(known.forgetCalled === 1, 'forgetActiveDevice: revokes the persistent grant');
      assert(ws.isOpen === false, 'forgetActiveDevice: port reports closed');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 8. forgetActiveDevice on no-port is a no-op.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const ws = new WebSerialPort();
      // Never opened.
      await ws.forgetActiveDevice();
      assert(ws.isOpen === false, 'forgetActiveDevice on no-port: still closed');
      // No assertion failures, no thrown errors.
      assert(true, 'forgetActiveDevice on no-port: did not throw');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 9. Static getKnownPorts: returns the navigator.serial.getPorts()
  //    list and tolerates browsers that do not implement getPorts.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      fake.preparePort({ vendorId: 0x0001 });
      fake.preparePort({ vendorId: 0x0002 });
      const ports = await WebSerialPort.getKnownPorts();
      assert(ports.length === 2, 'getKnownPorts: returns all known ports');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 10. Static forgetKnownPorts: revokes grants matching the
  //     fingerprint; non-matching grants stay intact.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const a = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });
      const b = fake.preparePort({ vendorId: 0x9999, productId: 0x1111 });

      const target: DeviceFingerprint = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
      const forgotten = await WebSerialPort.forgetKnownPorts(target);

      assert(forgotten === 1, 'forgetKnownPorts: revoked exactly one grant');
      assert(a.forgetCalled === 1, 'forgetKnownPorts: matching port forgotten');
      assert(b.forgetCalled === 0, 'forgetKnownPorts: non-matching port preserved');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 11. Static forgetKnownPorts with no fingerprint revokes every
  //     known grant.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const a = fake.preparePort({ vendorId: 0x0001 });
      const b = fake.preparePort({ vendorId: 0x0002 });

      const forgotten = await WebSerialPort.forgetKnownPorts();
      assert(forgotten === 2, 'forgetKnownPorts (no fingerprint): revoked both grants');
      assert(a.forgetCalled === 1, 'forgetKnownPorts (no fingerprint): port a forgotten');
      assert(b.forgetCalled === 1, 'forgetKnownPorts (no fingerprint): port b forgotten');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 12. Vendor-only fingerprint: matches any productId for the same
  //     vendor.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const a = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });
      const b = fake.preparePort({ vendorId: 0x1a86, productId: 0x55D4 });
      const c = fake.preparePort({ vendorId: 0x9999, productId: 0x7523 });

      const forgotten = await WebSerialPort.forgetKnownPorts({ usbVendorId: 0x1a86 });
      assert(forgotten === 2, 'Vendor-only fingerprint: revokes all matching vendors');
      assert(a.forgetCalled === 1, 'Vendor-only fingerprint: port a forgotten');
      assert(b.forgetCalled === 1, 'Vendor-only fingerprint: port b (different productId, same vendor) forgotten');
      assert(c.forgetCalled === 0, 'Vendor-only fingerprint: port c (different vendor) preserved');
    } finally {
      fake.removeFromGlobal();
    }
  }

  // 13. AbortSignal cancels connectKnownPortOrPrompt before getPorts.
  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      fake.preparePort({ vendorId: 0x1a86 });
      const ws = new WebSerialPort();
      const ac = new AbortController();
      ac.abort();
      let rejected = false;
      try {
        await ws.connectKnownPortOrPrompt(115200, undefined, ac.signal);
      } catch {
        rejected = true;
      }
      assert(rejected, 'AbortSignal: pre-aborted signal rejects connectKnownPortOrPrompt');
      assert(ws.isOpen === false, 'AbortSignal: port did not open after abort');
    } finally {
      fake.removeFromGlobal();
    }
  }

  await flush();

  console.log(`\nT3-48 navigator.serial.getPorts: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
