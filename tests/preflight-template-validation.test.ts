/**
 * Preflight integration: template semantic validation + confirmPreflightForJobStart.
 * Run: npx tsx tests/preflight-template-validation.test.ts
 */
import { runPreflightSummary } from '../src/core/preflight/Preflight';
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { BUILT_IN_HEADER_TEMPLATES } from '../src/core/plan/GcodeTemplates';
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

function sceneWithRect() {
  const s = createScene(400, 300, 'Pf');
  return addObject(s, createRect(s.layers[0].id, 20, 20, 40, 30));
}

console.log('\n=== preflight template validation (integration) ===\n');

installMockLocalStorage();
for (const k of Object.keys(memoryStore)) delete memoryStore[k];

{
  const p = createBlankProfile('BadStart');
  p.startGcode = '$X\n';
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s = sceneWithRect();
  const r = runPreflightSummary(s, null, idle, 400, 300, { minX: 0, maxX: 50, minY: 0, maxY: 50 });
  const unlock = r.issues.find(i => i.id === 'TEMPLATE_UNLOCK');
  assert(Boolean(unlock) && unlock?.severity === 'blocker', 'runPreflightSummary surfaces TEMPLATE_UNLOCK as blocker');
  assert(r.canStart === false, 'TEMPLATE_UNLOCK blocks canStart');
}

{
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('TrustedHdr');
  p.gcodeHeaderTemplate = BUILT_IN_HEADER_TEMPLATES['GRBL (generic)'];
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s = sceneWithRect();
  const r = runPreflightSummary(s, null, idle, 400, 300, { minX: 0, maxX: 50, minY: 0, maxY: 50 });
  const templateIssues = r.issues.filter(
    i => i.id.startsWith('TEMPLATE_') || i.id === 'FOOTER_MISSING_M5',
  );
  assert(templateIssues.length === 0, 'trusted built-in header yields no template semantic issues');
}

void (async () => {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  const p = createBlankProfile('BlockConfirm');
  p.startGcode = '$X\n';
  p.bedWidth = 400;
  p.bedHeight = 300;
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  const s = sceneWithRect();
  const preflight = runPreflightSummary(s, null, idle, 400, 300, { minX: 0, maxX: 50, minY: 0, maxY: 50 });

  let alertTitle = '';
  const showAlert = async (title: string, _message?: string, _details?: string) => {
    alertTitle = title;
  };
  const showConfirm = async () => true;

  const { confirmed } = await confirmPreflightForJobStart(preflight, showAlert, showConfirm);
  assert(confirmed === false, 'confirmPreflightForJobStart returns false when blockers present');
  assert(alertTitle === 'Cannot start job', 'confirmPreflightForJobStart shows cannot-start alert');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
