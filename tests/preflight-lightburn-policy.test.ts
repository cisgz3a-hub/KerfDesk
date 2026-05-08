/**
 * LightBurn-style preflight policy:
 * - hard-block physical/safety impossibilities
 * - keep positioning aids and canvas/material hints non-blocking
 *
 * Run: npx tsx tests/preflight-lightburn-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeUserModeGatePolicy } from '../src/app/UserModeGates';
import { runPreflightSummary } from '../src/core/preflight/Preflight';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { addObject } from '../src/ui/history/SceneCommands';
import type { MachineState } from '../src/controllers/ControllerInterface';

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function sceneWithRectAt(x: number, y: number): Scene {
  const scene = createScene(400, 300, 'LightBurn policy');
  return addObject(scene, createRect(scene.layers[0].id, x, y, 30, 20, 'Rect'));
}

test('beginner gantry flow recommends framing but does not hard require it', () => {
  const beginner = computeUserModeGatePolicy('beginner');
  assert.equal(beginner.requireFrameBeforeStart, false);
  assert.equal(beginner.allowStartWithoutFraming, true);
  assert.equal(beginner.startWithoutFramingLabel, 'Start without framing');
});

test('machine-space bounds suppress raw scene negative/outside-bed blockers', () => {
  const scene = sceneWithRectAt(-30, -20);
  const preflight = runPreflightSummary(
    scene,
    null,
    idle,
    400,
    300,
    { minX: 20, minY: 20, maxX: 60, maxY: 50 },
  );

  assert.equal(
    preflight.issues.some(issue => issue.id.startsWith('design-outside-bed')),
    false,
  );
  assert.equal(
    preflight.issues.some(issue => issue.id === 'OUT_OF_BOUNDS_MIN'),
    false,
  );
  assert.equal(preflight.canStart, true);
});

test('material area mismatch warns instead of blocking the physical bed', () => {
  const scene = sceneWithRectAt(20, 20);
  scene.material = {
    type: 'wood',
    name: 'Plywood guide',
    width: 10,
    height: 10,
    x: 300,
    y: 250,
    thickness: 3,
    color: '#b88755',
  };

  const preflight = runPreflightSummary(
    scene,
    null,
    idle,
    400,
    300,
    { minX: 20, minY: 20, maxX: 50, maxY: 40 },
  );
  const materialIssue = preflight.issues.find(issue =>
    issue.id.startsWith('design-outside-material-full'),
  );

  assert.equal(materialIssue?.severity, 'warning');
  assert.equal(preflight.canStart, true);
});

test('layer output summaries stay out of preflight issues', () => {
  const scene = sceneWithRectAt(20, 20);
  const preflight = runPreflightSummary(
    scene,
    null,
    idle,
    400,
    300,
    { minX: 20, minY: 20, maxX: 50, maxY: 40 },
  );

  assert.equal(preflight.issues.some(issue => issue.id === 'layer-output-summaries'), false);
});
