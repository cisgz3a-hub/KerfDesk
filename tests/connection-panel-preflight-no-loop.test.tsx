/**
 * ConnectionPanelMain preflight sync should not enqueue state updates for
 * equivalent summaries during parent prop churn.
 * Run: npx tsx tests/connection-panel-preflight-no-loop.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type LaserController,
  type MachineState,
  type OperationResult,
} from '../src/controllers/ControllerInterface';
import { ConnectionPanelMain } from '../src/ui/components/ConnectionPanelMain';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function flush(ms = 0): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function idleMachineState(): MachineState {
  return {
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };
}

function makeController(): LaserController {
  const ok = async (): Promise<OperationResult> => ({ ok: true });
  return {
    protocolName: 'mock',
    state: idleMachineState(),
    isJobRunning: false,
    operations: {
      jog: ok,
      home: ok,
      unlockAlarm: ok,
      setWorkOriginAtCurrentPosition: ok,
      resetWcsToMachineOrigin: ok,
      testFire: ok,
      frame: async () => ({ ok: true, commands: [] }),
      laserOff: ok,
      pauseJob: ok,
      resumeJob: ok,
      stopJob: ok,
      emergencyStop: ok,
    },
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
  } as LaserController;
}

function PanelHarness(props: {
  scene: Scene;
  machineState: MachineState;
  machineService: MachineService;
  controller: LaserController;
  portRef: MutableRefObject<SerialPortLike | null>;
  controllerRef: MutableRefObject<LaserController | null>;
}): React.ReactElement {
  const { scene, machineState, machineService, controller, portRef, controllerRef } = props;
  const [messages, setMessages] = useState<string[]>([]);
  const activeProfile = getActiveProfile();
  const coordinatorSimulatorNotifyRef = useRef<(line: string) => void>(() => {});
  const executionCoordinator = useMemo(
    () =>
      new ExecutionCoordinator({
        machineService,
        controllerRef,
        notifySimulatorRef: coordinatorSimulatorNotifyRef,
      }),
    [machineService, controllerRef],
  );

  return React.createElement(ConnectionPanelMain, {
    controller,
    portRef,
    executionCoordinator,
    coordinatorSimulatorNotifyRef,
    machineState,
    jobProgress: null as JobProgress | null,
    scene,
    gcode: null,
    bedWidth: 400,
    bedHeight: 300,
    machinePlanBounds: null,
    compiledJobTicket: null,
    lastGcodeCompileResult: null,
    onClose: () => {},
    activeProfile,
    productionMode: false,
    showAlert: async () => {},
    showConfirm: async () => true,
    showPrompt: async () => null,
    onSceneCommit: () => {},
    startMode: 'current',
    savedOrigin: null,
    originCorner: activeProfile?.originCorner ?? 'front-left',
    machinePosition: null,
    onSelectMode: () => {},
    onSaveOrigin: () => {},
    gcodeStale: false,
    machineService,
    outcomeReplaySection: null,
    messages,
    appendMessage: (m: string) => {
      setMessages(prev => [...prev, m]);
    },
    replaceMessages: (next: string[] | ((prev: string[]) => string[])) => {
      setMessages(prev => (typeof next === 'function' ? next(prev) : next));
    },
    clearMessages: () => {
      setMessages([]);
    },
    isSimulator: true,
    setSimulator: () => {},
  });
}

let root: Root | null = null;

async function run(): Promise<void> {
  console.log('\n=== connection-panel-preflight-no-loop ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('PreflightNoLoop');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const controller = makeController();
  const controllerRef = { current: controller } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const machineService = new MachineService(controllerRef, portRef);
  const errLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errLogs.push(args.map(String).join(' '));
    originalError(...args);
  };

  try {
    const container = win.document.getElementById('root')!;
    if (root) root.unmount();
    root = createRoot(container);

    for (let i = 0; i < 75; i++) {
      await act(async () => {
        root!.render(
          React.createElement(PanelHarness, {
            scene: createScene(400, 300, 'EquivalentEmptyScene'),
            machineState: idleMachineState(),
            machineService,
            controller,
            portRef,
            controllerRef,
          }),
        );
        await flush();
      });
    }
  } finally {
    console.error = originalError;
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
  }

  assert(true, 'test churned equivalent preflight inputs 75 times');
  assert(
    !errLogs.some(m => m.includes('Maximum update depth exceeded')),
    'no React maximum update depth error during equivalent preflight churn',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
