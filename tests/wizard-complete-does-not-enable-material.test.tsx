import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { resetDeviceProfilesForTest } from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';
import { useWizardHandlers, type WizardHandlers } from '../src/ui/hooks/useWizardHandlers';
import { type WizardResult } from '../src/ui/components/WelcomeWizard';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;
function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface Controls {
  committedScene: Scene | null;
  setupCalls: boolean[];
}

function Harness(props: {
  controls: Controls;
  onHandlers: (handlers: WizardHandlers) => void;
}): React.ReactElement | null {
  const handlers = useWizardHandlers({
    scene: createScene(400, 400, 'wizard-test'),
    handleSceneCommit: (scene) => { props.controls.committedScene = scene; },
    handleNewProject: () => undefined,
    setShowSetup: (show) => { props.controls.setupCalls.push(show); },
    setShowRecover: () => undefined,
    viewportActionsRef: { current: null },
    refreshProfiles: () => undefined,
    showAlert: async () => undefined,
  });
  useEffect(() => { props.onHandlers(handlers); });
  return null;
}

let root: Root | null = null;
async function renderHarness(controls: Controls): Promise<WizardHandlers> {
  const container = dom.window.document.getElementById('root')!;
  if (root) await act(async () => { root!.unmount(); });
  root = createRoot(container);
  let handlers: WizardHandlers | null = null;
  await act(async () => {
    root!.render(React.createElement(Harness, {
      controls,
      onHandlers: h => { handlers = h; },
    }));
  });
  return handlers!;
}

function wizardResult(): WizardResult {
  return {
    bedWidth: 400,
    bedHeight: 400,
    materialType: 'wood',
    materialName: 'Plywood',
    materialColor: '#c4a882',
    materialWidth: 200,
    materialHeight: 150,
    materialThickness: 3,
    machineName: 'Test Laser',
    machineWatts: '10W',
    machineType: 'diode',
    controllerType: 'grbl',
    originCorner: 'front-left',
    homeCorner: 'front-left',
    homingEnabled: true,
    maxSpindle: 1000,
  };
}

async function run(): Promise<void> {
  console.log('\n=== wizard complete does not enable material board ===\n');
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  localStorage.clear();

  const controls: Controls = { committedScene: null, setupCalls: [] };
  const handlers = await renderHarness(controls);
  await act(async () => { handlers.handleWizardComplete(wizardResult()); });

  assert(controls.setupCalls.includes(false), 'wizard completion hides setup');
  assert(controls.committedScene != null, 'wizard completion commits scene');
  assert(controls.committedScene?.canvas.width === 400, 'wizard still applies bed width');
  assert(controls.committedScene?.canvas.height === 400, 'wizard still applies bed height');
  assert(controls.committedScene?.machine?.name === 'Test Laser', 'wizard still applies machine settings');
  assert(controls.committedScene?.material == null, 'wizard does not enable or place a material board');

  if (root) await act(async () => { root!.unmount(); });

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
