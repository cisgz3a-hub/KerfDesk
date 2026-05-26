/**
 * MachineService.startValidatedJob — ticket entry point.
 * Run: npx tsx tests/machine-service-start-validated-job.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort, type SerialPortLike } from '../src/communication/SerialPort';
import {
  type JobProgress,
  type ControllerOutput,
  type ControllerJobTicket,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { getJobLogs } from '../src/core/job/JobLog';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { captureEntitlementPolicySnapshot, hashEntitlementPolicy, hashReferencedMaterialPresets } from '../src/core/job/compileInputHashes';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { buildReplayableGcodeSpool, fromArray } from '../src/core/output/GcodeStreaming';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';
import { makeTestFrameTicket } from './helpers/testFrameTicket';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function flush(ms = 15): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitUntil(cond: () => boolean, timeoutMs: number, stepMs = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await new Promise<void>(r => setTimeout(r, stepMs));
  }
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

function makeTestTicket(scene: ReturnType<typeof createScene>, overrides?: Partial<ValidatedJobTicket>): ValidatedJobTicket {
  const plan = createEmptyPlan('phase2-test');
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 300,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const gcodeLines = ['G0 X1', 'M5'] as const;
  const gcodeText = 'G0 X1\nM5';
  const profile = getActiveProfile();
  const baseTicket: ValidatedJobTicket = {
    ticketId: 'tkt_phase2_test',
    sceneHash: hashSceneForTicket(scene),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    emittedBurnBounds: null,
    burnEnvelopeDivergence: null,
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
    fingerprint: makeTestJobFingerprint({
      scene,
      profile,
      startMode: 'current',
      savedOrigin: null,
    }),
    gcodeLines: [...gcodeLines],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  };
  const merged = { ...baseTicket, ...overrides };
  if (!overrides?.gcodeHash) {
    merged.gcodeHash = hashString(merged.gcodeText);
  }
  return merged;
}

function canvasContextForTicket(t: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: t.machineTransform,
  };
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeMockController(sendJobImpl: (lines: string[]) => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await sendJobImpl([...output.lines]);
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
    sendJob: sendJobImpl,
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
  } as unknown as LaserController;
}

async function run(): Promise<void> {
  console.log('\n=== machine-service startValidatedJob ===\n');
  installMockLocalStorage();

  const scene = createScene(120, 100, 'ticket svc test');
  const profile = createBlankProfile('MachineService Start Test');
  profile.bedWidth = 120;
  profile.bedHeight = 100;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
  const ticket = makeTestTicket(scene);

  const noExecutableOutputCapabilities: ControllerCapabilities = {
    ...grblCapabilities,
    output: {
      ...grblCapabilities.output,
      formats: [],
      jobExecution: 'device-native',
      supportsGcode: false,
      supportsBinary: false,
    },
  };

  {
    const sentBatches: string[][] = [];
    const mock = makeMockController(async lines => {
      sentBatches.push([...lines]);
    });
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    const simLines: string[] = [];
    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: line => {
        simLines.push(line);
      },
      canvasContext: canvasContextForTicket(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });

    assert(sentBatches.length === 1, 'executeJob streams once');
    assert(
      sentBatches[0]?.join('\n') === [...ticket.gcodeLines].join('\n'),
      'executeJob receives ticket gcodeLines',
    );
    // T1-46: notifySimulatorTx is now deferred-and-chunked so sendJob can
    // start streaming first. Wait for the chunked fan-out to drain before
    // asserting that all lines were eventually delivered.
    await waitUntil(() => simLines.length === ticket.gcodeLines.length, 1000);
    assert(
      simLines.join('\n') === [...ticket.gcodeLines].join('\n'),
      'notifySimulatorTx sees each ticket line (after T1-46 deferred fan-out)',
    );
    assert(
      svc.getActiveTicket()?.ticketId === ticket.ticketId,
      'getActiveTicket returns the ticket after startValidatedJob',
    );
    const ctx0 = svc.getActiveJobCanvasContext();
    assert(
      ctx0 != null
      && ctx0.machineTransform === ticket.machineTransform
      && ctx0.canvasMoves.length === 0,
      'getActiveJobCanvasContext holds same machineTransform ref and snapshot',
    );
  }

  {
    const sentBatches: string[][] = [];
    const mock = makeMockController(async lines => {
      sentBatches.push([...lines]);
    });
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    svc.setRecoveryState({
      status: 'alarm',
      alarmCode: 1,
      occurredAt: 0,
      requiresRehome: true,
      inspectionDone: false,
      unlockDone: false,
      rehomeDone: false,
      reframeDone: false,
    });

    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });

    assert(
      sentBatches.length === 1,
      'GRBL4040: stale RecoveryState alone no longer blocks a controller-safe start',
    );
  }

  {
    let executeCount = 0;
    const mock = {
      ...makeMockController(async () => {
        executeCount++;
      }),
      capabilities: noExecutableOutputCapabilities,
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    let message = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: canvasContextForTicket(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    assert(
      /executable job output format/i.test(message),
      'controller without executable output is rejected at service start boundary',
    );
    assert(executeCount === 0, 'capability rejection happens before executeJob');
  }

  {
    const executeCalls: Array<{ outputKind: string; dialect?: string; lines: readonly string[]; ticketId: string }> = [];
    const mock = {
      ...makeMockController(async () => {
        throw new Error('legacy sendJob should not be called');
      }),
      executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
        executeCalls.push({
          outputKind: output.kind,
          dialect: output.kind === 'gcode-lines' ? output.dialect : undefined,
          lines: output.kind === 'gcode-lines' ? output.lines : [],
          ticketId: jobTicket.ticketId,
        });
        return { id: jobTicket.ticketId, startedAt: 123 };
      },
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });

    assert(executeCalls.length === 1, 'startValidatedJob calls executeJob once');
    assert(executeCalls[0]?.outputKind === 'gcode-lines', 'executeJob receives gcode-lines output');
    assert(executeCalls[0]?.dialect === 'grbl', 'executeJob receives GRBL dialect');
    assert(
      executeCalls[0]?.lines.join('\n') === [...ticket.gcodeLines].join('\n'),
      'executeJob receives ticket gcodeLines',
    );
    assert(executeCalls[0]?.ticketId === ticket.ticketId, 'executeJob receives the running ticket id');
  }

  {
    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    let spoolOpenCount = 0;
    const spoolLines = ['G0 X9', 'M5'] as const;
    const spooledTicket = {
      ...ticket,
      gcodeSpool: await buildReplayableGcodeSpool(
        'tkt_phase2_spooled',
        options => {
          spoolOpenCount++;
          return fromArray(spoolLines, options);
        },
      ),
      ticketId: 'tkt_phase2_spooled',
      gcodeText: [...spoolLines].join('\n'),
      gcodeHash: hashString([...spoolLines].join('\n')),
    };
    const spoolOpenCountBeforeStart = spoolOpenCount;
    Object.defineProperty(spooledTicket, 'gcodeLines', {
      enumerable: true,
      get() {
        throw new Error('spooled start path must not read legacy gcodeLines');
      },
    });
    const executeCalls: Array<{
      outputKind: string;
      streamLines: string[];
      ticketId: string;
      spoolOpenCountAtControllerHandoff: number;
    }> = [];
    const simLines: string[] = [];
    const mock = {
      ...makeMockController(async () => {
        throw new Error('legacy sendJob should not be called for a spooled ticket');
      }),
      executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
        const streamLines: string[] = [];
        const spoolOpenCountAtControllerHandoff = spoolOpenCount;
        if ((output as { kind: string }).kind === 'gcode-stream') {
          for await (const chunk of (output as { spool: { open: () => AsyncIterable<{ lines: readonly string[] }> } }).spool.open()) {
            streamLines.push(...chunk.lines);
          }
        }
        executeCalls.push({
          outputKind: output.kind,
          streamLines,
          ticketId: jobTicket.ticketId,
          spoolOpenCountAtControllerHandoff,
        });
        return { id: jobTicket.ticketId, startedAt: 123 };
      },
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket: spooledTicket,
      frameTicket: makeTestFrameTicket(spooledTicket),
      scene,
      machineState: idle,
      notifySimulatorTx: line => simLines.push(line),
      canvasContext: canvasContextForTicket(spooledTicket),
      currentStartMode: spooledTicket.startMode,
      currentSavedOrigin: spooledTicket.savedOrigin,
    });
    await waitUntil(() => simLines.length === spoolLines.length, 1000);

    assert(executeCalls.length === 1, 'spooled ticket calls executeJob once');
    assert(executeCalls[0]?.outputKind === 'gcode-stream', 'spooled ticket passes gcode-stream output');
    assert(
      executeCalls[0]?.streamLines.join('\n') === [...spoolLines].join('\n'),
      'gcode-stream output reopens the ticket spool',
    );
    assert(
      executeCalls[0]?.spoolOpenCountAtControllerHandoff === spoolOpenCountBeforeStart,
      'spooled start path does not replay the spool for job-time estimation before controller handoff',
    );
    assert(simLines.join('\n') === [...spoolLines].join('\n'),
      'spooled ticket simulator fan-out reads from the spool stream');
    assert(
      spoolOpenCount === spoolOpenCountBeforeStart + 2,
      'spooled ticket only reopens the spool for controller streaming and simulator fan-out during start',
    );
    assert(executeCalls[0]?.ticketId === spooledTicket.ticketId, 'gcode-stream keeps the running ticket id');

    const activeTicket = svc.getActiveTicket();
    assert(activeTicket?.gcodeSpool?.lineCount === spoolLines.length,
      'spooled ticket active ticket exposes spool line count');

    const spoolProgress = {
      linesSent: spoolLines.length,
      linesAcknowledged: spoolLines.length,
      totalLines: spoolLines.length,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    await svc.tryFinalizeJobLog(idle, spoolProgress, true, () => {});
    await svc.tryFinalizeJobLog(idle, spoolProgress, false, () => {});
    const logs = await getJobLogs();
    const milestones = logs[0]?.entries.filter(e => e.type === 'milestone') ?? [];
    const startMilestone = milestones.find(m => m.message.includes('Job started:'));
    assert(Boolean(startMilestone?.message.includes(`${spoolLines.length} commands`)),
      'spooled ticket job log uses spool line count');
  }

  {
    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    const mock = makeMockController(async () => {});
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });

    const progress = {
      linesSent: 2,
      linesAcknowledged: 2,
      totalLines: 2,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    const zeroProgress = {
      linesSent: 0,
      linesAcknowledged: 0,
      totalLines: 0,
      percentComplete: 0,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy' as const,
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    await svc.tryFinalizeJobLog(idle, zeroProgress, true, () => {});
    await svc.tryFinalizeJobLog(idle, progress, false, () => {});

    assert(svc.getActiveTicket() === null, 'getActiveTicket null after tryFinalizeJobLog');
    assert(svc.getActiveJobCanvasContext() === null, 'getActiveJobCanvasContext null after tryFinalizeJobLog');

    const logs = await getJobLogs();
    assert(logs.length >= 1, 'job log persisted');
    const milestones = logs[0]?.entries.filter(e => e.type === 'milestone') ?? [];
    const startMilestone = milestones.find(m => m.message.includes('Job started:'));
    assert(
      Boolean(startMilestone?.message.includes(ticket.ticketId)),
      'start milestone includes ticketId',
    );
  }

  {
    let executeCount = 0;
    const mock = {
      ...makeMockController(async () => {
        executeCount++;
      }),
      getPlacementUncertain: () => true,
      getPlacementUncertainReason: () => 'wcs_query_error',
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    let message = '';
    try {
      await svc.startValidatedJob({
        ticket,
        frameTicket: makeTestFrameTicket(ticket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: canvasContextForTicket(ticket),
        currentStartMode: ticket.startMode,
        currentSavedOrigin: ticket.savedOrigin,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    assert(
      /work-coordinate state/i.test(message),
      'startValidatedJob blocks when controller placement is uncertain',
    );
    assert(
      /wcs_query_error/.test(message),
      'placement-uncertain error includes controller reason',
    );
    assert(executeCount === 0, 'placement-uncertain block prevents executeJob');
  }

  {
    let executeCount = 0;
    const savedOrigin = { x: 10, y: 20 };
    const savedOriginTicket = makeTestTicket(scene, {
      ticketId: 'tkt_saved_origin_drift',
      startMode: 'savedOrigin',
      savedOrigin,
      fingerprint: makeTestJobFingerprint({
        scene,
        profile: getActiveProfile(),
        startMode: 'savedOrigin',
        savedOrigin,
      }),
    });
    const mock = {
      ...makeMockController(async () => {
        executeCount++;
      }),
      requestWorkOffsets: async () => ({ x: 0, y: 0, z: 0 }),
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    svc.setSavedOriginG54Snapshot({ x: 10, y: 20, z: 0 });

    let message = '';
    try {
      await svc.startValidatedJob({
        ticket: savedOriginTicket,
        frameTicket: makeTestFrameTicket(savedOriginTicket),
        scene,
        machineState: idle,
        notifySimulatorTx: () => {},
        canvasContext: canvasContextForTicket(savedOriginTicket),
        currentStartMode: 'savedOrigin',
        currentSavedOrigin: savedOrigin,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    assert(
      /saved origin/i.test(message) && /work coordinate|G54|drift/i.test(message),
      'saved-origin start rejects when live G54 no longer matches the Set Origin snapshot',
    );
    assert(executeCount === 0, 'saved-origin G54 drift rejection prevents executeJob');
  }

  {
    let executeCount = 0;
    const savedOrigin = { x: 10, y: 20 };
    const savedOriginTicket = makeTestTicket(scene, {
      ticketId: 'tkt_saved_origin_verified',
      startMode: 'savedOrigin',
      savedOrigin,
      fingerprint: makeTestJobFingerprint({
        scene,
        profile: getActiveProfile(),
        startMode: 'savedOrigin',
        savedOrigin,
      }),
    });
    const mock = {
      ...makeMockController(async () => {
        executeCount++;
      }),
      requestWorkOffsets: async () => ({ x: 10, y: 20, z: 0 }),
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    svc.setSavedOriginG54Snapshot({ x: 10, y: 20, z: 0 });

    await svc.startValidatedJob({
      ticket: savedOriginTicket,
      frameTicket: makeTestFrameTicket(savedOriginTicket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(savedOriginTicket),
      currentStartMode: 'savedOrigin',
      currentSavedOrigin: savedOrigin,
    });

    assert(executeCount === 1, 'verified saved-origin G54 still allows executeJob');
  }

  {
    let executeCount = 0;
    const mock = {
      ...makeMockController(async () => {
        executeCount++;
      }),
      getPlacementUncertain: () => true,
      getPlacementUncertainReason: () => 'missing_g54',
    } as unknown as LaserController;
    const controllerRef = { current: mock } as { current: LaserController };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);

    await svc.startValidatedJob({
      ticket,
      frameTicket: makeTestFrameTicket(ticket),
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
      allowUnverifiedWcsStart: true,
    });

    assert(
      executeCount === 1,
      'profile compatibility allows start when WCS proof is unavailable',
    );
  }

  {
    const port = new MockSerialPort();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush(30);

    const controllerRef = { current: ctrl as unknown as LaserController };
    const portRef = { current: port as SerialPortLike };
    const svc = new MachineService(controllerRef, portRef);

    const baseTicket = makeTestTicket(scene, {
      gcodeLines: ['G0 X1 Y1', 'M5'],
      gcodeText: 'G0 X1 Y1\nM5',
    });
    const machineInfo = ctrl.getMachineInfo();
    const reportedBed =
      machineInfo.bedWidth > 0 && machineInfo.bedHeight > 0
        ? { width: machineInfo.bedWidth, height: machineInfo.bedHeight }
        : null;
    const reportedAccel =
      machineInfo.maxAccelX > 0 && machineInfo.maxAccelY > 0
        ? Math.min(machineInfo.maxAccelX, machineInfo.maxAccelY)
        : (machineInfo.maxAccelX > 0 ? machineInfo.maxAccelX : (machineInfo.maxAccelY > 0 ? machineInfo.maxAccelY : null));
    const t: ValidatedJobTicket = {
      ...baseTicket,
      fingerprint: makeTestJobFingerprint({
        scene,
        profile: getActiveProfile(),
        startMode: baseTicket.startMode,
        savedOrigin: baseTicket.savedOrigin,
        controllerMaxSpindle: ctrl.maxSpindle,
        machineBedFromController: reportedBed,
        controllerAccelMmPerS2: reportedAccel,
      }),
    };

    await svc.startValidatedJob({
      ticket: t,
      frameTicket: makeTestFrameTicket(t),
      scene,
      machineState: ctrl.state,
      notifySimulatorTx: () => {},
      canvasContext: canvasContextForTicket(t),
      currentStartMode: t.startMode,
      currentSavedOrigin: t.savedOrigin,
    });

    await waitUntil(() => !ctrl.isJobRunning, 8000);

    assert(
      svc.getActiveTicket()?.ticketId === t.ticketId,
      'GrblController path: active ticket still set after job completes (until finalize)',
    );

    const progress = {
      linesSent: 2,
      linesAcknowledged: 2,
      totalLines: 2,
      percentComplete: 100,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy',
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    const zeroProgress = {
      linesSent: 0,
      linesAcknowledged: 0,
      totalLines: 0,
      percentComplete: 0,
      elapsedMs: 0,
      bufferFill: 0,
      healthStatus: 'healthy' as const,
      ackRateHz: null,
      expectedAckRateHz: null,
    } as JobProgress;
    installMockLocalStorage();
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];

    await svc.tryFinalizeJobLog(idle, zeroProgress, true, () => {});
    await svc.tryFinalizeJobLog(ctrl.state, progress, false, () => {});
    assert(svc.getActiveTicket() === null, 'finalize clears ticket (Grbl path)');

    await ctrl.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
