/**
 * T2-117: explicit `CorrelationIds` type. Pre-T2-117 the codebase had
 * per-subsystem IDs (job log, ticket) but no top-level session /
 * project / compile / preflight / frame / bundle correlation. T2-117
 * defines the seven-field type, ID generator, snapshot+update helpers,
 * and a recogniser used by the support bundle pretty-printer.
 *
 * Run: npx tsx tests/correlation-ids.test.ts
 */
import {
  generateCorrelationId,
  resetCorrelationIdCounters,
  emptyCorrelationIds,
  withCorrelationId,
  snapshotCorrelationIds,
  isCorrelationId,
  type CorrelationIds,
  type CorrelationIdPrefix,
} from '../src/diagnostics/CorrelationIds';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-117 Correlation IDs ===\n');

void (async () => {

// 1. generateCorrelationId: deterministic mode (test runner sets
//    LASERFORGE_DETERMINISTIC_IDS=1) → predictable per-prefix sequence
{
  resetCorrelationIdCounters();
  const a = generateCorrelationId('session');
  const b = generateCorrelationId('session');
  assert(a === 'session_det_000001', `det session #1 → 'session_det_000001' (got ${a})`);
  assert(b === 'session_det_000002', `det session #2 → 'session_det_000002' (got ${b})`);
}

// 2. Counters are per-prefix (project sequence is independent of session)
{
  resetCorrelationIdCounters();
  generateCorrelationId('session');
  const p1 = generateCorrelationId('project');
  assert(p1 === 'project_det_000001',
    `det project counter independent of session (got ${p1})`);
}

// 3. All seven prefix kinds accepted
{
  resetCorrelationIdCounters();
  const prefixes: CorrelationIdPrefix[] = [
    'session', 'project', 'compile', 'preflight', 'frame', 'job', 'bundle',
  ];
  for (const p of prefixes) {
    const id = generateCorrelationId(p);
    assert(id.startsWith(`${p}_`),
      `prefix '${p}' produces id starting with '${p}_' (got ${id})`);
  }
}

// 4. emptyCorrelationIds: fresh sessionId, all others null
{
  resetCorrelationIdCounters();
  const ids = emptyCorrelationIds();
  assert(ids.sessionId.startsWith('session_'),
    `emptyCorrelationIds: sessionId is a session ID (got ${ids.sessionId})`);
  assert(ids.projectId === null, 'emptyCorrelationIds: projectId=null');
  assert(ids.compileId === null, 'emptyCorrelationIds: compileId=null');
  assert(ids.preflightId === null, 'emptyCorrelationIds: preflightId=null');
  assert(ids.frameId === null, 'emptyCorrelationIds: frameId=null');
  assert(ids.jobId === null, 'emptyCorrelationIds: jobId=null');
  assert(ids.supportBundleId === null, 'emptyCorrelationIds: supportBundleId=null');
}

// 5. withCorrelationId: immutable update
{
  resetCorrelationIdCounters();
  const ids = emptyCorrelationIds();
  const next = withCorrelationId(ids, 'projectId', 'project_x');
  assert(next.projectId === 'project_x', 'withCorrelationId: new projectId set');
  assert(ids.projectId === null, 'withCorrelationId: original ids object unchanged');
  assert(next.sessionId === ids.sessionId,
    'withCorrelationId: sessionId preserved across update');
}

// 6. Project-load → new projectId, sessionId preserved
{
  resetCorrelationIdCounters();
  const session = emptyCorrelationIds();
  const projectId = generateCorrelationId('project');
  const afterLoad = withCorrelationId(session, 'projectId', projectId);
  assert(afterLoad.sessionId === session.sessionId,
    'project load: sessionId preserved');
  assert(afterLoad.projectId === projectId,
    `project load: projectId set (got ${afterLoad.projectId})`);
}

// 7. Compile → new compileId, parent sessionId/projectId preserved
{
  resetCorrelationIdCounters();
  const session = emptyCorrelationIds();
  const withProj = withCorrelationId(session, 'projectId', generateCorrelationId('project'));
  const withCompile = withCorrelationId(withProj, 'compileId', generateCorrelationId('compile'));
  assert(withCompile.sessionId === session.sessionId,
    'compile: sessionId preserved');
  assert(withCompile.projectId === withProj.projectId,
    'compile: projectId preserved');
  assert(withCompile.compileId !== null && withCompile.compileId.startsWith('compile_'),
    `compile: compileId set (got ${withCompile.compileId})`);
}

// 8. snapshotCorrelationIds: structural copy, value-equal but reference-distinct
{
  resetCorrelationIdCounters();
  const ids = emptyCorrelationIds();
  const snap = snapshotCorrelationIds(ids);
  assert(snap !== ids, 'snapshot: returns a new object');
  assert(snap.sessionId === ids.sessionId, 'snapshot: sessionId equal');
  assert(snap.projectId === ids.projectId, 'snapshot: projectId equal');
}

// 9. isCorrelationId: recognises generated IDs
{
  resetCorrelationIdCounters();
  for (const p of ['session', 'project', 'compile', 'preflight', 'frame', 'job', 'bundle'] as CorrelationIdPrefix[]) {
    const id = generateCorrelationId(p);
    assert(isCorrelationId(id), `isCorrelationId: '${id}' recognised`);
  }
}

// 10. isCorrelationId: rejects non-IDs
{
  assert(!isCorrelationId('plain string'), `isCorrelationId: random string rejected`);
  assert(!isCorrelationId('det-000001'), `isCorrelationId: core/types generateId() rejected`);
  assert(!isCorrelationId(''), `isCorrelationId: empty string rejected`);
  assert(!isCorrelationId(null), `isCorrelationId: null rejected`);
  assert(!isCorrelationId(undefined), `isCorrelationId: undefined rejected`);
  assert(!isCorrelationId(123), `isCorrelationId: number rejected`);
  assert(!isCorrelationId('compile_no_underscore_count'),
    `isCorrelationId: malformed compile_ rejected`);
}

// 11. Each generated ID is unique within a session (deterministic mode)
{
  resetCorrelationIdCounters();
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) ids.add(generateCorrelationId('compile'));
  assert(ids.size === 5,
    `5 sequential compile IDs are all unique (got ${ids.size} unique)`);
}

// 12. Type-shape pin: CorrelationIds has exactly 7 fields
{
  resetCorrelationIdCounters();
  const ids = emptyCorrelationIds();
  const keys = Object.keys(ids).sort();
  const expected = [
    'compileId', 'frameId', 'jobId', 'preflightId',
    'projectId', 'sessionId', 'supportBundleId',
  ].sort();
  assert(keys.join(',') === expected.join(','),
    `CorrelationIds: 7 declared fields (got ${keys.join(',')})`);
}

// 13. End-to-end flow: session → project → compile → preflight → frame → job
{
  resetCorrelationIdCounters();
  let ctx: CorrelationIds = emptyCorrelationIds();
  ctx = withCorrelationId(ctx, 'projectId', generateCorrelationId('project'));
  ctx = withCorrelationId(ctx, 'compileId', generateCorrelationId('compile'));
  ctx = withCorrelationId(ctx, 'preflightId', generateCorrelationId('preflight'));
  ctx = withCorrelationId(ctx, 'frameId', generateCorrelationId('frame'));
  ctx = withCorrelationId(ctx, 'jobId', generateCorrelationId('job'));
  for (const k of ['sessionId', 'projectId', 'compileId', 'preflightId', 'frameId', 'jobId'] as const) {
    assert(ctx[k] !== null && (ctx[k] as string).length > 0,
      `e2e flow: ${k} populated`);
  }
}

// 14. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/CorrelationIds.ts'), 'utf-8');
  assert(/T2-117/.test(src), 'T2-117 marker in CorrelationIds.ts');
  for (const f of [
    'sessionId', 'projectId', 'compileId', 'preflightId',
    'frameId', 'jobId', 'supportBundleId',
  ]) {
    assert(src.includes(f), `field ${f} declared`);
  }
  for (const fn of [
    'generateCorrelationId', 'emptyCorrelationIds',
    'withCorrelationId', 'snapshotCorrelationIds', 'isCorrelationId',
  ]) {
    assert(src.includes(fn), `helper ${fn} exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
