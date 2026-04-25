/**
 * ValidatedJobTicket carries canvas preview fields from the same compile as gcode.
 * Run: npx tsx tests/ticket-canvas-fields-populated.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
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
  console.log('\n=== ticket canvas fields populated ===\n');

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
  const p = createBlankProfile('CanvasFields');
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s0 = createScene(400, 300, 'T');
  const scene = addObject(s0, createRect(s0.layers[0].id, 20, 20, 40, 30));
  const result = await compileGcode(scene, 'absolute', null, null, 'grbl', null, null);
  assert(result != null, 'compileGcode returns result');
  if (!result) {
    process.exit(1);
  }
  const t = result.ticket;
  assert(t.machineTransform === result.machineTransform, 'ticket.machineTransform is same ref as result');
  assert(
    t.canvasMoves.length === result.canvasMoves.length,
    'ticket.canvasMoves length matches result',
  );
  if (t.canvasMoves.length > 0) {
    assert(
      t.canvasMoves[0] === result.canvasMoves[0],
      'ticket canvas move objects same ref as result (shallow-copied array)',
    );
  }
  assert(
    t.canvasPlanBounds.minX === result.canvasPlanBounds.minX
    && t.canvasPlanBounds.maxX === result.canvasPlanBounds.maxX,
    'ticket.canvasPlanBounds matches result',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
