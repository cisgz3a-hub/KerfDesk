/**
 * LF-EXT-CANDLE-005: machine setup requirements and compatibility limits.
 *
 * Candle makes GRBL setup assumptions visible in the product workflow. This
 * contract proves LaserForge's equivalent split: hard laser/motion safety gates
 * remain hard, while machine-specific compatibility limits are explicit profile
 * choices rather than universal Start blockers.
 *
 * Run: npx tsx tests/machine-setup-compatibility-contract.test.ts
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canExecuteOperation } from '../src/app/OperationGate';
import { computeUserModeGatePolicy } from '../src/app/UserModeGates';
import { grblCapabilities, type ControllerCapabilities } from '../src/controllers/ControllerCapabilities';
import { createPrt4040RouterLaserProfile } from '../src/core/devices/DeviceProfile';
import { buildStartReadiness } from '../src/ui/components/connection/buildStartReadiness';
import { MachineSettingsTab } from '../src/ui/components/settings/MachineSettingsTab';

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert(
    haystack.includes(needle),
    `${message} (missing ${JSON.stringify(needle)})`,
  );
}

function withOperation(
  key: keyof ControllerCapabilities['operations'],
  value: boolean,
): ControllerCapabilities {
  return {
    ...grblCapabilities,
    operations: {
      ...grblCapabilities.operations,
      [key]: value,
    },
  };
}

function machineState(overrides: Partial<Parameters<typeof canExecuteOperation>[2]> = {}): Parameters<typeof canExecuteOperation>[2] {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

function readiness(overrides: Partial<Parameters<typeof buildStartReadiness>[0]> = {}) {
  return buildStartReadiness({
    preflight: { blockers: 0, warnings: 0, issues: [], canStart: true, score: 100 },
    isConnected: true,
    machineState: { errorCode: null } as Parameters<typeof buildStartReadiness>[0]['machineState'],
    machineStatus: 'idle',
    laserOutputState: 'off',
    activeOperation: null,
    recoveryPending: false,
    gcode: 'M5\n',
    gcodeStale: false,
    isSimulator: false,
    machineBlocksJobStart: false,
    canFrame: true,
    requireFrame: true,
    hasFramed: true,
    startMode: 'absolute',
    currentModeFrameAnchorValid: true,
    placementUncertain: false,
    placementUncertainReason: null,
    allowUnverifiedWcsStart: false,
    onResetWcsToBaseline: null,
    wifiTrust: {
      kind: 'usb-serial',
      tier: 'trusted',
      label: 'USB Serial',
      hint: null,
    },
    wifiStartAllowed: true,
    isRunning: false,
    canStartJob: true,
    ...overrides,
  });
}

console.log('\n=== LF-EXT-CANDLE-005 machine setup compatibility contract ===\n');

{
  const beginner = computeUserModeGatePolicy('beginner');
  assert.equal(beginner.requireFrameBeforeStart, true, 'beginner mode requires real frame proof');
  assert.equal(beginner.allowStartWithoutFraming, false, 'beginner mode does not auto-create unframed override');

  const advanced = computeUserModeGatePolicy('advanced');
  assert.equal(advanced.allowStartWithoutFraming, true, 'advanced mode keeps explicit unframed compatibility override');
  assert.equal(advanced.startWithoutFramingLabel, 'Start without framing', 'advanced override is labelled');
}

{
  const noHome = canExecuteOperation('home', withOperation('canHome', false), machineState());
  assert.equal(noHome.allowed, false, 'home is refused when the profile/controller disables homing');

  const noWcs = canExecuteOperation('wcs-normalize', withOperation('canSetWorkOrigin', false), machineState());
  assert.equal(noWcs.allowed, false, 'WCS normalization is refused when work-origin writes are unsupported');

  const idleWcs = canExecuteOperation('wcs-normalize', grblCapabilities, machineState());
  assert.equal(idleWcs.allowed, true, 'WCS reset/normalize remains reachable for an idle capable machine');
}

{
  const reset = () => undefined;
  const blocked = readiness({
    placementUncertain: true,
    placementUncertainReason: 'missing_g54',
    canStartJob: false,
    canResetWcsToBaseline: true,
    onResetWcsToBaseline: reset,
  });
  assert.equal(blocked.blockingGate?.id, 'wcsState', 'WCS reset action is surfaced when WCS blocks Start');
  assert.equal(blocked.blockingGate?.failActionButton?.onClick, reset, 'WCS gate exposes the Reset WCS callback');
  assert.match(blocked.blockingGate?.failActionButton?.label ?? '', /G10 L2 P1 X0 Y0 Z0/, 'Reset WCS button names the baseline command');

  const compatibility = readiness({
    placementUncertain: true,
    placementUncertainReason: 'missing_status_mask',
    allowUnverifiedWcsStart: true,
  });
  assert.equal(
    compatibility.gates.find((gate) => gate.id === 'wcsState')?.status,
    'ok',
    'manual-zero compatibility profile accepts unverified WCS explicitly',
  );
}

{
  const recoveryAdvisory = readiness({ canStartJob: false });
  const gate = recoveryAdvisory.gates.find((g) => String(g.id) === 'recoveryComplete');
  assert.equal(gate, undefined, 'GRBL4040 recovery checklist is not a Start-readiness gate');
}

{
  const profile = createPrt4040RouterLaserProfile();
  assert.equal(profile.homingEnabled, false, 'known router-laser profile disables Home by default');
  assert.equal(profile.allowUnverifiedWcsStart, true, 'known manual-zero profile makes WCS compatibility explicit');
  assert.equal(profile.returnToOrigin, false, 'known router-laser profile does not auto-return to origin');
}

{
  const profile = createPrt4040RouterLaserProfile();
  const html = renderToStaticMarkup(React.createElement(MachineSettingsTab, {
    activeProfile: profile,
    onUpdateProfile: () => undefined,
    canAutoDetect: true,
    onAutoDetect: () => undefined,
    liveCapabilities: {
      bedWidth: 400,
      bedHeight: 400,
      maxSpindle: 1000,
      laserMode: true,
      homingEnabled: false,
    },
  }));

  assertIncludes(html, 'Capability confidence', 'machine settings expose setup confidence');
  assertIncludes(html, 'Verified from GRBL $32', 'machine settings name laser-mode evidence');
  assertIncludes(html, 'Verified from GRBL $22', 'machine settings name homing evidence');
  assertIncludes(html, 'Allow manual-zero start when WCS cannot be verified', 'settings expose manual-zero compatibility');
  assertIncludes(html, 'GRBL $30, typically 1000', 'settings expose max-spindle setup assumption');
  assertIncludes(html, 'Advanced GRBL compatibility', 'settings expose GRBL compatibility section');
}

{
  const wizardSource = readFileSync('src/ui/components/WelcomeWizard.tsx', 'utf8');
  assertIncludes(wizardSource, 'PRTCNC PRT4040', 'first-run setup exposes known router-laser profile');
  assertIncludes(wizardSource, 'manual zero recommended', 'first-run setup explains manual-zero profile shape');
  assertIncludes(wizardSource, 'GRBL-compatible CO2', 'first-run setup scopes generic CO2 support to GRBL-compatible machines');
}

console.log('\nResult: machine setup compatibility contract passed\n');
