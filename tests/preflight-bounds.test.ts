/**
 * Guardrails: preflight output bounds — negative coords are warnings, bed exceed is blocker,
 * machinePlanBounds takes precedence over G-code parsing.
 * Run: npx tsx tests/preflight-bounds.test.ts
 */

import { runPreflight } from '../src/core/preflight/PreflightChecker';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { createRect } from '../src/core/scene/SceneObject';
import { type MachineState } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
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

function sceneWithRect(): ReturnType<typeof createScene> {
  const s = createScene(400, 300, 'Pf');
  return addObject(s, createRect(s.layers[0].id, 20, 20, 40, 30));
}

console.log('\n=== Preflight bounds guardrails ===');

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: -5, maxX: 50, minY: 0, maxY: 50 });
  const neg = r.issues.filter(i => i.id === 'output-negative-x');
  assert(neg.length === 1 && neg[0].severity === 'warning', 'negative X → warning');
  assert(r.canStart, 'negative X alone does not block start');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: 0, maxX: 50, minY: -3, maxY: 50 });
  assert(r.issues.some(i => i.id === 'output-negative-y' && i.severity === 'warning'), 'negative Y → warning');
  assert(r.canStart, 'negative Y alone does not block start');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: -2, maxX: 10, minY: -4, maxY: 10 });
  assert(r.issues.filter(i => i.id === 'output-negative-x' || i.id === 'output-negative-y').length === 2, 'both axes negative → two warnings');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: 0, maxX: 450, minY: 0, maxY: 50 });
  assert(r.issues.some(i => i.id === 'output-exceed-x' && i.severity === 'blocker'), 'exceed bed X → blocker');
  assert(!r.canStart, 'exceed X blocks start');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: 0, maxX: 50, minY: 0, maxY: 400 });
  assert(r.issues.some(i => i.id === 'output-exceed-y' && i.severity === 'blocker'), 'exceed bed Y → blocker');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: 0, maxX: 200, minY: 0, maxY: 200 });
  assert(!r.issues.some(i => i.id.startsWith('output-negative')), 'in-bounds plan → no negative output issues');
  assert(!r.issues.some(i => i.id === 'output-exceed-x' || i.id === 'output-exceed-y'), 'in-bounds plan → no exceed issues');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: 0, maxX: 10, minY: 0, maxY: 10 });
  assert(!r.issues.some(i => i.id === 'output-no-gcode'), 'machinePlanBounds without gcode → no output-no-gcode');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, null);
  assert(r.issues.some(i => i.id === 'output-no-gcode' && i.severity === 'blocker'), 'no bounds and no gcode → output-no-gcode blocker');
}

{
  const s = sceneWithRect();
  const gcode = 'G0 X10 Y10';
  const r = runPreflight(s, gcode, idle, 400, 300, { minX: -8, maxX: 5, minY: 0, maxY: 5 });
  const x = r.issues.find(i => i.id === 'output-negative-x');
  assert(x != null && x.title.includes('Output has negative'), 'machinePlanBounds wins over gcode (title mentions Output)');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: -1, maxX: 50, minY: 0, maxY: 50 });
  assert(!r.issues.some(i => i.id === 'output-negative-x'), 'minX exactly -1 → no negative-X warning');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, null, idle, 400, 300, { minX: -1.01, maxX: 50, minY: 0, maxY: 50 });
  assert(r.issues.some(i => i.id === 'output-negative-x'), 'minX below -1 → negative-X warning');
}

{
  const s = sceneWithRect();
  const r = runPreflight(s, 'G1 X-2 Y5', idle, 400, 300, null);
  const x = r.issues.find(i => i.id === 'output-negative-x');
  assert(x != null && x.title.includes('G-code'), 'gcode fallback: negative X uses G-code wording');
}

console.log(`\nPreflight bounds: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
