/**
 * T1-17-followup-trace-probe: smoke tests for the trace-storm probe.
 * Confirms the start/record/end bracket actually counts commits per
 * component, no-ops when disabled, and produces a sorted summary so
 * the user-facing console output stays deterministic when they paste
 * it into a follow-up session.
 *
 * Run: npx tsx tests/trace-storm-probe.test.ts
 */
import {
  endProbeSession,
  isTraceStormProbeEnabled,
  recordProbeCommit,
  setTraceStormProbeEnabled,
  startProbeSession,
  _peekActiveSessionForTest,
  _resetProbeForTest,
} from '../src/debug/traceStormProbe';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-17-followup-trace-probe ===\n');

// -------- disabled is the default + no-ops everywhere --------
{
  _resetProbeForTest();
  assert(!isTraceStormProbeEnabled(), 'probe disabled by default');
  startProbeSession('label-a');
  assert(_peekActiveSessionForTest() === null, 'startProbeSession is a no-op when disabled');
  recordProbeCommit('App');
  assert(_peekActiveSessionForTest() === null, 'recordProbeCommit is a no-op when disabled');
  const summary = endProbeSession();
  assert(summary === null, 'endProbeSession returns null when no session is active');
}

// -------- end without a start returns null even when enabled --------
{
  _resetProbeForTest();
  setTraceStormProbeEnabled(true);
  const summary = endProbeSession();
  assert(summary === null, 'endProbeSession returns null without a prior start');
}

// -------- enabled bracket counts per component, sorted high→low --------
{
  _resetProbeForTest();
  setTraceStormProbeEnabled(true);
  startProbeSession('trace-to-engrave');

  recordProbeCommit('App');
  recordProbeCommit('App');
  recordProbeCommit('App');
  recordProbeCommit('CanvasViewport');
  recordProbeCommit('CanvasViewport');
  recordProbeCommit('PropertiesPanel');

  const session = _peekActiveSessionForTest();
  assert(session !== null && session.entries.length === 6,
    'active session captured all six commits while open');

  const summary = endProbeSession();
  assert(summary !== null, 'endProbeSession returns a summary after recording');
  assert(summary?.label === 'trace-to-engrave', 'summary carries the session label');
  assert(summary?.totalCommits === 6, 'summary totalCommits matches');
  assert(summary?.perComponent.length === 3, 'summary lists three components');
  assert(summary?.perComponent[0][0] === 'App' && summary?.perComponent[0][1] === 3,
    'top entry is App with 3 commits');
  assert(summary?.perComponent[1][0] === 'CanvasViewport' && summary?.perComponent[1][1] === 2,
    'second entry is CanvasViewport with 2 commits');
  assert(summary?.perComponent[2][0] === 'PropertiesPanel' && summary?.perComponent[2][1] === 1,
    'third entry is PropertiesPanel with 1 commit');

  assert(_peekActiveSessionForTest() === null, 'endProbeSession clears the active session');
}

// -------- duration is non-negative even for an instant session --------
{
  _resetProbeForTest();
  setTraceStormProbeEnabled(true);
  startProbeSession('instant');
  const summary = endProbeSession();
  assert(summary !== null && summary.durationMs >= 0,
    'durationMs is non-negative when start and end run back-to-back');
}

// -------- toggling disabled mid-bracket stops further recording --------
{
  _resetProbeForTest();
  setTraceStormProbeEnabled(true);
  startProbeSession('partial');
  recordProbeCommit('App');
  setTraceStormProbeEnabled(false);
  recordProbeCommit('App');
  recordProbeCommit('CanvasViewport');
  setTraceStormProbeEnabled(true);
  const summary = endProbeSession();
  assert(summary !== null && summary.totalCommits === 1,
    'commits issued while disabled mid-bracket are dropped');
}

// -------- second start without an end overwrites the first --------
{
  _resetProbeForTest();
  setTraceStormProbeEnabled(true);
  startProbeSession('first');
  recordProbeCommit('App');
  startProbeSession('second');
  recordProbeCommit('CanvasViewport');
  const summary = endProbeSession();
  assert(summary !== null && summary.label === 'second',
    'overlapping startProbeSession replaces the active session label');
  assert(summary?.totalCommits === 1,
    'only the second session\'s commits survive');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
