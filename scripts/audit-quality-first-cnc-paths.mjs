// Reproducible software-only audit. Does not edit settings or operate a machine.
// The alternative orders are examples for independent parts, not a replacement
// for the deliberate source-order, workholding or stage-dependency policies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  logLevel: 'error',
});

try {
  const load = (path) => server.ssrLoadModule(join(root, 'src', path));
  const [scene, devices, compiler, output, timing, optimization, sections, relief] =
    await Promise.all([
      load('core/scene/index.ts'),
      load('core/devices/index.ts'),
      load('core/cnc/compile-cnc-job.ts'),
      load('core/output/cnc-grbl-strategy.ts'),
      load('core/job/estimate-duration.ts'),
      load('core/job/optimize-paths.ts'),
      load('core/cnc/cnc-tool-sections.ts'),
      load('core/relief/relief-finishing.ts'),
    ]);
  const device = {
    ...devices.DEFAULT_DEVICE_PROFILE,
    maxFeed: 3000,
    accelMmPerSec2: 100,
  };
  const xs = [10, 390, 30, 370, 50, 350, 70, 330, 90, 310];
  const square = (x, y = 10) => ({
    closed: true,
    points: [
      { x, y },
      { x: x + 5, y },
      { x: x + 5, y: y + 5 },
      { x, y: y + 5 },
    ],
  });
  const sceneFor = (order) => ({
    layers: [
      {
        ...scene.createLayer({ id: 'L', color: '#ff0000' }),
        cnc: {
          ...scene.DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'profile-on-path',
          depthMm: 1,
          depthPerPassMm: 1,
          tabsEnabled: false,
          rampEntryDeg: 0,
          feedMmPerMin: 1000,
          plungeMmPerMin: 300,
        },
      },
    ],
    objects: [
      {
        kind: 'imported-svg',
        id: 'O',
        source: 'independent-squares-audit.svg',
        bounds: { minX: 10, minY: 10, maxX: 395, maxY: 15 },
        transform: scene.IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: order.map((x) => square(x)) }],
      },
    ],
  });
  const measure = (job) => {
    const gcode = output.cncGrblStrategy.emit(job, device);
    return {
      ...linearMotionMetrics(gcode),
      ...timing.estimateJobDuration(job, device, { gcode }),
      emittedToolChangeHolds: gcode.split('\n').filter((line) => /^M0(?:\s|$)/.test(line)).length,
    };
  };
  const compile = (order) =>
    optimization.optimizePaths(
      compiler.compileCncJob(sceneFor(order), device, scene.DEFAULT_CNC_MACHINE_CONFIG),
    );
  const currentOrder = measure(compile(xs));
  const independentNearToFar = measure(compile([...xs].sort((a, b) => a - b)));
  assert.equal(
    currentOrder.cuttingGeometryFeedDigest,
    independentNearToFar.cuttingGeometryFeedDigest,
  );

  const group = (toolId, cutType, x) => ({
    kind: 'cnc',
    layerId: `${toolId}-${cutType}`,
    sourceObjectId: `${toolId}-${cutType}`,
    color: '#ff0000',
    toolId,
    toolName: toolId,
    layerPrimaryToolId: toolId,
    cutType,
    toolDiameterMm: 3,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        closed: true,
        zMm: -1,
        polyline: [...square(x).points, square(x).points[0]],
      },
    ],
  });
  const groups = [
    group('A', 'pocket', 10),
    group('B', 'pocket', 30),
    group('A', 'profile-outside', 50),
    group('B', 'profile-outside', 70),
  ];
  const ordered = sections.orderGroupsIntoToolSections(groups);
  const currentToolSchedule = measure({ groups: ordered });
  // All four shapes are disjoint and have no secondary-stage dependencies.
  // The two clearing groups remain first; only the independent profiles swap.
  const phaseBoundaryReuse = measure({ groups: [groups[0], groups[1], groups[3], groups[2]] });
  assert.equal(
    currentToolSchedule.cuttingGeometryFeedDigest,
    phaseBoundaryReuse.cuttingGeometryFeedDigest,
  );

  const ball = { id: 'ball', name: 'Audit ball', kind: 'ball-nose', diameterMm: 3.175 };
  const requestedScallopMm = 0.025;
  const rowSpacingMm = relief.scallopRowSpacingMm(ball, requestedScallopMm);
  const radius = ball.diameterMm / 2;
  assert.ok(
    Math.abs(radius - Math.sqrt(radius ** 2 - (rowSpacingMm / 2) ** 2) - requestedScallopMm) <
      1e-12,
  );
  // Keep the probe below slopes where contact can reach the cylindrical flank.
  const planarScallops = [0, 45, 60].map((slopeDeg) => {
    const surfaceSpacing = rowSpacingMm / Math.cos((slopeDeg * Math.PI) / 180);
    return {
      slopeDeg,
      normalScallopMm: radius - Math.sqrt(radius ** 2 - (surfaceSpacing / 2) ** 2),
    };
  });
  console.log(
    JSON.stringify(
      {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        evidenceScope:
          'Synthetic emitted programs and ideal ball/plane geometry; no material or hardware qualification. Estimates exclude manual tool-change time.',
        device: { maxFeedMmPerMin: device.maxFeed, accelMmPerSec2: device.accelMmPerSec2 },
        independentProfiles: { sourceXs: xs, currentOrder, independentNearToFar },
        independentToolSections: {
          currentOrder: ordered.map((item) => `${item.toolId}:${item.cutType}`),
          currentToolSchedule,
          phaseBoundaryReuse,
        },
        rasterOnlyCrossSlope: {
          toolDiameterMm: ball.diameterMm,
          requestedScallopMm,
          rowSpacingMm,
          planarScallops,
          qualification:
            'Ideal ball on an infinite plane with rows along the contour; surface-normal cusp before emitted-grid effects. Hybrid raster/waterline is a separate existing strategy.',
        },
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}

// This fixture deliberately has only absolute G0/G1 motion. Retain the actual
// emitted segment endpoints, depth, feed and spindle for every lateral cut.
// Sorting lets travel change while proving the cut-segment multiset is equal.
function linearMotionMetrics(gcode) {
  assert.doesNotMatch(gcode, /^G(?:2|3|91)(?:\s|$)/m);
  let position = { x: 0, y: 0, z: 0 };
  let feed = 0;
  let spindle = 0;
  let rapidXYMm = 0;
  let cuttingXYMm = 0;
  const cuts = [];
  for (const line of gcode.split('\n')) {
    const spindleWord = line.match(/(?:^|\s)S([\d.]+)/);
    if (spindleWord) spindle = Number(spindleWord[1]);
    const feedWord = line.match(/(?:^|\s)F([\d.]+)/);
    if (feedWord) feed = Number(feedWord[1]);
    if (!/^G[01]\s/.test(line)) continue;
    const next = { ...position };
    for (const match of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
      next[match[1].toLowerCase()] = Number(match[2]);
    }
    const distance = Math.hypot(next.x - position.x, next.y - position.y);
    if (line.startsWith('G0')) rapidXYMm += distance;
    else if (distance > 0) {
      cuttingXYMm += distance;
      cuts.push(JSON.stringify({ from: position, to: next, feed, spindle }));
    }
    position = next;
  }
  return {
    rapidXYMm,
    cuttingXYMm,
    cuttingGeometryFeedDigest: createHash('sha256').update(cuts.sort().join('\n')).digest('hex'),
  };
}
