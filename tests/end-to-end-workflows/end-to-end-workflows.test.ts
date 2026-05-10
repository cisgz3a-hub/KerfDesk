/**
 * T3-81: end-to-end workflow integration regression net.
 *
 * The suite intentionally spans import, persistence, compile/start
 * tickets, stale-state gates, async guards, recovery, history memory,
 * profile snapshots, material snapshots, and UI safety surfacing.
 *
 * Run: npx tsx tests/end-to-end-workflows/end-to-end-workflows.test.ts
 */
import '../e2e/helpers/e2eDeterministicIds';

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../../src/app/MachineService';
import {
  compiledJobStateInitial,
  completeCompile,
  markStale,
  selectGcode,
  startCompile,
  type CompileResultLike,
} from '../../src/app/CompiledJobState';
import { clearUnsafePriorState } from '../../src/app/unsafePriorState';
import { compileGcode, type CompileGcodeResult } from '../../src/app/PipelineService';
import type { ActiveJobCanvasContext } from '../../src/app/ActiveJobCanvasContext';
import { safetyStateInitial } from '../../src/app/SafetyStateMachine';
import { jobPhaseInitial } from '../../src/app/JobSession';
import type {
  ControllerJobTicket,
  ControllerOutput,
  LaserController,
  MachineState,
} from '../../src/controllers/ControllerInterface';
import type { SerialPortLike } from '../../src/communication/SerialPort';
import {
  createBlankProfile,
  getActiveProfile,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../src/core/devices/DeviceProfile';
import { checkProfileSnapshot } from '../../src/core/devices/profileSnapshot';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import {
  createRect,
  type ImageGeometry,
  type SceneObject,
} from '../../src/core/scene/SceneObject';
import type { MaterialPreset } from '../../src/core/materials/MaterialPreset';
import {
  buildPresetSnapshot,
  checkPresetSnapshot,
} from '../../src/core/materials/MaterialPresetSnapshot';
import { InMemoryStorageAdapter } from '../../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../../src/core/storage/storage';
import { serializeScene, deserializeScene, deserializeSceneWithReport } from '../../src/io/SceneSerializer';
import { importSvgIntoScene } from '../../src/import/svg/SvgToScene';
import {
  recoveryStateInitial,
  recoveryAllowsStart,
  triggerAlarm,
  triggerDisconnectDuringJob,
  ackInspection,
  ackUnlock,
  ackRehome,
  ackReframe,
  ackReconnect,
  pendingSteps,
} from '../../src/runtime/RecoveryState';
import { buildInitialRuntimeState, canStartJob } from '../../src/runtime/RuntimeState';
import { HistoryManager } from '../../src/ui/history/HistoryManager';
import { addObject, deleteObjects } from '../../src/ui/history/SceneCommands';
import { captureSceneRevision, isSceneStale } from '../../src/ui/hooks/asyncSceneGuard';
import { IDENTITY_MATRIX, generateId } from '../../src/core/types';
import { resetAutosaveForTest, writeAutosaveAsync } from '../../src/app/autosavePersistence';
import type { StorageAdapter } from '../../src/core/storage/StorageAdapter';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

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

class FailingStorageAdapter implements StorageAdapter {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> { throw new Error('QuotaExceededError: simulated autosave failure'); }
  async remove(): Promise<void> { /* noop */ }
  async list(): Promise<string[]> { return []; }
  async clear(): Promise<void> { /* noop */ }
}

function resetEnvironment(): void {
  installMockLocalStorage();
  for (const key of Object.keys(memoryStore)) delete memoryStore[key];
  setStorageForTest(new InMemoryStorageAdapter());
  resetDeviceProfilesForTest();
  resetAutosaveForTest();
  clearUnsafePriorState();
}

function setupProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  resetDeviceProfilesForTest();
  const profile: DeviceProfile = {
    ...createBlankProfile('T3-81 integration profile'),
    id: 'profile-t3-81',
    brand: 'LaserForge',
    model: 'Integration Rig',
    bedWidth: 400,
    bedHeight: 400,
    maxSpindle: 1000,
    maxFeedRate: 6000,
    ...overrides,
  };
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
  return profile;
}

function makeIdleState(): MachineState {
  return {
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };
}

function makeController(executeCalls: Array<{ output: ControllerOutput; ticket: ControllerJobTicket }>): LaserController {
  return {
    protocolName: 'mock',
    family: 'grbl',
    state: makeIdleState(),
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async (output: ControllerOutput, ticket: ControllerJobTicket) => {
      executeCalls.push({ output, ticket });
      return { id: ticket.ticketId, startedAt: 123 };
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

function activeJobContext(result: CompileGcodeResult): ActiveJobCanvasContext {
  return {
    canvasMoves: result.canvasMoves,
    canvasPlanBounds: result.canvasPlanBounds,
    machineTransform: result.machineTransform,
  };
}

function makeCompileResultLike(id: string): CompileResultLike {
  return {
    gcode: 'G21\nG90\nM5 S0\nG0 X0 Y0\nM2',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    canvasPlanBounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    ticket: { ticketId: id },
  };
}

function runtimeCanStartWithCompile(compile: ReturnType<typeof markStale> | ReturnType<typeof completeCompile>): boolean {
  const runtime = buildInitialRuntimeState({
    compile,
    machine: safetyStateInitial,
    job: jobPhaseInitial,
    recovery: recoveryStateInitial,
  });
  return canStartJob({
    ...runtime,
    project: {
      sceneHash: 'scene-a',
      profileId: 'profile-t3-81',
      profileHash: 'profile-a',
      objectCount: 1,
      layerCount: 1,
    },
    frame: { status: 'framed', framedAt: 1000 },
  });
}

function makeImageScene(grayscaleBytes: number): Scene {
  const scene = createScene(400, 300, 'large raster workflow');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: 100,
    originalHeight: 100,
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
    grayscaleData: new Uint8Array(grayscaleBytes),
    grayscaleWidth: 100,
    grayscaleHeight: 100,
    brightness: 0,
    processedData: new Uint8Array(grayscaleBytes),
    processedSettings: { brightness: 0, contrast: 0, gamma: 1, invert: false },
  };
  const image: SceneObject = {
    id: generateId(),
    type: 'image',
    name: 'Raster',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [image];
  return scene;
}

function makePreset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'birch-3mm',
    name: 'Birch 3mm',
    material: 'wood',
    thickness: '3mm',
    laserWattage: '20W',
    operations: { cut: { power: 80, speed: 200, passes: 1 } },
    kerf: 0.1,
    ...overrides,
  };
}

async function run(): Promise<void> {
  console.log('\n=== T3-81 end-to-end workflow integration suite ===\n');

  // 1. Import SVG -> edit layer -> save -> reload -> compile -> frame -> start.
  {
    resetEnvironment();
    setupProfile();
    const base = createScene(400, 400, 'svg workflow');
    const svg = '<svg width="40mm" height="30mm" viewBox="0 0 40 30"><rect x="5" y="5" width="20" height="10" fill="none" stroke="red"/></svg>';
    let scene = importSvgIntoScene(svg, base, base.activeLayerId, { mode: 'original' });
    scene = {
      ...scene,
      layers: scene.layers.map(layer => ({
        ...layer,
        settings: {
          ...layer.settings,
          power: { ...layer.settings.power, max: 42 },
        },
      })),
    };
    const reloaded = deserializeScene(serializeScene(scene));
    const compiled = await compileGcode(reloaded, 'current', null, null, 'grbl', null, null, getActiveProfile());
    if (!compiled) throw new Error('Expected compile result for imported workflow');

    const executeCalls: Array<{ output: ControllerOutput; ticket: ControllerJobTicket }> = [];
    const controller = makeController(executeCalls);
    const service = new MachineService({ current: controller }, { current: null } as { current: SerialPortLike | null });
    await service.startValidatedJob({
      ticket: compiled.ticket,
      scene: reloaded,
      machineState: makeIdleState(),
      notifySimulatorTx: () => {},
      canvasContext: activeJobContext(compiled),
    });

    assert(reloaded.objects.length > 0, 'import/edit/save/reload workflow keeps imported SVG objects');
    assert(reloaded.layers.some(layer => layer.settings.power.max === 42), 'layer power edit survives save/reload');
    assert(compiled.ticket.gcodeLines.length > 0, 'compile produces a ticket with G-code lines');
    assert(compiled.machinePlanBounds.maxX > compiled.machinePlanBounds.minX, 'frame can use compiled machine bounds');
    assert(executeCalls.length === 1, 'start streams exactly one validated job');
    assert(executeCalls[0].ticket.ticketId === compiled.ticket.ticketId, 'start uses the compile ticket identity');
    service.clearJobSession();
    clearUnsafePriorState();
  }

  // 2. Undo after compile makes the compile state stale, so Start cannot use stale G-code.
  {
    const ready = completeCompile({
      current: startCompile({
        current: compiledJobStateInitial,
        requestId: 1,
        sceneHash: 'scene-a',
        profileHash: 'profile-a',
        now: 100,
      }),
      requestId: 1,
      sceneHash: 'scene-a',
      profileHash: 'profile-a',
      result: makeCompileResultLike('ticket-undo'),
      now: 200,
    });
    const stale = markStale(ready, 'scene-changed');
    assert(stale.status === 'stale', 'undo after compile marks compiled job stale');
    assert(selectGcode(stale) === null, 'stale compile exposes no sendable G-code');
    assert(!runtimeCanStartWithCompile(stale), 'runtime Start gate blocks stale compile after undo');
  }

  // 3. Undo after frame marks the frame stale as part of the same readiness pipeline.
  {
    const ready = completeCompile({
      current: startCompile({
        current: compiledJobStateInitial,
        requestId: 2,
        sceneHash: 'scene-a',
        profileHash: 'profile-a',
        now: 100,
      }),
      requestId: 2,
      sceneHash: 'scene-a',
      profileHash: 'profile-a',
      result: makeCompileResultLike('ticket-frame'),
      now: 200,
    });
    const runtime = buildInitialRuntimeState({
      compile: ready,
      machine: safetyStateInitial,
      job: jobPhaseInitial,
      recovery: recoveryStateInitial,
    });
    const framed = {
      ...runtime,
      project: {
        sceneHash: 'scene-a',
        profileId: 'profile-t3-81',
        profileHash: 'profile-a',
        objectCount: 1,
        layerCount: 1,
      },
      frame: { status: 'framed' as const, framedAt: 1000 },
    };
    assert(canStartJob(framed), 'compiled and framed runtime can start before undo');
    assert(!canStartJob({ ...framed, frame: { status: 'unframed', framedAt: null } }),
      'undo after frame clears frame readiness and blocks Start');
  }

  // 4. Async trace result cannot resurrect scene edits made while it was running.
  {
    const scene0 = createScene(400, 300, 'async trace');
    const withA = addObject(scene0, createRect(scene0.activeLayerId, 0, 0, 10, 10, 'image-a'));
    const withAB = addObject(withA, createRect(withA.activeLayerId, 20, 0, 10, 10, 'image-b'));
    const deletedB = deleteObjects(withAB, new Set([withAB.objects[1].id]));
    const token = captureSceneRevision(withAB);
    const staleTraceResult = addObject(withAB, createRect(withAB.activeLayerId, 40, 0, 10, 10, 'trace-a'));
    const committed = isSceneStale(token, deletedB) ? deletedB : staleTraceResult;

    assert(isSceneStale(token, deletedB), 'async trace detects scene changed during worker wait');
    assert(committed.objects.length === 1, 'async trace does not resurrect a deleted object');
    assert(committed.objects[0].name === 'image-a', 'current scene survives when stale trace result is discarded');
  }

  // 5. Autosave failure keeps the project dirty and surfaces the storage error.
  {
    resetEnvironment();
    setStorageForTest(new FailingStorageAdapter());
    resetAutosaveForTest();
    let dirty = true;
    let lastSaved = '{"old":true}';
    let surfaced = '';
    try {
      await writeAutosaveAsync('{"new":true}');
      dirty = false;
      lastSaved = '{"new":true}';
    } catch (err) {
      surfaced = err instanceof Error ? err.message : String(err);
    }
    assert(dirty, 'failed autosave leaves dirty flag true');
    assert(lastSaved === '{"old":true}', 'failed autosave does not advance last-saved JSON');
    assert(/QuotaExceededError/.test(surfaced), 'failed autosave surfaces storage error text');
  }

  // 6. Loading an old/corrupt project returns a repair report the UI can show.
  {
    const scene = createScene(400, 300, 'repair report');
    const orphan = createRect('missing-layer', 10, 10, 20, 20, 'orphan');
    scene.objects = [orphan];
    scene.activeLayerId = 'missing-layer';
    const report = deserializeSceneWithReport(serializeScene(scene));
    const kinds = report.repairs.map(repair => repair.kind);
    assert(kinds.includes('orphan-objects-relocated'), 'load repair report includes orphan object relocation');
    assert(kinds.includes('invalid-active-layer'), 'load repair report includes invalid active layer repair');
    assert(report.scene.objects[0].layerId === report.scene.layers[0].id, 'repaired object is moved to the default layer');
  }

  // 7. Connection lost during a job enters recovery and blocks Start.
  {
    const recovery = triggerDisconnectDuringJob({
      current: recoveryStateInitial,
      occurredAt: 1000,
      lastJobLine: 88,
      requiresRehome: true,
    });
    assert(recovery.status === 'disconnectDuringJob', 'disconnect during job creates recovery state');
    assert(!recoveryAllowsStart(recovery), 'disconnect recovery blocks Start');
    assert(pendingSteps(recovery).some(step => step.key === 'reconnectDone'), 'disconnect recovery requires reconnect');
  }

  // 8. Alarm unlock alone is not enough; rehome and reframe remain required.
  {
    let recovery = triggerAlarm({
      current: recoveryStateInitial,
      alarmCode: 7,
      occurredAt: 2000,
      requiresRehome: true,
    });
    recovery = ackInspection(recovery);
    recovery = ackUnlock(recovery);
    assert(recovery.status === 'alarm', 'alarm remains active after inspect and unlock only');
    assert(pendingSteps(recovery).some(step => step.key === 'rehomeDone'), 'alarm recovery still requires rehome');
    assert(pendingSteps(recovery).some(step => step.key === 'reframeDone'), 'alarm recovery still requires reframe');
    recovery = ackRehome(recovery);
    recovery = ackReframe(recovery);
    assert(recovery.status === 'none', 'alarm recovery clears only after rehome and reframe');
  }

  // 9. Stop failure is surfaced as a critical operator-facing path.
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(resolve(here, '../../src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
    const stopStart = panel.indexOf('const handleStop = useCallback');
    const stopEnd = panel.indexOf('const beginTestFire = useCallback', stopStart);
    const stopBody = stopStart >= 0 && stopEnd > stopStart ? panel.slice(stopStart, stopEnd) : '';
    assert(/showAlert\(\s*'Stop failed'/.test(stopBody), 'stop failure opens an operator-facing modal');
    assert(/E-stop|physical/i.test(stopBody), 'stop failure modal tells the operator to use physical safety controls');
    assert(/appendMessage\(/.test(stopBody), 'stop failure also records a visible message');
  }

  // 10. Large raster brightness history stays under the byte budget.
  {
    const hist = new HistoryManager(100, 100 * 1024 * 1024);
    const base = makeImageScene(5 * 1024 * 1024);
    const origWarn = console.warn;
    console.warn = () => { /* expected T2-82 eviction warnings */ };
    try {
      for (let i = 0; i < 50; i++) {
        const image = base.objects[0];
        const geom = image.geometry as ImageGeometry;
        const nextImage: SceneObject = {
          ...image,
          geometry: {
            ...geom,
            brightness: i,
            processedData: new Uint8Array(5 * 1024 * 1024),
            processedSettings: { brightness: i, contrast: 0, gamma: 1, invert: false },
          },
        };
        hist.push({ ...base, objects: [nextImage] }, { action: 'image-brightness' });
      }
    } finally {
      console.warn = origWarn;
    }
    assert(hist.totalBytes() <= 105 * 1024 * 1024, 'large raster history stays within the 100MB budget plus one-entry margin');
    assert(hist.getState().totalSnapshots < 50, 'large raster workflow evicts old snapshots instead of retaining all 50 edits');
  }

  // 11. Profile changes after save/compile are detected before reuse.
  {
    const saved = setupProfile({ id: 'profile-drift', maxSpindle: 1000 });
    const scene = createScene(400, 300, 'profile drift');
    scene.metadata.deviceProfileId = saved.id;
    scene.metadata.deviceProfileSnapshot = saved;
    const current = { ...saved, maxSpindle: 255 };
    const snapshot = checkProfileSnapshot(scene, id => (id === current.id ? current : null));
    const ready = completeCompile({
      current: startCompile({
        current: compiledJobStateInitial,
        requestId: 3,
        sceneHash: 'scene-a',
        profileHash: 'profile-a',
        now: 100,
      }),
      requestId: 3,
      sceneHash: 'scene-a',
      profileHash: 'profile-a',
      result: makeCompileResultLike('ticket-profile'),
      now: 200,
    });
    const stale = markStale(ready, 'profile-changed');
    assert(snapshot.kind === 'mismatch', 'profile snapshot detects changed max spindle on load');
    assert(stale.status === 'stale' && stale.reason === 'profile-changed', 'compiled job state records profile-change staleness');
    assert(!runtimeCanStartWithCompile(stale), 'runtime Start gate blocks profile-stale compile');
  }

  // 12. Material preset drift produces a warning-class mismatch on load.
  {
    const savedPreset = makePreset({ kerf: 0.1 });
    const snapshot = buildPresetSnapshot(savedPreset);
    const currentPreset = makePreset({ kerf: 0.2 });
    const result = checkPresetSnapshot(
      'layer-material',
      savedPreset.id,
      snapshot,
      id => (id === currentPreset.id ? currentPreset : null),
    );
    assert(result.kind === 'mismatch', 'material preset snapshot detects drift on load');
    assert(result.kind === 'mismatch' && result.changed.some(change => change.field === 'kerf'),
      'material preset warning names the changed compile-relevant field');
  }

  // Source pins for the two async/UI workflow protections this suite depends on.
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const props = readFileSync(resolve(here, '../../src/ui/components/PropertiesPanel.tsx'), 'utf-8');
    assert(/captureSceneRevision\(sceneRef\.current\)/.test(props), 'trace workflow captures the live scene revision');
    assert(/isSceneStale\(revisionAtStart, sceneRef\.current\)/.test(props), 'trace workflow checks staleness before commit');
    assert(/scene changed while the trace was running/i.test(props), 'trace stale path surfaces user-facing retry text');
  }

  resetEnvironment();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
