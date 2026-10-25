// Path-order math audit: how far the planner (optimizePaths, with ADR-669's
// part-by-part inside-first and refinement) sits from constraint-respecting
// reference routes, measured with the project's own GRBL planner clock.
// Software estimates only: no hardware, material or cut-quality
// qualification. Every candidate route keeps the burn geometry, feed, power,
// passes and group order; only visit order, closed-contour start vertex and
// (where the settings allow it) open-path direction change, and an independent
// containment oracle re-checks that every contained contour still precedes its
// container.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  const load = (path) => server.ssrLoadModule(join(root, 'src', path));
  const [optimizer, timing, devices, startPoint, scene, cncCompiler, orientation] =
    await Promise.all([
      load('core/job/optimize-paths.ts'),
      load('core/job/estimate-duration.ts'),
      load('core/devices/index.ts'),
      load('core/job/job-start-point.ts'),
      load('core/scene/index.ts'),
      load('core/cnc/compile-cnc-job.ts'),
      load('core/geometry/polyline-orientation.ts'),
    ]);
  const device = { ...devices.DEFAULT_DEVICE_PROFILE, maxFeed: 6000, accelMmPerSec2: 500 };
  const defaults = {
    travelPolicy: 'nearest-neighbor',
    insideFirst: true,
    layerPriority: 'project-order',
    pathDirection: 'allow-reverse',
    startPoint: 'machine-origin',
    closedShapeStart: 'drawn',
  };
  const plan = (job, settings = defaults) => optimizer.optimizePaths(job, settings);

  function measure(job) {
    let program = '';
    const estimate = timing.estimateJobDuration(job, device, {
      onEmittedProgram: (value) => {
        program = value;
      },
    });
    assert.equal(estimate.unavailableReason, undefined);
    return {
      totalSeconds: round(estimate.totalSeconds),
      rapidSeconds: round(estimate.breakdown.rapidTravelSeconds),
      cutSeconds: round(estimate.breakdown.cutSeconds),
      rapidMm: round(rapidDistance(program)),
      rapidCount: program.split('\n').filter((line) => /^G0 /.test(line)).length,
      burnLines: burnMoves(program),
    };
  }

  // Same burn, different route: equal group headers, equal segment multisets
  // up to the allowed rotation/reversal, equal sorted G1 lines, and every
  // containment precedence of the original kept by the candidate.
  function compare(name, currentJob, candidateJob, note) {
    assert.equal(currentJob.groups.length, candidateJob.groups.length);
    currentJob.groups.forEach((group, index) => {
      const candidate = candidateJob.groups[index];
      assert.deepEqual({ ...group, segments: [] }, { ...candidate, segments: [] });
      assert.deepEqual(
        group.segments.map(canonicalSegment).sort(),
        candidate.segments.map(canonicalSegment).sort(),
      );
      assertPrecedence(candidate.segments);
    });
    const current = measure(currentJob);
    const candidate = measure(candidateJob);
    assert.deepEqual(current.burnLines, candidate.burnLines);
    return {
      name,
      ...(note === undefined ? {} : { note }),
      current: strip(current),
      candidate: strip(candidate),
      rapidMmSavedPercent: percent(current.rapidMm, candidate.rapidMm),
      totalSecondsSavedPercent: percent(current.totalSeconds, candidate.totalSeconds),
    };
  }

  const report = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    evidenceScope:
      'Synthetic jobs through optimizePaths and the emitted-program GRBL planner clock. Travel-only comparisons; no hardware, material or quality qualification.',
    device: { maxFeedMmPerMin: device.maxFeed, accelMmPerSec2: device.accelMmPerSec2 },
    rapidTimePerMm: rapidTimeTable(device.maxFeed / 60, device.accelMmPerSec2),
    probes: [],
  };

  // ---------------------------------------------------------------------
  // Probe 1. Inside-first is depth-major across the whole group: every hole
  // on the sheet is cut before any outline. The candidate keeps every hole
  // ahead of its own outline but finishes each part before leaving it.
  {
    const parts = partsGrid({ cols: 6, rows: 4, pitch: 60, outer: 40, hole: 10, holes: 2 });
    const job = {
      groups: [
        cutGroup(
          'parts',
          parts.flatMap((part) => [...part.holes, part.outer]),
        ),
      ],
    };
    const current = plan(job);
    const perPart = partMajorRoute(parts, { x: 0, y: 0 });
    const plannedOrder = current.groups[0].segments;
    const firstOutline = plannedOrder.findIndex(
      (s) => bounds(s.polyline).maxX - bounds(s.polyline).minX === 40,
    );
    report.probes.push({
      ...compare(
        'P1a inside-first sheet: planner vs part-major nearest-neighbour reference',
        current,
        { groups: [{ ...job.groups[0], segments: perPart }] },
        '24 parts x 2 holes on a 400x300 sheet. Both routes cut each hole before its outline.',
      ),
      plannedHolesBeforeFirstOutline: firstOutline,
      holesInJob: parts.length * 2,
    });
    const sweep = { ...defaults, cutDirection: 'top-to-bottom' };
    const currentSweep = optimizer.optimizePaths(job, sweep, [], 'front-left');
    const perPartSweep = parts
      .slice()
      .sort((a, b) => maxY(b.outer) - maxY(a.outer) || minX(a.outer) - minX(b.outer))
      .flatMap((part) => [...part.holes, part.outer]);
    report.probes.push(
      compare(
        'P1b cut-direction top-to-bottom: planner vs one part-major sweep reference',
        currentSweep,
        { groups: [{ ...job.groups[0], segments: perPartSweep }] },
        'Before ADR-669 the planner swept the sheet once for holes and again for outlines.',
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Probe 2. Nearest-neighbour versus the same tour after 2-opt + Or-opt,
  // and versus the exhaustive optimum where that is computable.
  {
    for (const [label, shapes] of [
      ['random 60 squares', randomSquares(60, 7, 380, 280, 20261024)],
      ['10x10 grid of 5 mm squares', gridSquares(10, 10, 10, 5)],
      ['clustered 48 squares', clusteredSquares(48, 4, 6, 20261024)],
    ]) {
      const job = { groups: [cutGroup('shapes', shapes)] };
      const current = plan(job, { ...defaults, insideFirst: false });
      const improved = improveClosedTour(current.groups[0].segments, { x: 0, y: 0 }, true);
      report.probes.push(
        compare(
          `P2 ${label}: planner vs unbounded 2-opt/Or-opt reference (park return scored)`,
          current,
          { groups: [{ ...job.groups[0], segments: improved }] },
        ),
      );
    }
    // Travel share rises with feed: the same 60 squares at a marking speed.
    {
      const shapes = randomSquares(60, 7, 380, 280, 20261024);
      const job = { groups: [{ ...cutGroup('fast', shapes), speed: 6000 }] };
      const current = plan(job, { ...defaults, insideFirst: false });
      const improved = improveClosedTour(current.groups[0].segments, { x: 0, y: 0 }, true);
      report.probes.push(
        compare(
          'P2 random 60 squares at 6000 mm/min: planner vs unbounded 2-opt/Or-opt reference (park return scored)',
          current,
          { groups: [{ ...job.groups[0], segments: improved }] },
        ),
      );
    }
    const small = randomSquares(9, 6, 200, 200, 7);
    const job = { groups: [cutGroup('small', small)] };
    const current = plan(job, { ...defaults, insideFirst: false });
    const optimum = exhaustiveClosedTour(small, { x: 0, y: 0 }, true);
    report.probes.push(
      compare('P2 nine squares: planner vs exhaustive optimum (362,880 tours)', current, {
        groups: [{ ...job.groups[0], segments: optimum }],
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Probe 3. Each group re-seeds at the machine origin instead of carrying
  // the previous group's exit.
  {
    const layers = ['A', 'B', 'C'].map((id, index) =>
      cutGroup(
        id,
        gridSquares(3, 2, 120, 8).map((segment) => translate(segment, 20 + index * 30, 20)),
      ),
    );
    const job = { groups: layers };
    const current = plan(job);
    const chained = chainGroups(current, { x: 0, y: 0 }, false);
    const chainedRefined = chainGroups(current, { x: 0, y: 0 }, true);
    report.probes.push(
      compare(
        'P3a three layers: per-group origin seed (planner) vs carried cursor, nearest-neighbour only',
        current,
        chained,
        'Group order is unchanged; each later group is nearest-neighbour ordered from where the previous one ended.',
      ),
      compare(
        'P3b three layers: per-group origin seed (planner) vs carried cursor plus 2-opt/Or-opt, park return scored',
        current,
        chainedRefined,
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Probe 4. closedShapeStart defaults to 'drawn'. Settings-only comparison.
  {
    const shapes = gridSquares(8, 6, 45, 30).map((segment) => translate(segment, 10, 10));
    const job = { groups: [cutGroup('starts', shapes)] };
    const drawn = measure(plan(job));
    const nearest = measure(plan(job, { ...defaults, closedShapeStart: 'nearest' }));
    const corner = measure(plan(job, { ...defaults, closedShapeStart: 'nearest-corner' }));
    report.probes.push({
      name: 'P4 closedShapeStart on 48 squares: drawn (default) vs nearest vs nearest-corner',
      drawn: strip(drawn),
      nearest: strip(nearest),
      nearestCorner: strip(corner),
      rapidMmSavedPercentNearest: percent(drawn.rapidMm, nearest.rapidMm),
      totalSecondsSavedPercentNearest: percent(drawn.totalSeconds, nearest.totalSeconds),
    });
  }

  // ---------------------------------------------------------------------
  // Probe 5. Open paths: entry-only greed. (a) parallel lines must serpentine;
  // (b) the nearest entry can commit the head to the far side of the sheet.
  {
    const lines = Array.from({ length: 20 }, (_, i) =>
      segment([
        [10, 10 + i * 5],
        [210, 10 + i * 5],
      ]),
    );
    const planned = plan({ groups: [cutGroup('hatch', lines)] }).groups[0].segments;
    const serpentineTravel = routeTravel(planned, { x: 0, y: 0 });
    report.probes.push({
      name: 'P5a twenty parallel open lines with allow-reverse',
      plannedTravelMm: round(serpentineTravel),
      idealSerpentineTravelMm: round(Math.hypot(10, 10) + 19 * 5),
      serpentine: planned.every((line, i) => (line.polyline[0].x === 10) === (i % 2 === 0)),
    });

    // (b) The emitted program parks at the origin (grbl-strategy postamble), so
    // the realised route is a closed tour. Reference refinement with and
    // without that final hop, against the planner's own ending.
    const shapes = randomSquares(60, 7, 380, 280, 20261024);
    const job = { groups: [cutGroup('return', shapes)] };
    const current = plan(job, { ...defaults, insideFirst: false });
    const openPath = improveClosedTour(current.groups[0].segments, { x: 0, y: 0 });
    const closedTour = improveClosedTour(current.groups[0].segments, { x: 0, y: 0 }, true);
    const last = (segments) => segments.at(-1).polyline.at(-1);
    report.probes.push({
      ...compare(
        'P5b park return: planner vs reference refinement that also scores the final hop to origin',
        current,
        { groups: [{ ...job.groups[0], segments: closedTour }] },
      ),
      finalHopMm: {
        planner: round(distance(last(current.groups[0].segments), { x: 0, y: 0 })),
        openPathRefinement: round(distance(last(openPath), { x: 0, y: 0 })),
        closedTourRefinement: round(distance(last(closedTour), { x: 0, y: 0 })),
      },
    });
  }

  // ---------------------------------------------------------------------
  // Probe 6. A chosen job start point is moved to the front; the rest of the
  // group keeps its origin-seeded order, so the second hop runs back across
  // the sheet.
  {
    const shapes = gridSquares(8, 6, 45, 30).map((segment) => translate(segment, 10, 10));
    const job = { groups: [cutGroup('start', shapes)] };
    const planned = plan(job);
    const options = startPoint.jobStartPointOptions(defaults);
    const target = { x: 380, y: 280 };
    const started = startPoint.applyJobStartPoint(planned, target, options);
    const first = started.groups[0].segments[0];
    const rest = started.groups[0].segments.slice(1);
    const replanned = {
      groups: [
        {
          ...started.groups[0],
          segments: [first, ...improveClosedTour(rest, first.polyline.at(-1), true)],
        },
      ],
    };
    report.probes.push(
      compare(
        'P6 job start point at far corner: planner vs reference re-plan from the start',
        started,
        replanned,
        'The planner chain is broken at the chosen start; both routes begin on the same contour.',
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Probe 7. CNC: climb/conventional hole detection reads winding against the
  // largest contour. Source windings are mixed on purpose; the offset engine
  // is expected to normalise them before enforcement.
  {
    const ccw = [
      { x: 20, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 60 },
      { x: 20, y: 60 },
    ];
    const cw = [
      { x: 100, y: 20 },
      { x: 100, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 20 },
    ];
    const plate = [
      { x: 200, y: 20 },
      { x: 300, y: 20 },
      { x: 300, y: 120 },
      { x: 200, y: 120 },
    ];
    const hole = [
      { x: 240, y: 60 },
      { x: 260, y: 60 },
      { x: 260, y: 80 },
      { x: 240, y: 80 },
    ];
    const probe = {};
    for (const cutType of ['profile-outside', 'profile-inside', 'profile-on-path']) {
      const sceneForCnc = {
        layers: [
          {
            ...scene.createLayer({ id: 'L', color: '#ff0000' }),
            cnc: {
              ...scene.DEFAULT_CNC_LAYER_SETTINGS,
              cutType,
              depthMm: 1,
              depthPerPassMm: 1,
              tabsEnabled: false,
              rampEntryDeg: 0,
            },
          },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O',
            source: 'mixed-winding-audit.svg',
            bounds: { minX: 20, minY: 20, maxX: 300, maxY: 120 },
            transform: scene.IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [ccw, cw, plate, hole].map((points) => ({ closed: true, points })),
              },
            ],
          },
        ],
      };
      const job = cncCompiler.compileCncJob(
        sceneForCnc,
        devices.DEFAULT_DEVICE_PROFILE,
        scene.DEFAULT_CNC_MACHINE_CONFIG,
      );
      // Side-offset profiles carry ADR-250 lead arcs and come out as path3d;
      // the lead is small, so the XY shoelace sign is still the contour's.
      probe[cutType] = job.groups.flatMap((group) =>
        group.passes
          .filter((pass) => pass.kind === 'contour' || pass.kind === 'path3d')
          .map((pass) => {
            const points = pass.kind === 'contour' ? pass.polyline.slice(0, -1) : pass.points;
            const area = orientation.signedAreaMm2(points);
            const box = bounds(points);
            return {
              kind: pass.kind,
              at: `x${round(box.minX)}-${round(box.maxX)}`,
              widthMm: round(box.maxX - box.minX),
              winding: area > 0 ? 'ccw' : 'cw',
            };
          }),
      );
    }
    report.probes.push({
      name: 'P7 CNC climb default with mixed source windings (ccw square, cw square, plate with hole)',
      expectation:
        'profile-outside: outers cw, hole ccw. profile-inside: outers ccw, hole cw. on-path: no enforcement.',
      emitted: probe,
    });
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await server?.close();
}

// ---------------------------------------------------------------------------
// Fixtures

function segment(points, closed = false) {
  return { closed, polyline: points.map(([x, y]) => ({ x, y })) };
}

function square(x, y, side) {
  return segment(
    [
      [x, y],
      [x + side, y],
      [x + side, y + side],
      [x, y + side],
      [x, y],
    ],
    true,
  );
}

function translate(seg, dx, dy) {
  return { ...seg, polyline: seg.polyline.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

function cutGroup(layerId, segments) {
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

function gridSquares(cols, rows, pitch, side) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(square(c * pitch, r * pitch, side));
  return out;
}

function randomSquares(count, side, width, height, seed) {
  const random = generator(seed);
  return Array.from({ length: count }, () =>
    square(
      round(5 + random() * (width - side - 10)),
      round(5 + random() * (height - side - 10)),
      side,
    ),
  );
}

function clusteredSquares(count, clusters, side, seed) {
  const random = generator(seed);
  const centres = Array.from({ length: clusters }, (_, i) => ({
    x: 60 + (i % 2) * 240,
    y: 60 + Math.floor(i / 2) * 160,
  }));
  return Array.from({ length: count }, (_, i) => {
    const c = centres[i % clusters];
    return square(round(c.x + (random() - 0.5) * 60), round(c.y + (random() - 0.5) * 60), side);
  });
}

function partsGrid({ cols, rows, pitch, outer, hole, holes }) {
  const parts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 10 + c * pitch;
      const y = 10 + r * pitch;
      const part = { outer: square(x, y, outer), holes: [] };
      for (let h = 0; h < holes; h++) {
        part.holes.push(square(x + 5 + h * (outer - hole - 10), y + outer / 2 - hole / 2, hole));
      }
      parts.push(part);
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Candidate routes

function partMajorRoute(parts, start) {
  const remaining = new Set(parts.map((_, i) => i));
  let cursor = start;
  const order = [];
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const d = distance(cursor, parts[index].outer.polyline[0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    remaining.delete(best);
    order.push(best);
    cursor = parts[best].outer.polyline[0];
  }
  const route = [];
  cursor = start;
  for (const index of order) {
    const part = parts[index];
    const holes = nearestNeighbourClosed(part.holes, cursor);
    route.push(...holes, part.outer);
    cursor = part.outer.polyline.at(-1);
  }
  return route;
}

function nearestNeighbourClosed(segments, start) {
  const remaining = new Set(segments.map((_, i) => i));
  let cursor = start;
  const out = [];
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const d = distance(cursor, segments[index].polyline[0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    remaining.delete(best);
    out.push(segments[best]);
    cursor = segments[best].polyline.at(-1);
  }
  return out;
}

// 2-opt and Or-opt on a path with a fixed start, for closed contours whose
// entry and exit coincide (so reversing a sub-sequence changes no geometry).
// `scoreReturn` adds the final hop back to `start`, as the emitted park does.
function improveClosedTour(segments, start, scoreReturn = false) {
  assert.ok(segments.every((s) => s.closed));
  const pts = segments.map((s) => s.polyline[0]);
  let order = segments.map((_, i) => i);
  const cost = (o) => {
    let total = distance(start, pts[o[0]]);
    for (let i = 1; i < o.length; i++) total += distance(pts[o[i - 1]], pts[o[i]]);
    return scoreReturn ? total + distance(pts[o[o.length - 1]], start) : total;
  };
  let best = cost(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const c = cost(next);
        if (c < best - 1e-9) {
          order = next;
          best = c;
          improved = true;
        }
      }
    }
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= order.length; i++) {
        const chunk = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const next = [...rest.slice(0, k), ...chunk, ...rest.slice(k)];
          const c = cost(next);
          if (c < best - 1e-9) {
            order = next;
            best = c;
            improved = true;
          }
        }
      }
    }
  }
  return order.map((i) => segments[i]);
}

function exhaustiveClosedTour(segments, start, scoreReturn = false) {
  const pts = segments.map((s) => s.polyline[0]);
  let best = null;
  let bestCost = Infinity;
  const visit = (order, remaining, cursor, travelled) => {
    if (travelled >= bestCost) return;
    if (remaining.length === 0) {
      const total = scoreReturn ? travelled + distance(cursor, start) : travelled;
      if (total < bestCost) {
        best = order;
        bestCost = total;
      }
      return;
    }
    for (const i of remaining) {
      visit(
        [...order, i],
        remaining.filter((r) => r !== i),
        pts[i],
        travelled + distance(cursor, pts[i]),
      );
    }
  };
  visit(
    [],
    segments.map((_, i) => i),
    start,
    0,
  );
  return best.map((i) => segments[i]);
}

function chainGroups(job, start, refine) {
  let cursor = start;
  const groups = job.groups.map((group, index) => {
    const greedy = nearestNeighbourClosed(group.segments, cursor);
    const segments = refine
      ? improveClosedTour(greedy, cursor, index === job.groups.length - 1)
      : greedy;
    cursor = segments.at(-1).polyline.at(-1);
    return { ...group, segments };
  });
  return { ...job, groups };
}

// ---------------------------------------------------------------------------
// Independent oracle: ray-casting point-in-polygon on vertex 0 plus bounds
// containment, never the production containment module.

function assertPrecedence(segments) {
  const position = new Map(segments.map((s, i) => [s, i]));
  for (const container of segments) {
    if (!container.closed) continue;
    const box = bounds(container.polyline);
    for (const inner of segments) {
      if (inner === container) continue;
      const innerBox = bounds(inner.polyline);
      if (!boxContains(box, innerBox) || boxContains(innerBox, box)) continue;
      if (!pointInPolygon(inner.polyline[0], container.polyline)) continue;
      assert.ok(
        position.get(inner) < position.get(container),
        'Candidate route cuts a container before a contour inside it',
      );
    }
  }
}

function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Measurement helpers

function canonicalSegment(seg) {
  const pts = seg.polyline;
  if (seg.closed) {
    const ring = pts.slice(0, -1).map((p) => `${p.x},${p.y}`);
    const rotations = ring.map((_, i) => [...ring.slice(i), ...ring.slice(0, i)].join(';'));
    return `closed:${rotations.sort()[0]}`;
  }
  const forward = pts.map((p) => `${p.x},${p.y}`).join(';');
  const backward = [...pts]
    .reverse()
    .map((p) => `${p.x},${p.y}`)
    .join(';');
  return `open:${forward < backward ? forward : backward}`;
}

// Every emitted burn move as an undirected endpoint pair with its feed and
// power words, sorted: the same burn in another order or direction compares
// equal, a changed burn does not.
function burnMoves(program) {
  let cursor = { x: 0, y: 0 };
  const moves = [];
  for (const line of program.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const next = {
      x: Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? cursor.x),
      y: Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? cursor.y),
    };
    if (line.startsWith('G1 ')) {
      const words = line.replace(/[XY]-?[\d.]+\s?/g, '').trim();
      const a = `${cursor.x},${cursor.y}`;
      const b = `${next.x},${next.y}`;
      moves.push(`${a < b ? `${a}|${b}` : `${b}|${a}`} ${words}`);
    }
    cursor = next;
  }
  return moves.sort();
}

function strip(measured) {
  return Object.fromEntries(Object.entries(measured).filter(([key]) => key !== 'burnLines'));
}

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

function routeTravel(segments, start) {
  let cursor = start;
  let total = 0;
  for (const seg of segments) {
    total += distance(cursor, seg.polyline[0]);
    cursor = seg.polyline.at(-1);
  }
  return total;
}

// Trapezoidal rapid: below v^2/a the head never reaches full speed, so short
// hops cost far more per millimetre than long ones.
function rapidTimeTable(vMmPerSec, aMmPerSec2) {
  const threshold = (vMmPerSec * vMmPerSec) / aMmPerSec2;
  return [1, 2, 5, 10, 20, 50, 100, 300].map((d) => {
    const seconds =
      d < threshold ? 2 * Math.sqrt(d / aMmPerSec2) : d / vMmPerSec + vMmPerSec / aMmPerSec2;
    return { hopMm: d, seconds: round(seconds), msPerMm: round((seconds * 1000) / d) };
  });
}

function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function boxContains(outer, inner) {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function maxY(seg) {
  return bounds(seg.polyline).maxY;
}

function minX(seg) {
  return bounds(seg.polyline).minX;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function percent(current, candidate) {
  return current === 0 ? 0 : round(100 * (1 - candidate / current));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
