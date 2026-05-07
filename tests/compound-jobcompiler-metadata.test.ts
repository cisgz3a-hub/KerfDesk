/**
 * T2-15 final compile slice: JobCompiler carries CompoundPath metadata
 * beside legacy FlatPath arrays.
 */
import assert from 'node:assert/strict';
import { compileJob } from '../src/core/job/JobCompiler';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { createLayer } from '../src/core/scene/Layer';
import { createScene } from '../src/core/scene/Scene';
import { createPath, type SubPath } from '../src/core/scene/SceneObject';

function squareSubPath(x: number, y: number, side: number): SubPath {
  return {
    closed: true,
    segments: [
      { type: 'move', to: { x, y } },
      { type: 'line', to: { x: x + side, y } },
      { type: 'line', to: { x: x + side, y: y + side } },
      { type: 'line', to: { x, y: y + side } },
      { type: 'close' },
    ],
  };
}

const scene = createScene(200, 200, 'Compound compile');
scene.compileOptions = { optimizeOrder: false };
const engraveLayer = createLayer(0, 'engrave', 'Engrave');
scene.layers = [engraveLayer];
scene.activeLayerId = engraveLayer.id;

const donut = createPath(engraveLayer.id, [
  squareSubPath(0, 0, 50),
  squareSubPath(15, 15, 20),
], 'Donut');
scene.objects = [donut];

const job = compileJob(scene);
const op = job.operations[0];
assert.equal(op.geometry.type, 'fill', 'engrave path compiles as fill geometry');
assert.equal(op.geometry.paths.length, 2, 'legacy FlatPath output remains available');
assert.equal(op.geometry.compoundPaths?.length, 1, 'compound metadata is carried beside FlatPaths');
assert.deepEqual(
  op.geometry.compoundPaths?.[0].contours.map(contour => contour.role),
  ['outer', 'hole'],
  'compile metadata preserves outer/hole roles for a compound path',
);
assert.equal(op.geometry.compoundPaths?.[0].sourceObjectId, donut.id, 'compound metadata traces back to source object');

const overlapScene = createScene(200, 200, 'Overlapping compounds');
overlapScene.compileOptions = { optimizeOrder: false };
const overlapLayer = createLayer(0, 'engrave', 'Engrave');
overlapLayer.settings.fill.interval = 10;
overlapScene.layers = [overlapLayer];
overlapScene.activeLayerId = overlapLayer.id;
overlapScene.objects = [
  createPath(overlapLayer.id, [squareSubPath(0, 0, 50)], 'A'),
  createPath(overlapLayer.id, [squareSubPath(0, 0, 50)], 'B'),
];

const overlapJob = compileJob(overlapScene);
const overlapPlan = optimizePlan(overlapJob);
const burnMoves = overlapPlan.operations.flatMap(operation => operation.moves)
  .filter(move => move.type === 'linear' && (move.power ?? 0) > 0);
assert.ok(
  burnMoves.length > 0,
  'compiled overlapping compound fill objects still produce burn moves instead of canceling each other',
);

console.log('compound jobcompiler metadata: ok');
