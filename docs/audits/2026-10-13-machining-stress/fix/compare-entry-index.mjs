import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sourcePath = 'src/core/job/segment-entry-index.ts';
const baselineCommit = 'c700863a14dfbed71a49e32182ec3b75b989ebb1';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:${sourcePath}`], {
  cwd: root,
  encoding: 'utf8',
});
const changedSource = readFileSync(new URL(`../../../../${sourcePath}`, import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
assert.notEqual(hash(baselineSource), hash(changedSource), 'The index must differ from baseline.');

function random(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function fixtures() {
  return Array.from({ length: 32 }, (_, seed) => {
    const next = random(seed + 1);
    const segments = Array.from({ length: 100 }, (_, index) => {
      const x = seed < 8 ? 0 : Math.floor(next() * 8) * 10;
      const y = seed < 8 ? 0 : Math.floor(next() * 8) * 10;
      const closed = index % 3 === 0;
      const polyline = [
        { x, y },
        { x: x + 1 + (index % 5), y },
        { x: x + 1 + (index % 5), y: y + 2 },
        ...(closed
          ? [
              { x, y: y + 2 },
              { x, y },
            ]
          : []),
      ];
      return { closed, polyline };
    });
    return {
      groups: [
        {
          kind: 'cut',
          layerId: `seed-${seed + 1}`,
          color: '#000',
          power: 37,
          speed: 1200,
          passes: 2,
          airAssist: true,
          segments,
        },
      ],
    };
  });
}

// Independent exhaustive oracle: equal numeric coordinates do not imply equal
// entries; preserve signed zero and every original object in the selected result.
function oracle(entries, cursor, available) {
  return (
    entries
      .filter((entry) => available(entry.segmentIndex))
      .map((entry, ordinal) => ({
        entry,
        ordinal,
        distance: (entry.point.x - cursor.x) ** 2 + (entry.point.y - cursor.y) ** 2,
      }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.entry.segmentIndex - b.entry.segmentIndex ||
          Number(a.entry.reverse) - Number(b.entry.reverse) ||
          (a.entry.vertexIndex ?? 0) - (b.entry.vertexIndex ?? 0) ||
          a.ordinal - b.ordinal,
      )[0]?.entry ?? null
  );
}

function directCases(queryFactory) {
  let queries = 0;
  const selections = [];
  const scales = [0, Number.MIN_VALUE, 1e-150, 1, 1e140];
  for (const scale of scales) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = random(seed);
      const entries = Array.from({ length: 180 }, (_, index) => ({
        point: {
          x: index % 7 === 0 ? -0 : (Math.floor(next() * 6) - 3) * scale,
          y: index % 11 === 0 ? -0 : (Math.floor(next() * 6) - 3) * scale,
        },
        segmentIndex: Math.floor(index / 3),
        reverse: index % 2 === 0,
        ...(index % 4 === 0 ? {} : { vertexIndex: index % 3 }),
      }));
      // Original array order intentionally differs from the semantic tie order.
      entries.reverse();
      const query = queryFactory(entries);
      const retired = new Set();
      const available = (index) => !retired.has(index);
      let cursor = { x: scale * 20, y: -scale * 10 };
      for (let count = 0; count <= 60; count += 1) {
        const expected = oracle(entries, cursor, available);
        const actual = query(cursor, available);
        assert.deepEqual(
          actual,
          expected,
          `oracle mismatch scale=${scale}, seed=${seed}, query=${count}`,
        );
        if (actual !== null) assert.equal(actual, expected, 'Return the original selected entry.');
        queries += 1;
        selections.push(actual === null ? null : entries.indexOf(actual));
        if (actual === null) break;
        retired.add(actual.segmentIndex);
        cursor = count % 2 === 0 ? actual.point : { x: -scale * 12, y: scale * 9 };
      }
    }
  }
  return { queries, selectionDigest: hash(JSON.stringify(selections)) };
}

async function evaluate(label, source) {
  let interceptCount = 0;
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: `audit-${label}-entry-index`,
        enforce: 'pre',
        load(id) {
          if (id.replaceAll('\\', '/').split('?')[0].endsWith(`/${sourcePath}`)) {
            interceptCount += 1;
            return source;
          }
        },
      },
    ],
  });
  try {
    const load = (path) => server.ssrLoadModule(`${root}${path}`);
    const { createNearestEntryQuery } = await load(sourcePath);
    const direct = directCases(createNearestEntryQuery);
    const { optimizePaths } = await load('src/core/job/optimize-paths.ts');
    const { selectOutputStrategy } = await load('src/core/output/select-output-strategy.ts');
    const { DEFAULT_DEVICE_PROFILE } = await load('src/core/devices/index.ts');
    const { encodeRdJob } = await load('src/core/controllers/ruida/rd-encoder.ts');
    const programs = [];
    const orderedJobs = [];
    for (const job of fixtures()) {
      for (const pathDirection of ['preserve', 'allow-reverse']) {
        for (const closedShapeStart of ['drawn', 'nearest', 'nearest-corner']) {
          const ordered = optimizePaths(job, {
            travelPolicy: 'nearest-neighbor',
            insideFirst: false,
            layerPriority: 'project-order',
            pathDirection,
            startPoint: 'machine-origin',
            closedShapeStart,
          });
          assert.equal(ordered.groups[0].segments.length, job.groups[0].segments.length);
          orderedJobs.push(JSON.stringify(ordered));
          for (const controllerKind of [
            'grbl-v1.1',
            'grblhal',
            'fluidnc',
            'marlin',
            'smoothieware',
          ]) {
            const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind };
            programs.push(selectOutputStrategy(device).emit(ordered, device));
          }
          const rd = encodeRdJob(ordered, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' });
          assert.equal(rd.ok, true);
          programs.push(Buffer.from(rd.bytes).toString('hex'));
        }
      }
    }
    assert.ok(interceptCount > 0, 'Vite must actually intercept the index source.');
    return { direct, programs, orderedJobs, interceptCount };
  } finally {
    await server.close();
  }
}

const baseline = await evaluate('baseline', baselineSource);
const changed = await evaluate('changed', changedSource);
assert.deepEqual(changed.direct, baseline.direct);
assert.deepEqual(changed.orderedJobs, baseline.orderedJobs);
assert.deepEqual(changed.programs, baseline.programs);
console.log(
  JSON.stringify(
    {
      baselineCommit,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      baselineSourceSha256: hash(baselineSource),
      changedSourceSha256: hash(changedSource),
      sourceOverridesLoaded: { baseline: baseline.interceptCount, changed: changed.interceptCount },
      directQueriesPerVersion: baseline.direct.queries,
      directSelectionDigest: baseline.direct.selectionDigest,
      comparedOrderedJobs: baseline.orderedJobs.length,
      comparedPrograms: baseline.programs.length,
      programSetSha256: hash(JSON.stringify(baseline.programs)),
      result:
        'Exact ordered-job, G-code and Ruida binary equality; direct queries match independent exhaustive oracle.',
      assumptions:
        'Monotonically retired segments. Exact-coordinate duplicates, shuffled ties, signed zero, subnormal, underflow, huge finite coordinates. Software-only; no hardware or wall-time claim.',
    },
    null,
    2,
  ),
);
