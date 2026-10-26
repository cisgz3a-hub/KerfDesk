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
import {
  segment,
  translate,
  cutGroup,
  gridSquares,
  randomSquares,
  clusteredSquares,
  partsGrid,
  partMajorRoute,
  improveClosedTour,
  exhaustiveClosedTour,
  chainGroups,
  assertPrecedence,
  burnMoves,
  canonicalSegment,
  strip,
  rapidDistance,
  routeTravel,
  rapidTimeTable,
  bounds,
  maxY,
  minX,
  distance,
  percent,
  round,
} from './audit-path-order-math-support.mjs';

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
