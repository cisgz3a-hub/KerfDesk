/**
 * `sceneHash` is `hashSceneForTicket(scene)` at compile time — a fingerprint of
 * the scene (and other canonical job inputs via that function's scene snapshot),
 * not the ticket's derived view fields. Recompiling the same scene should yield
 * the same `sceneHash` even if `gcodeHash` and canvas-derived payloads differ
 * (e.g. after logic changes). Canvas moves / plan bounds on the ticket are
 * never passed to `hashSceneForTicket`.
 * Run: npx tsx tests/ticket-canvas-fields-not-in-hash.test.ts
 */
import { hashSceneForTicket } from '../src/core/job/ticketHashing';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { compileGcode } from '../src/app/PipelineService';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';

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

void (async () => {
  console.log('\n=== ticket canvas fields: sceneHash scope (not derived fields) ===\n');

  const memoryStore: Record<string, string> = {};
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
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const p = createBlankProfile('HashScope');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'H');
  const scene = addObject(s0, createRect(s0.layers[0].id, 5, 5, 20, 20));
  const hScene = hashSceneForTicket(scene);

  const a = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null);
  const b = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null);
  assert(a != null && b != null, 'two compiles of same scene succeed');
  if (!a || !b) {
    process.exit(1);
  }
  assert(a.ticket.sceneHash === hScene, 'sceneHash is hashSceneForTicket(scene) from pipeline');
  assert(
    a.ticket.sceneHash === b.ticket.sceneHash,
    'second compile: same sceneHash (canvasMoves/machineTransform on ticket are not re-hashed as scene)',
  );
  assert(
    a.ticket.gcodeHash === b.ticket.gcodeHash
    && a.ticket.canvasMoves.length === b.ticket.canvasMoves.length,
    'identical gcode+canvas for identical compiles in this case',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
