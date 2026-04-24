/**
 * WCS / $10 connect-time consent: GrblController reads $# and only prompts (via
 * onWcsConsentNeeded) when G54 and $10 already match the LaserForge baseline.
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import { type WcsConsentSnapshot } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 30));
}

async function waitUntil(fn: () => boolean, timeoutMs = 2000, step = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return;
    await new Promise<void>(x => setTimeout(x, step));
  }
}

async function main(): Promise<void> {
  console.log('\n=== WCS consent: defaults → auto-apply, listener not used ===');
  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    let listenerCalls = 0;
    ctrl.onWcsConsentNeeded!(() => { listenerCalls++; });
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => port.received.includes('G10 L2 P1 X0 Y0 Z0'));
    assert(listenerCalls === 0, 'Listener not called when G54 and $10 are already at baseline');
    const st = ctrl.getCurrentWcsState!();
    assert(st.g54 !== null && Math.abs(st.g54.x) < 0.0005, 'G54 read as near-zero from $#');
    assert(st.statusMask === 0, '$10 from $$ is 0');
    await ctrl.disconnect();
  }

  console.log('\n=== WCS consent: $10 non-zero → event with status mask, apply from handler ===');
  {
    const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=255',
        '$22=0',
        '$30=1000.000',
        '$130=200.000',
        '$131=200.000',
        'ok',
      ];
    }
    if (line === '$#') {
      return [
        '[G54:0.000,0.000,0.000]',
        'ok',
      ];
    }
    if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
    if (line.startsWith('$10=')) return ['ok'];
    return ['ok'];
  });
  const ctrl = new GrblController();
  let payload: WcsConsentSnapshot | null = null;
  ctrl.onWcsConsentNeeded!(p => { payload = p; });
  port.open();
  await ctrl.connect(port);
  await waitUntil(() => payload !== null);
  assert(payload !== null, 'onWcsConsentNeeded fires when $10 !== 0');
  assert(payload!.statusMask === 255, 'Payload carries status mask');
  assert(!port.received.includes('G10 L2 P1 X0 Y0 Z0'), 'G10 not sent before user applies');
  ctrl.applyWcsNormalization!();
  await flush();
  assert(port.received.includes('G10 L2 P1 X0 Y0 Z0'), 'applyWcsNormalization sends G10');
    await ctrl.disconnect();
  }

  console.log('\n=== WCS consent: G54 offset without listener → direct apply (no registered UI) ===');
  {
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
    }
    if (line === '$#') {
      return ['[G54:5.250,0.000,0.000]', 'ok'];
    }
    if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
    if (line.startsWith('$10=')) return ['ok'];
    return ['ok'];
  });
  const ctrl = new GrblController();
  // No onWcsConsentNeeded — controller should apply automatically (per no-listener rule)
  port.open();
  await ctrl.connect(port);
  await waitUntil(() => port.received.includes('G10 L2 P1 X0 Y0 Z0'));
  assert(port.received.includes('G10 L2 P1 X0 Y0 Z0'), 'Baseline applied with no app listener');
    await ctrl.disconnect();
  }

  console.log('\n=== WCS consent: G54 offset with listener → prompt path, then skip ===');
  {
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
    }
    if (line === '$#') {
      return ['[G54:5.250,0.000,0.000]', 'ok'];
    }
    if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
    if (line.startsWith('$10=')) return ['ok'];
    return ['ok'];
  });
  const ctrl = new GrblController();
  let saw = false;
  ctrl.onWcsConsentNeeded!((p) => {
    saw = true;
    assert(Math.abs(p.g54.x - 5.25) < 0.001, 'Event carries G54 X');
    ctrl.skipWcsNormalization!();
  });
  port.open();
  await ctrl.connect(port);
  await waitUntil(() => saw);
  assert(saw, 'Handler ran when G54 is non-zero');
  assert(
    !port.received.includes('G10 L2 P1 X0 Y0 Z0'),
    'skipWcsNormalization leaves G10 unset',
  );
    await ctrl.disconnect();
  }
}

void main()
  .then(() => {
    if (failed > 0) {
      process.exit(1);
    }
    process.stdout.write(`\nWcs mutation consent: ${passed} passed\n`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
