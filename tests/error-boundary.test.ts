/**
 * T2-114: React error boundary at the app root + global window error
 * and unhandled-rejection handlers. Pre-T2-114 the renderer had no
 * `componentDidCatch`, no `window.onerror`, and no
 * `unhandledrejection` listener — Audit 5C Critical 2 + P8.
 *
 * The React boundary itself is exercised in detail by source pin +
 * lifecycle method invocation; this file does NOT spin up a DOM
 * because tests run under tsx without jsdom. The lifecycle methods
 * are pure enough to call directly.
 *
 * Run: npx tsx tests/error-boundary.test.ts
 */
import {
  AppErrorBoundary,
  type CrashReport,
} from '../src/diagnostics/AppErrorBoundary';
import {
  installGlobalErrorHandlers,
  type GlobalErrorReport,
  type InstallOptions,
} from '../src/diagnostics/installGlobalErrorHandlers';

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

console.log('\n=== T2-114 Error boundary + global handlers ===\n');

void (async () => {

// Helper: build a fresh boundary instance without rendering. Class
// methods are pure enough to invoke directly.
function makeBoundary(props: ConstructorParameters<typeof AppErrorBoundary>[0] = { children: null }): AppErrorBoundary {
  // The class is a React.Component; constructing without props/context
  // is fine because we only invoke lifecycle methods directly.
  const instance = new AppErrorBoundary(props);
  // Simulate React's setState — capture the merged state without a
  // mount cycle.
  instance.setState = function (this: AppErrorBoundary, updater) {
    const next = typeof updater === 'function'
      ? (updater as (s: typeof instance.state) => Partial<typeof instance.state>)(instance.state)
      : updater;
    instance.state = { ...instance.state, ...next } as typeof instance.state;
  } as typeof instance.setState;
  return instance;
}

// 1. getDerivedStateFromError: returns hasError + populated report
{
  const err = new Error('boom');
  const next = AppErrorBoundary.getDerivedStateFromError(err);
  assert(next.hasError === true, 'getDerivedStateFromError: hasError=true');
  assert(next.report?.message === 'boom',
    `getDerivedStateFromError: report.message='boom' (got '${next.report?.message}')`);
}

// 2. getDerivedStateFromError: capturedAt is ISO 8601
{
  const next = AppErrorBoundary.getDerivedStateFromError(new Error('x'));
  const t = next.report ? Date.parse(next.report.capturedAt) : NaN;
  assert(Number.isFinite(t), `capturedAt parses as ISO date (got ${next.report?.capturedAt})`);
}

// 3. componentDidCatch: invokes onCrash sink with merged componentStack
{
  const reports: CrashReport[] = [];
  const b = makeBoundary({ children: null, onCrash: (r) => reports.push(r) });
  b.componentDidCatch(new Error('boom2'), { componentStack: '\n    at Foo\n    at Bar' });
  assert(reports.length === 1, `onCrash invoked once (got ${reports.length})`);
  assert(reports[0].message === 'boom2', `report.message='boom2'`);
  assert(reports[0].componentStack?.includes('at Foo') === true,
    `componentStack includes React stack frames`);
}

// 4. componentDidCatch: sink failures are swallowed (no re-throw)
{
  const b = makeBoundary({
    children: null,
    onCrash: () => { throw new Error('sink broken'); },
  });
  let threw = false;
  try {
    b.componentDidCatch(new Error('boom'), { componentStack: '' });
  } catch {
    threw = true;
  }
  assert(!threw, 'componentDidCatch swallows sink errors (no re-throw)');
}

// 5. handleRecover: clears hasError and calls onRecover
{
  let recovered = 0;
  const b = makeBoundary({ children: null, onRecover: () => { recovered++; } });
  b.state = { hasError: true, report: { message: 'x', capturedAt: '' } };
  b.handleRecover();
  assert(b.state.hasError === false, 'handleRecover: hasError → false');
  assert(b.state.report === null, 'handleRecover: report → null');
  assert(recovered === 1, `onRecover called once (got ${recovered})`);
}

// 6. handleRecover: onRecover throw is swallowed (still resets state)
{
  const b = makeBoundary({
    children: null,
    onRecover: () => { throw new Error('recover broken'); },
  });
  b.state = { hasError: true, report: { message: 'x', capturedAt: '' } };
  b.handleRecover();
  assert(b.state.hasError === false,
    'handleRecover: state still resets even when onRecover throws');
}

// 7. installGlobalErrorHandlers: 'error' event reaches sink
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  const opts: InstallOptions = {
    onReport: (r) => reports.push(r),
    target,
  };
  installGlobalErrorHandlers(opts);
  target.dispatch('error', {
    message: 'window error',
    error: new Error('actual error'),
    filename: 'app.js',
    lineno: 42,
    colno: 7,
  } as unknown as ErrorEvent);
  assert(reports.length === 1, `'error' event reaches sink (got ${reports.length})`);
  assert(reports[0].kind === 'error', `kind='error'`);
  assert(reports[0].message === 'window error', `message preserved`);
  assert(reports[0].filename === 'app.js' && reports[0].lineno === 42 && reports[0].colno === 7,
    `location fields preserved`);
}

// 8. 'unhandledrejection' event reaches sink with Error reason
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  target.dispatch('unhandledrejection', {
    reason: new Error('rejected'),
  } as unknown as PromiseRejectionEvent);
  assert(reports.length === 1 && reports[0].kind === 'unhandledrejection',
    `unhandledrejection: kind='unhandledrejection'`);
  assert(reports[0].message === 'rejected', `Error.reason: message='rejected'`);
}

// 9. unhandledrejection with string reason
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  target.dispatch('unhandledrejection', { reason: 'plain string' } as unknown as PromiseRejectionEvent);
  assert(reports[0].message === 'plain string',
    `string reason: message='plain string'`);
}

// 10. unhandledrejection with object reason → JSON-stringified
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  target.dispatch('unhandledrejection', { reason: { code: 42, why: 'bad' } } as unknown as PromiseRejectionEvent);
  assert(reports[0].message.includes('"code":42'),
    `object reason: message includes JSON (got '${reports[0].message}')`);
}

// 11. unhandledrejection with null reason
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  target.dispatch('unhandledrejection', { reason: null } as unknown as PromiseRejectionEvent);
  assert(/no reason/i.test(reports[0].message),
    `null reason: message names absence (got '${reports[0].message}')`);
}

// 12. uninstall() detaches both handlers
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  const uninstall = installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  uninstall();
  target.dispatch('error', { message: 'after uninstall' } as unknown as ErrorEvent);
  target.dispatch('unhandledrejection', { reason: 'after uninstall' } as unknown as PromiseRejectionEvent);
  assert(reports.length === 0, `after uninstall: 0 reports (got ${reports.length})`);
}

// 13. Sink errors swallowed in handlers
{
  const target = makeMockTarget();
  installGlobalErrorHandlers({
    onReport: () => { throw new Error('sink broken'); },
    target,
  });
  let threw = false;
  try {
    target.dispatch('error', { message: 'x' } as unknown as ErrorEvent);
  } catch {
    threw = true;
  }
  assert(!threw, 'global error handler swallows sink errors');
}

// 14. Stack extracted from Error reason; not from non-Error
{
  const reports: GlobalErrorReport[] = [];
  const target = makeMockTarget();
  installGlobalErrorHandlers({ onReport: (r) => reports.push(r), target });
  const err = new Error('with stack');
  target.dispatch('unhandledrejection', { reason: err } as unknown as PromiseRejectionEvent);
  assert(reports[0].stack?.includes('with stack') === true,
    `Error reason: stack extracted`);

  target.dispatch('unhandledrejection', { reason: 'no stack' } as unknown as PromiseRejectionEvent);
  assert(reports[1].stack === undefined,
    `string reason: stack=undefined`);
}

// 15. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const boundary = fs.readFileSync(
    path.resolve(repoRoot, 'src/diagnostics/AppErrorBoundary.tsx'), 'utf-8',
  );
  assert(/T2-114/.test(boundary), 'T2-114 marker in AppErrorBoundary.tsx');
  assert(/getDerivedStateFromError/.test(boundary),
    'getDerivedStateFromError declared');
  assert(/componentDidCatch/.test(boundary), 'componentDidCatch declared');

  const handlers = fs.readFileSync(
    path.resolve(repoRoot, 'src/diagnostics/installGlobalErrorHandlers.ts'), 'utf-8',
  );
  assert(/T2-114/.test(handlers), 'T2-114 marker in installGlobalErrorHandlers.ts');
  assert(/addEventListener\(['"]error['"]/.test(handlers),
    `'error' event listener installed`);
  assert(/addEventListener\(['"]unhandledrejection['"]/.test(handlers),
    `'unhandledrejection' event listener installed`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

// ─── helpers ───────────────────────────────────────────────────

interface MockTarget {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
  dispatch: (type: string, event: Event) => void;
}

function makeMockTarget(): MockTarget {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event) {
      const set = listeners.get(type);
      if (!set) return;
      for (const l of set) l(event);
    },
  };
}
