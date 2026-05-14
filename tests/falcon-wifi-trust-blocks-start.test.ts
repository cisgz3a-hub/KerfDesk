/**
 * T1-123: regression test that the production start gate consumes
 * the Falcon WiFi trust classifier. Pre-T1-123 the trust classifier
 * + per-action policy at `src/security/FalconWiFiTrust.ts` (T2-126)
 * was framework-only — no production code imported it. The audit's
 * Phase 2 #7 finding called this out as a "foundation exists but
 * product does not use it" gap.
 *
 * Post-T1-123 MachineService consults `evaluateActionAllowed('start-job')`
 * inside `startValidatedJob` and refuses for untrusted (Falcon WiFi)
 * connections unless an override is active. This test pins:
 *   - getConnectionTrust derives 'trusted' (USB) / 'untrusted' (WiFi) /
 *     'partial' (no/unknown profile) from the active profile's
 *     connection.kind
 *   - evaluateActionAllowed returns allowed=true on trusted, false on
 *     untrusted-without-override, true on untrusted-with-override
 *   - requestWiFiOverride / clearWiFiOverride / onWiFiOverrideChange
 *     work; empty/whitespace reasons throw
 *   - WiFi override expires (timer fires)
 *   - startValidatedJob throws when WiFi without override
 *   - startValidatedJob succeeds (recovery aside) when override granted
 *   - source-pin: ConnectionPanelMain consumes the gate + renders the
 *     trust label in the readiness panel
 *
 * Run: npx tsx tests/falcon-wifi-trust-blocks-start.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(): LaserController {
  return {
    family: 'grbl' as const,
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    operations: {
      jog: async () => ({ ok: true as const }),
      home: async () => ({ ok: true as const }),
      unlockAlarm: async () => ({ ok: true as const }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
      resetWcsToMachineOrigin: async () => ({ ok: true as const }),
      testFire: async () => ({ ok: true as const }),
      frame: async () => ({ ok: true as const }),
      laserOff: async () => ({ ok: true as const }),
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
  } as unknown as LaserController;
}

function newService(): MachineService {
  const ctrl = makeController();
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  return new MachineService(ref, portRef);
}

function setUsbProfile(): DeviceProfile {
  const p = createBlankProfile('T1-123 USB profile');
  p.connection = { kind: 'serial' };
  saveDeviceProfile(p);
  setActiveProfileId(p.id);
  return p;
}

function setWifiProfile(): DeviceProfile {
  const p = createBlankProfile('T1-123 WiFi profile');
  p.connection = { kind: 'falcon-wifi', ip: '192.168.1.42' };
  saveDeviceProfile(p);
  setActiveProfileId(p.id);
  return p;
}

console.log('\n=== T1-123 Falcon WiFi trust gates start-job ===\n');

void (async () => {

// -------- 1. Trust classification by profile.connection.kind --------
{
  setUsbProfile();
  const svc = newService();
  const t = svc.getConnectionTrust();
  assert(t.tier === 'trusted', `USB profile → trust tier 'trusted' (got '${t.tier}')`);
  assert(t.kind === 'usb-serial', "USB profile → ConnectionKind 'usb-serial'");
}
{
  setWifiProfile();
  const svc = newService();
  const t = svc.getConnectionTrust();
  assert(t.tier === 'untrusted', `WiFi profile → trust tier 'untrusted' (got '${t.tier}')`);
  assert(t.kind === 'wifi', "WiFi profile → ConnectionKind 'wifi'");
  assert(t.label.includes('telemetry only'),
    "WiFi label says 'telemetry only'");
}

// -------- 2. evaluateActionAllowed: trusted always allows --------
{
  setUsbProfile();
  const svc = newService();
  const v = svc.evaluateActionAllowed('start-job');
  assert(v.allowed === true, 'USB: start-job allowed');
  assert(v.overrideActive === false, 'USB: no override needed');
}

// -------- 3. evaluateActionAllowed: untrusted blocks start-job by default --------
{
  setWifiProfile();
  const svc = newService();
  const v = svc.evaluateActionAllowed('start-job');
  assert(v.allowed === false, 'WiFi without override: start-job blocked');
  assert(v.userMessage.length > 0, 'block surfaces a user message');
  assert(v.overrideActive === false, 'no override active');
}

// -------- 4. requestWiFiOverride enables start-job --------
{
  setWifiProfile();
  const svc = newService();
  const granted = svc.requestWiFiOverride('test: simulate user override');
  assert(granted.reason === 'test: simulate user override',
    'requestWiFiOverride records the reason');
  assert(granted.expiresAt > granted.grantedAt,
    'override expiresAt is later than grantedAt');
  const v = svc.evaluateActionAllowed('start-job');
  assert(v.allowed === true, 'WiFi with active override: start-job allowed');
  assert(v.overrideActive === true, 'overrideActive flag set');
}

// -------- 5. requestWiFiOverride throws on empty / whitespace reason --------
{
  setWifiProfile();
  const svc = newService();
  let threwEmpty = false;
  try { svc.requestWiFiOverride(''); } catch { threwEmpty = true; }
  assert(threwEmpty, 'empty reason → throws');
  let threwWs = false;
  try { svc.requestWiFiOverride('   '); } catch { threwWs = true; }
  assert(threwWs, 'whitespace-only reason → throws');
}

// -------- 6. clearWiFiOverride removes the override --------
{
  setWifiProfile();
  const svc = newService();
  svc.requestWiFiOverride('test reason');
  assert(svc.getWiFiOverride() != null, 'precondition: override active');
  svc.clearWiFiOverride();
  assert(svc.getWiFiOverride() === null, 'clearWiFiOverride removes override');
  assert(svc.evaluateActionAllowed('start-job').allowed === false,
    'after clear: start-job blocked again');
}

// -------- 7. onWiFiOverrideChange fires on grant + clear --------
{
  setWifiProfile();
  const svc = newService();
  const seen: Array<string | null> = [];
  const unsub = svc.onWiFiOverrideChange((o) => seen.push(o?.reason ?? null));
  svc.requestWiFiOverride('first');
  svc.clearWiFiOverride();
  svc.requestWiFiOverride('second');
  unsub();
  svc.clearWiFiOverride();
  assert(seen.length === 3,
    `listener fires for grant+clear+grant (got ${seen.length} fires)`);
  assert(seen[0] === 'first', "first fire carries 'first' reason");
  assert(seen[1] === null, 'second fire carries null (cleared)');
  assert(seen[2] === 'second', "third fire carries 'second' reason");
}

// -------- 8. Override expires (short-window test) --------
{
  setWifiProfile();
  const svc = newService();
  svc.requestWiFiOverride('expiry test', 50); // 50 ms window
  assert(svc.getWiFiOverride() != null, 'precondition: override active immediately');
  await new Promise((r) => setTimeout(r, 80));
  // Either the timer fired or getWiFiOverride's defense-in-depth
  // expiry check returns null. Both satisfy the contract.
  assert(svc.getWiFiOverride() === null,
    'override expires after the duration window');
  assert(svc.evaluateActionAllowed('start-job').allowed === false,
    'after expiry: start-job blocked again');
}

// -------- 9. startValidatedJob throws when WiFi without override --------
{
  setWifiProfile();
  const svc = newService();
  let threw = false;
  let message = '';
  try {
    await svc.startValidatedJob({
      ticket: { ticketId: 't', gcodeLines: ['G0 X0'], gcodeText: 'G0 X0' } as never,
      frameTicket: null,
      scene: {} as never,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: {} as never,
      currentStartMode: 'absolute',
      currentSavedOrigin: null,
    });
  } catch (e) {
    threw = true;
    message = (e as Error).message ?? '';
  }
  assert(threw, 'WiFi + no override: startValidatedJob throws');
  assert(/untrusted connection/i.test(message),
    `error message names 'untrusted connection' (got '${message.slice(0, 80)}…')`);
  assert(/USB/i.test(message), 'error message suggests USB');
}

// -------- 10. With override, the WiFi gate passes (job may still fail
//     for unrelated reasons — we only assert the WiFi-specific message
//     is gone) --------
{
  setWifiProfile();
  const svc = newService();
  svc.requestWiFiOverride('override for this test');
  let untrustedMessage = false;
  try {
    await svc.startValidatedJob({
      ticket: { ticketId: 't', gcodeLines: ['G0 X0'], gcodeText: 'G0 X0' } as never,
      frameTicket: null,
      scene: {} as never,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: {} as never,
      currentStartMode: 'absolute',
      currentSavedOrigin: null,
    });
  } catch (e) {
    if (/untrusted connection/i.test((e as Error).message ?? '')) {
      untrustedMessage = true;
    }
  }
  assert(!untrustedMessage,
    'WiFi + override: startValidatedJob does not throw the untrusted-connection error');
}

// -------- Source-level pins --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');

  const svcSrc = readFileSync(resolve(repoRoot, 'src/app/MachineService.ts'), 'utf-8');
  assert(/T1-123/.test(svcSrc), 'MachineService.ts carries T1-123 marker');
  assert(/getConnectionTrust\(\):\s*TrustClassification/.test(svcSrc),
    'MachineService exposes getConnectionTrust(): TrustClassification');
  assert(/requestWiFiOverride/.test(svcSrc),
    'MachineService exposes requestWiFiOverride');
  assert(/clearWiFiOverride/.test(svcSrc),
    'MachineService exposes clearWiFiOverride');
  assert(/onWiFiOverrideChange/.test(svcSrc),
    'MachineService exposes onWiFiOverrideChange');
  assert(/evaluateActionAllowed/.test(svcSrc),
    'MachineService exposes evaluateActionAllowed');
  assert(/this\.evaluateActionAllowed\('start-job'\)/.test(svcSrc),
    'startValidatedJob calls evaluateActionAllowed(start-job)');
  assert(/\.unref\?\.\(\)/.test(svcSrc),
    'WiFi override expiry timer is unrefed in Node-backed tests');

  const panelSrc = readFileSync(
    resolve(repoRoot, 'src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/T1-123/.test(panelSrc), 'ConnectionPanelMain carries T1-123 marker');
  assert(/wifiStartAllowed/.test(panelSrc),
    'ConnectionPanelMain reads wifiStartAllowed');
  assert(/onWiFiOverrideChange/.test(panelSrc),
    'ConnectionPanelMain subscribes to onWiFiOverrideChange');
  assert(/getConnectionTrust\(\)/.test(panelSrc),
    'ConnectionPanelMain reads getConnectionTrust()');
  // T1-129: the connectionTrust gate moved to the pure
  // buildStartReadiness helper. Source-pin against the helper
  // module instead; ConnectionPanelMain just delegates to it.
  const buildSrc = readFileSync(
    resolve(repoRoot, 'src/ui/components/connection/buildStartReadiness.ts'),
    'utf-8',
  );
  assert(/id: 'connectionTrust'/.test(buildSrc),
    'buildStartReadiness registers a connectionTrust readiness gate (moved from inline IIFE in T1-129)');
  assert(/buildStartReadiness/.test(panelSrc),
    'ConnectionPanelMain delegates readiness derivation to buildStartReadiness');

  const gateSrc = readFileSync(
    resolve(repoRoot, 'src/ui/components/connection/StartReadinessPanel.tsx'),
    'utf-8',
  );
  assert(/'connectionTrust'/.test(gateSrc),
    "StartReadinessPanel's gate id union includes 'connectionTrust'");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})().catch((e) => { console.error(e); process.exit(1); });
