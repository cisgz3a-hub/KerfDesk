/**
 * F45-15-003: GRBL compatibility modes must be exposed in Machine settings.
 *
 * Run: npx tsx tests/grbl-compatibility-settings-ui.test.tsx
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createBlankProfile,
  resolveAirAssistCommand,
  resolveGrblJogMode,
  resolveGrblLaserPowerMode,
  resolveGrblTransferMode,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { MachineSettingsTab } from '../src/ui/components/settings/MachineSettingsTab';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function selectByLabel(container: Element, label: string): HTMLSelectElement | null {
  return container.querySelector(`select[aria-label="${label}"]`);
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  select.value = value;
  await act(async () => {
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  });
}

async function renderSettings(profile: DeviceProfile, onUpdateProfile: (updates: Partial<DeviceProfile>) => void): Promise<{
  container: HTMLElement;
  root: Root;
}> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(MachineSettingsTab, {
      activeProfile: profile,
      onUpdateProfile,
      canAutoDetect: false,
      onAutoDetect: () => undefined,
    }));
  });

  return { container, root };
}

async function run(): Promise<void> {
  console.log('\n=== F45-15-003 GRBL compatibility settings UI ===\n');

  const profile = createBlankProfile('GRBL compatibility test');
  const updates: Partial<DeviceProfile>[] = [];
  const { container, root } = await renderSettings(profile, update => updates.push(update));

  check(container.textContent?.includes('Advanced GRBL compatibility') === true, 'advanced GRBL compatibility section is visible');

  const laserMode = selectByLabel(container, 'Laser power mode');
  const transferMode = selectByLabel(container, 'Transfer mode');
  const jogMode = selectByLabel(container, 'Jog mode');
  const airAssist = selectByLabel(container, 'Air assist command');

  check(laserMode != null, 'laser power mode selector is rendered');
  check(transferMode != null, 'transfer mode selector is rendered');
  check(jogMode != null, 'jog mode selector is rendered');
  check(airAssist != null, 'air assist selector is rendered');

  if (laserMode && transferMode && jogMode && airAssist) {
    check(laserMode.value === 'dynamic-m4', 'default laser power mode is dynamic M4');
    check(transferMode.value === 'buffered', 'default transfer mode is buffered');
    check(jogMode.value === 'grbl-j', 'default jog mode is GRBL $J');
    check(airAssist.value === 'M8', 'default air assist command is M8');

    await changeSelect(laserMode, 'constant-m3');
    await changeSelect(transferMode, 'synchronous');
    await changeSelect(jogMode, 'legacy-gcode');
    await changeSelect(airAssist, 'M7');
  }

  const mergedProfile: DeviceProfile = Object.assign({}, profile, ...updates);
  check(resolveGrblLaserPowerMode(mergedProfile) === 'constant-m3', 'laser mode update feeds output resolver');
  check(resolveGrblTransferMode(mergedProfile) === 'synchronous', 'transfer update feeds controller resolver');
  check(resolveGrblJogMode(mergedProfile) === 'legacy-gcode', 'jog update feeds controller resolver');
  check(resolveAirAssistCommand(mergedProfile) === 'M7', 'air-assist update feeds output resolver');

  await act(async () => {
    root.render(React.createElement(MachineSettingsTab, {
      activeProfile: mergedProfile,
      onUpdateProfile: update => updates.push(update),
      canAutoDetect: false,
      onAutoDetect: () => undefined,
    }));
  });

  check(selectByLabel(container, 'Laser power mode')?.value === 'constant-m3', 'laser mode selection survives re-render');
  check(selectByLabel(container, 'Transfer mode')?.value === 'synchronous', 'transfer mode selection survives re-render');
  check(selectByLabel(container, 'Jog mode')?.value === 'legacy-gcode', 'jog mode selection survives re-render');
  check(selectByLabel(container, 'Air assist command')?.value === 'M7', 'air assist selection survives re-render');

  const machineServiceSource = readFileSync('src/app/MachineService.ts', 'utf8');
  check(
    /transferMode:\s*resolveGrblTransferMode\(getActiveProfile\(\)\)/.test(machineServiceSource),
    'MachineService start path resolves transfer mode from active profile',
  );

  await act(async () => { root.unmount(); });

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
