// Reproduce route opportunities without changing feed, power, burn geometry,
// direction, group order, or passes. These are software timing estimates,
// not machine/material quality qualification or a claim of global optimality.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let server;
try {
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = (path) => server.ssrLoadModule(join(root, 'src', 'core', path));
  const { optimizePaths } = await load('job/optimize-paths.ts');
  const { estimateJobDuration } = await load('job/estimate-duration.ts');
  const { DEFAULT_DEVICE_PROFILE } = await load('devices/index.ts');
  const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, accelMmPerSec2: 500 };
  const settings = {
    travelPolicy: 'nearest-neighbor',
    insideFirst: true,
    layerPriority: 'project-order',
    pathDirection: 'preserve',
    startPoint: 'machine-origin',
    closedShapeStart: 'drawn',
  };
  const first = group('A', [
    segment([
      [0, 0],
      [390, 0],
    ]),
  ]);
  const second = group('B', [
    segment([
      [20, 1],
      [21, 1],
    ]),
    segment([
      [380, 1],
      [381, 1],
    ]),
  ]);
  const actualGroups = optimizePaths({ groups: [first, second] }, settings);
  const continuedGroups = {
    groups: [first, { ...second, segments: [...second.segments].reverse() }],
  };

  const points = [
    [20, 20],
    [40, 20],
    [80, 20],
    [20, 80],
    [60, 80],
    [100, 100],
  ];
  const squares = points.map(([x, y]) =>
    segment(
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
      true,
    ),
  );
  const squareGroup = group('squares', squares);
  const actualSquares = optimizePaths({ groups: [squareGroup] }, settings);
  // Exhaust all 720 permutations of the fixed entries, keeping contour starts,
  // direction and interior geometry unchanged. This minimum concerns travel
  // distance for this small fixture; it is not a general cycle-time solver.
  const bestOrder = minimumClosedTour(points);
  const improvedSquares = {
    groups: [{ ...squareGroup, segments: bestOrder.map((index) => squares[index]) }],
  };

  function measure(job) {
    let program = '';
    const timing = estimateJobDuration(job, device, {
      onEmittedProgram: (value) => {
        program = value;
      },
    });
    assert.equal(timing.unavailableReason, undefined);
    return {
      timing,
      rapidDistanceMm: rapidDistance(program),
      starts: job.groups.map((item) => item.segments.map((part) => part.polyline[0])),
      burnLines: program
        .split('\n')
        .filter((line) => /^G1 /.test(line))
        .sort(),
    };
  }
  function compare(name, actualJob, candidateJob) {
    assert.deepEqual(
      actualJob.groups.map((item) => item.layerId),
      candidateJob.groups.map((item) => item.layerId),
    );
    actualJob.groups.forEach((item, index) => {
      const candidate = candidateJob.groups[index];
      assert.deepEqual({ ...item, segments: [] }, { ...candidate, segments: [] });
      assert.deepEqual(
        item.segments.map(JSON.stringify).sort(),
        candidate.segments.map(JSON.stringify).sort(),
      );
    });
    const actual = measure(actualJob);
    const candidate = measure(candidateJob);
    assert.deepEqual(actual.burnLines, candidate.burnLines);
    const summary = ({ burnLines, ...rest }) => ({ ...rest, burnMoveCount: burnLines.length });
    return {
      name,
      current: summary(actual),
      candidate: summary(candidate),
      estimatedSavingsSeconds: actual.timing.totalSeconds - candidate.timing.totalSeconds,
      estimatedSavingsPercent:
        100 * (1 - candidate.timing.totalSeconds / actual.timing.totalSeconds),
    };
  }
  console.log(
    JSON.stringify(
      {
        qualification: 'Synthetic emitted-program estimates only; no hardware or material test.',
        machine: { maxFeedMmPerMin: device.maxFeed, accelerationMmPerSec2: device.accelMmPerSec2 },
        settings,
        cases: [
          compare('Continue from previous group endpoint', actualGroups, continuedGroups),
          compare(
            'Six closed contours: greedy versus exhaustive distance tour',
            actualSquares,
            improvedSquares,
          ),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await server?.close();
}

function segment(points, closed = false) {
  return { closed, polyline: points.map(([x, y]) => ({ x, y })) };
}

function group(layerId, segments) {
  return {
    kind: 'cut',
    layerId,
    color: '#000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments,
  };
}

function minimumClosedTour(points) {
  let best = [];
  let bestDistance = Infinity;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function visit(order, remaining, cursor, travelled) {
    if (remaining.length === 0) {
      const total = travelled + distance(cursor, [0, 0]);
      if (total < bestDistance) {
        best = order;
        bestDistance = total;
      }
      return;
    }
    for (const index of remaining) {
      visit(
        [...order, index],
        remaining.filter((item) => item !== index),
        points[index],
        travelled + distance(cursor, points[index]),
      );
    }
  }
  visit(
    [],
    points.map((_, index) => index),
    [0, 0],
    0,
  );
  return best;
}

// The fixtures contain only absolute G0/G1 XY moves. Read every endpoint so
// travel includes the real group transitions and the emitted origin return.
function rapidDistance(program) {
  let cursor = { x: 0, y: 0 };
  let total = 0;
  for (const line of program.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const next = {
      x: Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? cursor.x),
      y: Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? cursor.y),
    };
    if (line.startsWith('G0 ')) total += Math.hypot(next.x - cursor.x, next.y - cursor.y);
    cursor = next;
  }
  return total;
}
