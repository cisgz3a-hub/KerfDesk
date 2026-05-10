/**
 * ConnectionPanelMain.handleStartJob calls startValidatedJob with the compile
 * ticket.
 * Run: npx tsx tests/ui-start-job-uses-ticket.test.tsx
 */
import './e2e/helpers/e2eDeterministicIds';

import { JSDOM } from 'jsdom';
import React, { act, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { compileGcode, type CompileGcodeResult } from '../src/app/PipelineService';
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { ConnectionPanelMain } from '../src/ui/components/ConnectionPanelMain';
import {
  type JobProgress,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { type Scene } from '../src/core/scene/Scene';
import type { ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import type { AABB } from '../src/core/types';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
}
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

// T1-118: head positioned mid-bed so a 40x30 rect at canvas (20, 20)
// frames within machine bounds in startMode='current' on front-left
// origin. Y-flip + work-relative coordinates produce corners at
// machine X∈[head.x, head.x+40], Y∈[head.y-30, head.y]; we need
// head.y >= 30 and head.x+40 <= bedWidth and head.y <= bedHeight.
const idle: MachineState = {
  status: 'idle',
  position: { x: 100, y: 100, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(): LaserController {
  // T1-118: mock must provide `operations` so ExecutionCoordinator's
  // frameSafe / startValidatedJob path can run end-to-end. Pre-T1-118
  // the test's mock omitted operations entirely; the Frame click then
  // crashed inside `ctrl.operations.frame()` (TypeError reading
  // 'frame'), `hasFramed` never flipped to true, the Start button
  // stayed disabled, and every downstream assertion failed including
  // a final crash on `arg0!.ticket.gcodeLines.length`. The test was
  // skipped instead of fixed; this is the fix.
  const successOp = async () => ({ ok: true as const });
  const successFrame = async () => ({ ok: true as const });
  const operations = {
    jog: successOp,
    home: successOp,
    unlockAlarm: successOp,
    setWorkOriginAtCurrentPosition: successOp,
    resetWcsToMachineOrigin: successOp,
    testFire: successOp,
    frame: successFrame,
    laserOff: successOp,
    pauseJob: successOp,
    resumeJob: successOp,
    stopJob: successOp,
    emergencyStop: successOp,
  };
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    // T1-118: mock must report a positive maxSpindle so preflight's
    // MACHINE_MAXSPINDLE_UNKNOWN rule passes. 1000 matches GRBL's
    // default $30.
    maxSpindle: 1000,
    operations,
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
    // T1-118: mock must expose firmware-capability getters so
    // preflight's MACHINE_LASER_MODE_UNKNOWN / MACHINE_HOMING_UNKNOWN
    // rules don't block. true = laser mode enabled ($32=1); false =
    // homing disabled (skips MACHINE_HOMING_REQUIRED).
    getFirmwareLaserModeEnabled: () => true,
    getFirmwareHomingCycleEnabled: () => false,
    getPlacementUncertain: () => false,
    getUnsafeAtConnect: () => null,
  } as unknown as LaserController;
}

type StartArgs = Parameters<MachineService['startValidatedJob']>[0];

function panelCanvasContext(c: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: c.canvasMoves,
    canvasPlanBounds: c.canvasPlanBounds,
    machineTransform: c.machineTransform,
  };
}

function PanelHarness(props: {
  scene: Scene;
  gcode: string | null;
  compiledJobTicket: ValidatedJobTicket | null;
  lastGcodeCompileResult: CompileGcodeResult | null;
  machinePlanBounds: AABB | null;
  machineService: MachineService;
  controller: LaserController;
  portRef: MutableRefObject<SerialPortLike | null>;
  controllerRef: MutableRefObject<LaserController | null>;
}): React.ReactElement {
  const {
    scene,
    gcode,
    compiledJobTicket,
    lastGcodeCompileResult,
    machinePlanBounds,
    machineService,
    controller,
    portRef,
    controllerRef,
  } = props;
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
    machineState: idle,
    jobProgress: null as JobProgress | null,
    scene,
    gcode,
    bedWidth: 400,
    bedHeight: 300,
    machinePlanBounds,
    compiledJobTicket,
    lastGcodeCompileResult,
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
  console.log('\n=== ui-start-job-uses-ticket ===\n');

  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('UiTicketStart');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'UiTicket');
  const scene = addObject(s0, createRect(s0.layers[0].id, 20, 20, 40, 30));
  // T1-118: pass the active profile so the ticket carries a profile
  // hash that matches what the panel reads from getActiveProfile() at
  // start-time. Pre-fix the call passed `null` for the profile arg →
  // ticket.profileHash = hash('no-profile') → runtime mismatch warning
  // "[ticket] profile hash mismatch" fired even though the test was
  // running with a single profile end to end.
  const compiled = await compileGcode(scene, 'current', null, null, 'grbl', null, null, getActiveProfile());
  if (!compiled) {
    console.error('compileGcode returned null');
    process.exit(1);
  }

  const gcodeProp = `${compiled.gcode}\n; INJECTED_UI_PROP_ONLY`;
  const ticket = compiled.ticket;

  const controller = makeController();
  const controllerRef = { current: controller } as MutableRefObject<LaserController>;
  const portRef = { current: null } as MutableRefObject<SerialPortLike | null>;
  const machineService = new MachineService(controllerRef, portRef);

  const startCalls: StartArgs[] = [];
  const realStart = machineService.startValidatedJob.bind(machineService);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (machineService as any).startValidatedJob = async (args: StartArgs) => {
    startCalls.push(args);
    return realStart(args);
  };

  const container = win.document.getElementById('root')!;
  if (root) root.unmount();
  root = createRoot(container);

  await act(async () => {
    root!.render(
      React.createElement(PanelHarness, {
        scene,
        gcode: gcodeProp,
        compiledJobTicket: ticket,
        lastGcodeCompileResult: compiled,
        machinePlanBounds: compiled.machinePlanBounds,
        machineService,
        controller,
        portRef,
        controllerRef,
      }),
    );
    await flush(50);
  });

  // T1-59: Start now requires Frame first. Click the Frame button and let the
  // simulator-driven frameSafe complete before asserting the Start button enables.
  // frameSafe streams frame-corner plus center-mark gcode lines with a 50ms gap
  // between each, then waits for idle, so wait long enough for the worst case.
  const frameBtn = container.querySelector(
    '[data-testid="connection-frame"]',
  ) as HTMLButtonElement | null;
  assert(frameBtn != null, 'frame button present');
  await act(async () => {
    frameBtn!.click();
    await flush(1400);
  });

  const btn = container.querySelector('[data-testid="connection-start-job"]') as HTMLButtonElement | null;
  assert(btn != null, 'start button present');
  if (!btn) {
    console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }
  assert(btn.disabled === false, 'start enabled (simulator + idle + preflight ok + framed)');

  await act(async () => {
    btn.click();
    await flush(200);
  });

  assert(startCalls.length === 1, 'startValidatedJob called once');
  const arg0 = startCalls[0];
  assert(arg0?.ticket === ticket, 'same ticket reference as compile');
  const expectedCtx = panelCanvasContext(compiled);
  assert(
    arg0?.canvasContext.canvasMoves === expectedCtx.canvasMoves
    && arg0?.canvasContext.machineTransform === expectedCtx.machineTransform,
    'startValidatedJob receives same canvas snapshot refs as compile (T1-11 v2)',
  );
  assert(
    !arg0?.ticket.gcodeLines.some(l => l.includes('INJECTED_UI_PROP_ONLY')),
    'streamed lines come from ticket, not gcode prop split',
  );
  const fromPropOnly = gcodeProp
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  assert(
    fromPropOnly.length !== arg0!.ticket.gcodeLines.length,
    'gcode prop has an extra injected line vs ticket.gcodeLines',
  );

  if (root) {
    root.unmount();
    root = null;
  }

  // ─── Scenario 2: missing ticket → start blocked ──────────────────
  // T1-118: re-mount the panel with `compiledJobTicket: null` (and a
  // matching `gcode: null` since the prop usually arrives together)
  // and verify the Start button stays disabled. Pre-T1-118 the second
  // scenario in this file asserted ticket-driven behavior but crashed
  // earlier and was skipped wholesale; this is the closing contract:
  // the UI can't start without a valid ticket.
  const controller2 = makeController();
  const controllerRef2 = { current: controller2 } as MutableRefObject<LaserController>;
  const portRef2 = { current: null } as MutableRefObject<SerialPortLike | null>;
  const machineService2 = new MachineService(controllerRef2, portRef2);
  const startCalls2: StartArgs[] = [];
  const realStart2 = machineService2.startValidatedJob.bind(machineService2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (machineService2 as any).startValidatedJob = async (args: StartArgs) => {
    startCalls2.push(args);
    return realStart2(args);
  };
  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(PanelHarness, {
        scene,
        gcode: null,
        compiledJobTicket: null,
        lastGcodeCompileResult: null,
        machinePlanBounds: null,
        machineService: machineService2,
        controller: controller2,
        portRef: portRef2,
        controllerRef: controllerRef2,
      }),
    );
    await flush(50);
  });
  const btn2 = container.querySelector('[data-testid="connection-start-job"]') as HTMLButtonElement | null;
  assert(btn2 != null, 'scenario 2: start button present');
  assert(btn2?.disabled === true, 'scenario 2: start disabled when compiledJobTicket is null');
  assert(startCalls2.length === 0, 'scenario 2: startValidatedJob never invoked without a ticket');
  if (root) {
    root.unmount();
    root = null;
  }

  // ─── Scenario 3: stale gcode → start blocked ─────────────────────
  // T1-118: with a live ticket but `gcodeStale: true`, the panel must
  // refuse to start. PanelHarness pins `gcodeStale: false` so re-mount
  // with a wrapper that flips it.
  const controller3 = makeController();
  const controllerRef3 = { current: controller3 } as MutableRefObject<LaserController>;
  const portRef3 = { current: null } as MutableRefObject<SerialPortLike | null>;
  const machineService3 = new MachineService(controllerRef3, portRef3);
  const startCalls3: StartArgs[] = [];
  const realStart3 = machineService3.startValidatedJob.bind(machineService3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (machineService3 as any).startValidatedJob = async (args: StartArgs) => {
    startCalls3.push(args);
    return realStart3(args);
  };

  function StaleHarness(props: {
    scene: Scene;
    gcode: string | null;
    compiledJobTicket: ValidatedJobTicket | null;
    lastGcodeCompileResult: CompileGcodeResult | null;
    machinePlanBounds: AABB | null;
    machineService: MachineService;
    controller: LaserController;
    portRef: MutableRefObject<SerialPortLike | null>;
    controllerRef: MutableRefObject<LaserController | null>;
  }): React.ReactElement {
    const [messages, setMessages] = useState<string[]>([]);
    const activeProfile = getActiveProfile();
    const coordinatorSimulatorNotifyRef = useRef<(line: string) => void>(() => {});
    const executionCoordinator = useMemo(
      () =>
        new ExecutionCoordinator({
          machineService: props.machineService,
          controllerRef: props.controllerRef,
          notifySimulatorRef: coordinatorSimulatorNotifyRef,
        }),
      [],
    );
    return React.createElement(ConnectionPanelMain, {
      controller: props.controller,
      portRef: props.portRef,
      executionCoordinator,
      coordinatorSimulatorNotifyRef,
      machineState: idle,
      jobProgress: null as JobProgress | null,
      scene: props.scene,
      gcode: props.gcode,
      bedWidth: 400,
      bedHeight: 300,
      machinePlanBounds: props.machinePlanBounds,
      compiledJobTicket: props.compiledJobTicket,
      lastGcodeCompileResult: props.lastGcodeCompileResult,
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
      gcodeStale: true,
      machineService: props.machineService,
      outcomeReplaySection: null,
      messages,
      appendMessage: (m: string) => setMessages((p) => [...p, m]),
      replaceMessages: (n) => setMessages((p) => (typeof n === 'function' ? n(p) : n)),
      clearMessages: () => setMessages([]),
      isSimulator: true,
      setSimulator: () => {},
    });
  }

  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(StaleHarness, {
        scene,
        gcode: gcodeProp,
        compiledJobTicket: ticket,
        lastGcodeCompileResult: compiled,
        machinePlanBounds: compiled.machinePlanBounds,
        machineService: machineService3,
        controller: controller3,
        portRef: portRef3,
        controllerRef: controllerRef3,
      }),
    );
    await flush(50);
  });
  const btn3 = container.querySelector('[data-testid="connection-start-job"]') as HTMLButtonElement | null;
  assert(btn3 != null, 'scenario 3: start button present');
  assert(btn3?.disabled === true, 'scenario 3: start disabled when gcodeStale=true (even with valid ticket)');
  assert(startCalls3.length === 0, 'scenario 3: startValidatedJob never invoked when gcode is stale');
  if (root) {
    root.unmount();
    root = null;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
