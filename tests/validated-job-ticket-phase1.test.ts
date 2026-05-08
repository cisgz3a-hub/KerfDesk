/**
 * ValidatedJobTicket phase 1 — hashing, compile ticket, confirmPreflight return shape.
 * Run: npx tsx tests/validated-job-ticket-phase1.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import {
  createBlankProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import { runPreflightSummary } from '../src/core/preflight/Preflight';
import { generateTicketId, hashObject, hashSceneForTicket, hashString } from '../src/core/job/ticketHashing';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import { type MachineState } from '../src/controllers/ControllerInterface';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

console.log('\n=== validated-job-ticket phase 1 ===\n');

{
  assert(hashString('abc') === hashString('abc'), 'hashString deterministic');
  assert(hashString('abc') !== hashString('abd'), 'hashString different inputs');
}

{
  assert(
    hashObject({ a: 1, b: 2 }) === hashObject({ b: 2, a: 1 }),
    'hashObject key order independent',
  );
  assert(hashObject([1, 2]) !== hashObject([2, 1]), 'hashObject array order matters');
}

{
  const a = generateTicketId();
  const b = generateTicketId();
  assert(a !== b, 'generateTicketId unique across calls');
}

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('TicketCompile');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'T');
  const scene = addObject(s0, createRect(s0.layers[0].id, 20, 20, 40, 30));
  // T2-22-followup: pass profile snapshot for post-T1-58 ticket-hash matching.
  const result = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null, getActiveProfile());
  assert(result != null && result.ticket != null, 'compileGcode returns ticket');
  if (result) {
    assert(result.ticket.ticketId.length > 0, 'ticketId non-empty');
    assert(/^[0-9a-f]{8}$/.test(result.ticket.sceneHash), 'sceneHash is 8 hex chars');
    assert(
      result.ticket.sceneHash === hashSceneForTicket(scene),
      'ticket.sceneHash matches hashSceneForTicket(live scene)',
    );
    assert(result.ticket.gcodeHash === hashString(result.gcode), 'gcodeHash matches hashString(gcode)');
    const lines = result.gcode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    assert(result.ticket.gcodeLines.length === lines.length, 'gcodeLines count matches trimmed gcode');
    assert(result.ticket.startMode === 'absolute', 'ticket.startMode matches compile startMode');
  }

  const s2 = createScene(400, 300, 'T2');
  const scene2 = addObject(s2, createRect(s2.layers[0].id, 5, 5, 20, 20));
  // T2-22-followup: pass profile snapshot for post-T1-58 ticket-hash matching.
  const r2 = await compileGcode(scene2, 'current', { x: 1, y: 2 }, null, 'grbl', null, null, getActiveProfile());
  assert(r2?.ticket.startMode === 'current', 'ticket.startMode current');
  assert(r2?.ticket.savedOrigin?.x === 1 && r2.ticket.savedOrigin?.y === 2, 'ticket.savedOrigin');

  // T2-22-followup: pass firmware homing / laser-mode / maxSpindle so the
  // T1-32 / T1-33 / T1-55 preflight rules see a fully populated
  // liveMachineInfo and don't flag the test scene as "connected with
  // missing $30" / "$32 unknown" etc. Pre-T1-55 these args were absent.
  const headAtWorkpiece: MachineState = {
    ...idle,
    position: { x: 50, y: 50, z: 0 },
  };
  const preflight = runPreflightSummary(
    scene2, r2?.gcode ?? null, headAtWorkpiece, 400, 300, r2?.machinePlanBounds ?? null,
    /* firmwareHomingFromMachine */ false,
    /* firmwareLaserModeFromMachine */ true,
    /* firmwareMaxSpindleFromMachine */ 1000,
    /* firmwareUnsafeAtConnect */ null,
    'current',
    r2?.ticket.savedOrigin ?? null,
  );
  assert(preflight.canStart, 'preflight can start for compile scene');

  const ticket = r2!.ticket;
  const okWithTicket = await confirmPreflightForJobStart(
    preflight,
    async () => {},
    async () => true,
    ticket,
  );
  assert(
    okWithTicket.confirmed && okWithTicket.ticket != null && okWithTicket.ticket.ticket === ticket,
    'confirm with ticket returns ConfirmedJobTicket',
  );

  const okNoTicket = await confirmPreflightForJobStart(preflight, async () => {}, async () => true);
  assert(okNoTicket.confirmed && okNoTicket.ticket === null, 'confirm without ticket returns ticket null');

  const blocked = await confirmPreflightForJobStart(
    { ...preflight, canStart: false, blockers: 1 },
    async () => {},
    async () => true,
    ticket,
  );
  assert(!blocked.confirmed && blocked.ticket === null, 'blockers → confirmed false, ticket null');

  {
    const s3 = createScene(400, 300, 'bounds-cache');
    const scene3 = addObject(s3, createRect(s3.layers[0].id, 2, 2, 8, 8));
    const h0 = hashSceneForTicket(scene3);
    const r = scene3.objects[0];
    const scene3dirty = {
      ...scene3,
      objects: scene3.objects.map(o =>
        o.id === r.id
          ? {
              ...o,
              _bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
              _worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            }
          : o,
      ),
    };
    assert(hashSceneForTicket(scene3dirty) === h0, 'hashSceneForTicket ignores bounds/worldTransform caches');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
