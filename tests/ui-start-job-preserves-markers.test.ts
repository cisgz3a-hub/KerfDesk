/**
 * Mirrors the compile/ticket line split (`ticket.gcodeLines` uses the same
 * trim + non-empty filter as the former handleStartJob string split), then
 * GrblController.sendJob — ensures `; OBJ ids=...` markers survive that path
 * and drive onObjectLifecycle (burn-progress), while comments never hit the
 * serial port.
 *
 * Run: npx tsx tests/ui-start-job-preserves-markers.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';

import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { compileSceneToGcode } from './e2e/helpers/compileToGcode';

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

function flush(ms = 20): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function applyHandleStartJobLineFilter(gcode: string): string[] {
  return gcode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function makeTwoRectScene() {
  const scene = createScene(200, 150, 'ui filter test');
  const cutLayer = scene.layers[0];
  scene.objects.push(
    createRect(cutLayer.id, 20, 20, 30, 15, 'R1'),
    createRect(cutLayer.id, 100, 40, 25, 18, 'R2'),
  );
  return scene;
}

async function waitForJobEnd(ctrl: GrblController, maxIter = 3000): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    await flush(5);
    if (!ctrl.isJobRunning) return;
  }
  throw new Error('Job did not finish in time');
}

async function run(): Promise<void> {
  const scene = makeTwoRectScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });
  const lines = applyHandleStartJobLineFilter(gcode);

  const objCommentLines = lines.filter(l => /^\s*;\s*OBJ\s+ids=/i.test(l));
  assert(
    objCommentLines.length >= 1,
    'UI filter leaves at least one `; OBJ ids=` line in the array',
  );
  const uniqueIdLines = new Set(
    objCommentLines.map(l => l.replace(/^\s*;\s*OBJ\s+ids=\s*/i, '').trim()),
  );
  assert(
    uniqueIdLines.size >= 2,
    'Two distinct cut objects → at least two distinct marker comment lines',
  );

  const port = new MockSerialPort();
  const ctrl = new GrblController();
  port.open();
  await ctrl.connect(port);
  await flush(30);
  await flush(30);

  const nonEmptyEvents: { ids: string[]; reason?: string }[] = [];
  ctrl.onObjectLifecycle?.((activeObjectIds, reason) => {
    if (activeObjectIds.length > 0) {
      nonEmptyEvents.push({ ids: [...activeObjectIds], reason });
    }
  });

  await ctrl.sendJob(lines);
  await waitForJobEnd(ctrl);
  await flush(50);

  assert(
    nonEmptyEvents.length >= 2,
    'onObjectLifecycle fired at least twice with non-empty active ids (one per object path)',
  );

  const portText = port.received.join('\n');
  assert(
    !/;\s*OBJ\s+ids=/i.test(portText),
    'Serial stream does not contain `; OBJ ids=` (controller strips before write)',
  );
  assert(
    !port.received.some(l => l.trimStart().startsWith(';')),
    'No comment lines were written to the mock port',
  );

  await ctrl.disconnect();

  console.log(`\nui-start-job-preserves-markers: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
