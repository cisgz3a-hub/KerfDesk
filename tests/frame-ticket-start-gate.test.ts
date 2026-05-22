/**
 * T1-251: service-level FrameTicket gate.
 *
 * The UI can recommend or require framing, but the machine service is
 * the final authority before bytes stream. A job start must therefore
 * carry either proof that the exact compiled ticket was framed, or an
 * explicit "start without framing" override that can be logged.
 *
 * Run: npx tsx tests/frame-ticket-start-gate.test.ts
 */
import { type ActiveJobCanvasContext } from '../src/app/ActiveJobCanvasContext';
import { MachineService } from '../src/app/MachineService';
import {
  InMemoryMachineEventLedger,
  _setMachineEventLedgerForTest,
} from '../src/app/MachineEventLedger';
import {
  createFramedStartTicket,
  createUnframedStartOverrideTicket,
} from '../src/app/FrameState';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type ControllerJobTicket,
  type ControllerOutput,
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { type ValidatedJobTicket } from '../src/core/job/ValidatedJobTicket';
import {
  captureEntitlementPolicySnapshot,
  hashEntitlementPolicy,
  hashReferencedMaterialPresets,
} from '../src/core/job/compileInputHashes';
import { hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { createScene } from '../src/core/scene/Scene';
import { makeTestJobFingerprint } from './helpers/testJobFingerprint';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
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

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const key of Object.keys(memoryStore)) delete memoryStore[key];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(memoryStore)[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function installKnownBedProfile(): void {
  const profile = createBlankProfile('Frame Ticket Gate Profile');
  profile.bedWidth = 120;
  profile.bedHeight = 100;
  profile.homeCorner = 'front-left';
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

function makeTicket(
  scene: ReturnType<typeof createScene>,
  overrides?: Partial<ValidatedJobTicket>,
): ValidatedJobTicket {
  const plan = createEmptyPlan('frame-ticket');
  const machineTransform = {
    plan,
    offsetX: 0,
    offsetY: 0,
    flipReferenceY: 300,
    flipY: true,
    returnPosition: { x: 0, y: 0 },
  };
  const gcodeText = 'G0 X1\nM5';
  const profile = getActiveProfile();
  const ticket: ValidatedJobTicket = {
    ticketId: 'tkt_frame_gate',
    sceneHash: hashSceneForTicket(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcodeText),
    fingerprint: makeTestJobFingerprint({
      scene,
      profile,
      startMode: 'current',
      savedOrigin: null,
    }),
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    emittedBurnBounds: null,
    burnEnvelopeDivergence: null,
    gcodeLines: ['G0 X1', 'M5'],
    gcodeText,
    machinePlanBounds: { ...plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode: 'current',
    savedOrigin: null,
    createdAt: Date.now(),
  };
  const merged = { ...ticket, ...overrides };
  if (!overrides?.gcodeHash) {
    merged.gcodeHash = hashString(merged.gcodeText);
  }
  return merged;
}

function ctxFor(ticket: ValidatedJobTicket): ActiveJobCanvasContext {
  return {
    canvasMoves: [],
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    machineTransform: ticket.machineTransform,
  };
}

function makeController(onExecute: () => Promise<void>): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, jobTicket: ControllerJobTicket) => {
      if (output.kind !== 'gcode-lines') throw new Error('mock only supports gcode-lines');
      await onExecute();
      return { id: jobTicket.ticketId, startedAt: 123 };
    },
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
  } as unknown as LaserController;
}

async function expectStartRejects(
  svc: MachineService,
  args: Parameters<MachineService['startValidatedJob']>[0] | Record<string, unknown>,
): Promise<string> {
  try {
    await svc.startValidatedJob(args as Parameters<MachineService['startValidatedJob']>[0]);
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  return '';
}

void (async () => {
  console.log('\n=== frame-ticket service start gate ===\n');
  installMockLocalStorage();
  installKnownBedProfile();
  const scene = createScene(120, 100, 'frame-ticket');
  const ticket = makeTicket(scene);

  {
    let executeCalls = 0;
    const controller = makeController(async () => {
      executeCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );

    const message = await expectStartRejects(svc, {
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
    });
    assert(/frame proof|frame.*missing|start without framing/i.test(message),
      'missing frame proof rejects before streaming');
    assert(executeCalls === 0, 'missing frame proof never reaches executeJob');
  }

  {
    let executeCalls = 0;
    const controller = makeController(async () => {
      executeCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    const staleFrameTicket = createFramedStartTicket({
      jobTicketId: ticket.ticketId,
      fingerprint: { ...ticket.fingerprint, startMode: 'absolute' },
      machineBounds: ticket.machinePlanBounds,
      mode: 'safe',
      framedAt: 1,
    });

    const message = await expectStartRejects(svc, {
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
      frameTicket: staleFrameTicket,
    });
    assert(/frame.*stale|fingerprint|startMode/i.test(message),
      'stale frame fingerprint rejects before streaming');
    assert(executeCalls === 0, 'stale frame proof never reaches executeJob');
  }

  {
    const ledger = new InMemoryMachineEventLedger();
    _setMachineEventLedgerForTest(ledger);
    let executeCalls = 0;
    const controller = makeController(async () => {
      executeCalls++;
    });
    const svc = new MachineService(
      { current: controller } as { current: LaserController },
      { current: null } as { current: SerialPortLike | null },
    );
    await svc.startValidatedJob({
      ticket,
      scene,
      machineState: idle,
      notifySimulatorTx: () => {},
      canvasContext: ctxFor(ticket),
      currentStartMode: ticket.startMode,
      currentSavedOrigin: ticket.savedOrigin,
      frameTicket: createUnframedStartOverrideTicket({
        jobTicketId: ticket.ticketId,
        fingerprint: ticket.fingerprint,
        reason: 'test explicit unframed start',
        grantedAt: 2,
      }),
    });
    const overrideEvents = ledger.query({
      kinds: new Set(['unframed-start-override' as const]),
    });
    assert(executeCalls === 1, 'explicit unframed override allows streaming');
    assert(overrideEvents.length === 1, 'unframed override is logged in machine ledger');
    assert(
      overrideEvents[0]?.kind === 'unframed-start-override'
        && overrideEvents[0].ticketId === ticket.ticketId
        && /explicit unframed/.test(overrideEvents[0].reason),
      'ledger event carries ticket id and override reason',
    );
    _setMachineEventLedgerForTest(null);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
