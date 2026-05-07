/**
 * T3-2 case 1: UI start-job line handling preserves object lifecycle markers
 * through the controller path.
 * Run: npx tsx tests/ui-start-job-end-to-end.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';

import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { compileSceneToGcode } from './e2e/helpers/compileToGcode';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function handleStartJobLineFilter(gcode: string): string[] {
  return gcode
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function makeSceneWithTwoCutObjects() {
  const scene = createScene(200, 150, 'ui start job e2e');
  const layerId = scene.layers[0].id;
  const first = createRect(layerId, 20, 20, 30, 15, 'ui-e2e-first');
  const second = createRect(layerId, 100, 40, 25, 18, 'ui-e2e-second');
  scene.objects.push(
    first,
    second,
  );
  return { scene, firstId: first.id, secondId: second.id };
}

async function waitForJobEnd(controller: GrblController): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    await flush(5);
    if (!controller.isJobRunning) return;
  }
  throw new Error('Job did not finish in time');
}

async function run(): Promise<void> {
  console.log('\n=== ui-start-job-end-to-end ===\n');

  const { scene, firstId, secondId } = makeSceneWithTwoCutObjects();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });
  const filteredLines = handleStartJobLineFilter(gcode);

  const markerIds = filteredLines
    .filter(line => /^;\s*OBJ\s+ids=/i.test(line))
    .map(line => line.replace(/^;\s*OBJ\s+ids=\s*/i, '').trim());

  assert(markerIds.includes(firstId), 'filtered UI lines keep first object marker');
  assert(markerIds.includes(secondId), 'filtered UI lines keep second object marker');
  assert(
    markerIds.indexOf(firstId) < markerIds.indexOf(secondId),
    'filtered marker order matches scene/object order',
  );

  const port = new MockSerialPort();
  const controller = new GrblController();
  port.open();
  await controller.connect(port);
  await flush(60);

  const lifecycleOrder: string[] = [];
  controller.onObjectLifecycle?.((activeIds: readonly string[]) => {
    for (const id of activeIds) {
      if (!lifecycleOrder.includes(id)) lifecycleOrder.push(id);
    }
  });

  await controller.sendJob(filteredLines);
  await waitForJobEnd(controller);
  await flush(50);

  assert(lifecycleOrder.includes(firstId), 'controller lifecycle fires for first object');
  assert(lifecycleOrder.includes(secondId), 'controller lifecycle fires for second object');
  assert(
    lifecycleOrder.indexOf(firstId) < lifecycleOrder.indexOf(secondId),
    'controller lifecycle order follows object marker order',
  );

  const serialText = port.received.join('\n');
  assert(!/;\s*OBJ\s+ids=/i.test(serialText), 'object marker comments are stripped before serial write');
  assert(!port.received.some(line => line.trimStart().startsWith(';')), 'no comment lines reach serial output');

  await controller.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
