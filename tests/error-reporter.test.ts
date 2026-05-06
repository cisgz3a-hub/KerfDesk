/**
 * T2-65: central error reporter. Pre-T2-65 every error site reached
 * for a different surface (`appendMessage` / `showAlert` /
 * `console.warn` / silent catch). Audit 4C Critical 1 + Required
 * Priority 1.
 *
 * Run: npx tsx tests/error-reporter.test.ts
 */
import {
  ErrorReporter,
  errorReporter,
  reportError,
  surfacesFor,
  errorFromCatch,
  generateErrorId,
  resetErrorIdCounter,
  type UserFacingError,
} from '../src/app/ErrorReporter';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-65 ErrorReporter ===\n');

void (async () => {

// 1. surfacesFor: severity routing
{
  assert(surfacesFor('info').includes('console') && !surfacesFor('info').includes('toast'),
    `info → console only`);
  assert(surfacesFor('warning').includes('toast'),
    `warning → toast`);
  assert(surfacesFor('error').includes('banner'),
    `error → banner`);
  assert(surfacesFor('critical').includes('modal') && surfacesFor('critical').includes('banner'),
    `critical → modal + banner`);
}

// 2. generateErrorId in deterministic mode
{
  resetErrorIdCounter();
  const id1 = generateErrorId(1000);
  const id2 = generateErrorId(1000);
  assert(id1 === 'err_det_000001' && id2 === 'err_det_000002',
    `det IDs sequential (got ${id1}, ${id2})`);
}

// 3. reporter.report: assigns id + timestamp + appends history
{
  const r = new ErrorReporter();
  resetErrorIdCounter();
  const e = r.report({
    domain: 'connection', severity: 'error',
    title: 'Connection failed', message: 'COM3 busy',
  }, 1000);
  assert(e.id.startsWith('err_'), `id assigned (got ${e.id})`);
  assert(e.timestamp === 1000, `timestamp set`);
  assert(r.getHistory().length === 1, `history length=1`);
  assert(r.getHistory()[0] === e, `history contains the reported error`);
}

// 4. reporter.report: invokes listeners
{
  const r = new ErrorReporter();
  const seen: UserFacingError[] = [];
  const unsub = r.subscribe((e) => seen.push(e));
  r.report({ domain: 'compile', severity: 'warning', title: 't', message: 'm' });
  assert(seen.length === 1 && seen[0].domain === 'compile',
    `listener invoked`);
  unsub();
  r.report({ domain: 'compile', severity: 'warning', title: 't', message: 'm' });
  assert(seen.length === 1, `unsubscribe stops further notifications`);
}

// 5. reporter.report: throwing listener doesn't break other listeners
{
  const r = new ErrorReporter();
  const seen: UserFacingError[] = [];
  r.subscribe(() => { throw new Error('broken'); });
  r.subscribe((e) => seen.push(e));
  let threw = false;
  try {
    r.report({ domain: 'system', severity: 'error', title: 't', message: 'm' });
  } catch { threw = true; }
  assert(!threw, `report does NOT propagate listener exceptions`);
  assert(seen.length === 1, `second listener still fired`);
}

// 6. getHistory: domain filter
{
  const r = new ErrorReporter();
  r.report({ domain: 'connection', severity: 'error', title: 't', message: 'm' });
  r.report({ domain: 'compile', severity: 'warning', title: 't', message: 'm' });
  r.report({ domain: 'compile', severity: 'error', title: 't', message: 'm' });
  assert(r.getHistory().length === 3, `total 3`);
  assert(r.getHistory('compile').length === 2, `filter compile → 2`);
  assert(r.getHistory('connection').length === 1, `filter connection → 1`);
  assert(r.getHistory('job').length === 0, `filter job → 0`);
}

// 7. setMaxHistory: bounded retention evicts oldest
{
  const r = new ErrorReporter();
  r.setMaxHistory(3);
  for (let i = 0; i < 5; i++) {
    r.report({ domain: 'system', severity: 'info', title: `${i}`, message: 'm' });
  }
  const h = r.getHistory();
  assert(h.length === 3, `max=3 (got ${h.length})`);
  assert(h[0].title === '2' && h[2].title === '4',
    `oldest evicted, newest retained`);
}

// 8. resolve: marks error as resolved + replays through listeners
{
  const r = new ErrorReporter();
  const seen: UserFacingError[] = [];
  r.subscribe((e) => seen.push(e));
  const e = r.report({ domain: 'connection', severity: 'error', title: 't', message: 'm' });
  const ok = r.resolve(e.id);
  assert(ok, `resolve returns true for known id`);
  assert(seen.length === 2, `2 listener calls (initial + resolved)`);
  assert(seen[1].resolved === true, `resolved replay carries resolved=true`);
  assert(seen[1].id === e.id, `same id`);
}

// 9. resolve: unknown id returns false
{
  const r = new ErrorReporter();
  assert(r.resolve('err_nonexistent') === false,
    `resolve unknown id returns false`);
}

// 10. errorFromCatch: Error instance → message + stack in developerDetails
{
  const err = new Error('boom');
  const built = errorFromCatch('compile', 'error', 'Compile failed', err);
  assert(built.title === 'Compile failed', `title carried`);
  assert(built.message === 'boom', `Error.message → message`);
  const dev = built.developerDetails as { stack?: string };
  assert(dev?.stack?.includes('boom') === true, `stack in developerDetails`);
}

// 11. errorFromCatch: string → message
{
  const built = errorFromCatch('system', 'warning', 't', 'oops');
  assert(built.message === 'oops', `string thrown → message='oops'`);
  assert(built.developerDetails === 'oops', `string in developerDetails`);
}

// 12. errorFromCatch: unknown object → fallback message
{
  const built = errorFromCatch('system', 'info', 't', { code: 42 });
  assert(/unknown error/i.test(built.message),
    `unknown object → "unknown error" fallback`);
  assert((built.developerDetails as { code?: number })?.code === 42,
    `original object preserved in developerDetails`);
}

// 13. reportError: singleton entry point invokes the global reporter
{
  const seen: UserFacingError[] = [];
  const unsub = errorReporter.subscribe((e) => seen.push(e));
  resetErrorIdCounter();
  reportError({ domain: 'system', severity: 'info', title: 't', message: 'm' });
  assert(seen.length === 1 && seen[0].domain === 'system',
    `reportError reaches the singleton`);
  unsub();
}

// 14. UserFacingError: side-effect hint fields are optional
{
  const r = new ErrorReporter();
  const e = r.report({
    domain: 'machine', severity: 'critical',
    title: 'Alarm', message: 'Hard limit',
    invalidatesFrame: true, invalidatesCompile: false,
    affectsPositionTrust: true, blocksStart: true,
    recoverySteps: ['Clear alarm with $X', 'Re-home'],
  });
  assert(e.invalidatesFrame === true, `invalidatesFrame carried`);
  assert(e.affectsPositionTrust === true, `affectsPositionTrust carried`);
  assert(e.blocksStart === true, `blocksStart carried`);
  assert(e.recoverySteps?.length === 2, `recoverySteps carried`);
}

// 15. End-to-end: connection error → resolve flow
{
  const r = new ErrorReporter();
  const events: UserFacingError[] = [];
  r.subscribe((e) => events.push(e));
  const e1 = r.report({ domain: 'connection', severity: 'error', title: 'COM3 busy', message: 'reopen failed' });
  r.resolve(e1.id);
  assert(events.length === 2, `2 events (initial + resolved)`);
  assert(events[0].resolved !== true, `initial event resolved=undefined`);
  assert(events[1].resolved === true, `replay event resolved=true`);
}

// 16. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/ErrorReporter.ts'), 'utf-8');
  assert(/T2-65/.test(src), 'T2-65 marker in ErrorReporter.ts');
  for (const id of [
    'ErrorReporter', 'UserFacingError', 'ErrorDomain', 'ErrorSeverity',
    'ErrorSurface', 'errorReporter', 'reportError', 'errorFromCatch',
    'surfacesFor', 'generateErrorId', 'resetErrorIdCounter',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const sev of ['info', 'warning', 'error', 'critical']) {
    assert(src.includes(`'${sev}'`), `severity '${sev}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
