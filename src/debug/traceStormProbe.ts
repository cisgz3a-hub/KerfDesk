/**
 * T1-17-followup-trace probe: lightweight commit-counter for the
 * trace-to-engrave render storm. Pre-T1-17-followup-trace-probe the
 * diagnosis was hypothesis-only (the user declined a flamechart capture
 * after a wall-crash session); without numbers, any fix is guessing
 * upstream of an unconfirmed root cause.
 *
 * This module records per-component React commits during a labeled
 * session bracket. PropertiesPanel.handleTrace opens a session, the
 * useTraceStormProbe hook in App / CanvasViewport / PropertiesPanel
 * records every render, and the session bracket closes when the trace
 * finishes (success or error). Result lands in the console as a sorted
 * per-component count plus total duration. No network/storage I/O.
 *
 * Disabled by default. Only the trace handler enables/disables it
 * around the worker await, so prod and unrelated session work pay only
 * the boolean-check cost in the no-op path.
 *
 * After the user runs trace-to-engrave once with this in place, they
 * can paste the console summary into the next session and we'll have
 * actionable numbers (e.g. "App committed 87 times, CanvasViewport 14,
 * PropertiesPanel 12") to land an informed fix instead of a guess.
 */
import { useEffect } from 'react';

interface ProbeEntry {
  componentName: string;
  /** ms since session start. */
  offsetMs: number;
}

interface ProbeSession {
  label: string;
  startedAt: number;
  entries: ProbeEntry[];
}

let activeSession: ProbeSession | null = null;
let isEnabled = false;

export function setTraceStormProbeEnabled(enabled: boolean): void {
  isEnabled = enabled;
}

export function isTraceStormProbeEnabled(): boolean {
  return isEnabled;
}

export function startProbeSession(label: string): void {
  if (!isEnabled) return;
  activeSession = {
    label,
    startedAt: performance.now(),
    entries: [],
  };
}

export function recordProbeCommit(componentName: string): void {
  if (!isEnabled) return;
  const session = activeSession;
  if (!session) return;
  session.entries.push({
    componentName,
    offsetMs: performance.now() - session.startedAt,
  });
}

export interface ProbeSummary {
  label: string;
  durationMs: number;
  totalCommits: number;
  perComponent: ReadonlyArray<readonly [string, number]>;
}

export function endProbeSession(): ProbeSummary | null {
  const session = activeSession;
  activeSession = null;
  if (!session) return null;

  const durationMs = performance.now() - session.startedAt;
  const counts = new Map<string, number>();
  for (const entry of session.entries) {
    counts.set(entry.componentName, (counts.get(entry.componentName) ?? 0) + 1);
  }
  const perComponent = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  const summary: ProbeSummary = {
    label: session.label,
    durationMs,
    totalCommits: session.entries.length,
    perComponent,
  };

  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    const lines = perComponent.map(([name, count]) => `  ${name}: ${count}`);
    console.info(
      `[trace-storm-probe] ${session.label}\n` +
      `  duration: ${durationMs.toFixed(0)}ms\n` +
      `  total commits: ${session.entries.length}\n` +
      `  per-component:\n${lines.join('\n')}`,
    );
  }

  return summary;
}

/** Test-only: read the active session without ending it. */
export function _peekActiveSessionForTest(): ProbeSession | null {
  return activeSession;
}

/** Test-only: reset module state between cases. */
export function _resetProbeForTest(): void {
  activeSession = null;
  isEnabled = false;
}

/**
 * Hook variant for React components: records a commit on every render
 * (via a no-deps useEffect) when a probe session is active. The
 * `isEnabled` short-circuit keeps this near-free when probing is off.
 */
export function useTraceStormProbe(componentName: string): void {
  useEffect(() => {
    if (!isEnabled) return;
    const session = activeSession;
    if (!session) return;
    session.entries.push({
      componentName,
      offsetMs: performance.now() - session.startedAt,
    });
  });
}
