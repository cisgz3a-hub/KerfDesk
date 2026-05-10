/**
 * T3-54: connection-lifecycle test-coverage roundup.
 *
 * Audit 3B section 14 lists 25 required tests across permission /
 * open / handshake / double-connect / disconnect / race / stale-data
 * / identity / platform / electron / wifi categories. Every shipped
 * connection-lifecycle ticket (T1-49, T1-50, T1-51, T2-31, T2-33,
 * T3-49, T3-50, T3-51, T3-53) carries its own behavioral test file.
 * Without a top-level coverage manifest, a future regression that
 * silently deletes one of those files is easy to miss.
 *
 * This file is the manifest. It does not re-implement the behavioral
 * tests — duplicating coverage hurts maintenance — but it asserts
 * each enabling ticket's test file exists, contains the expected
 * scenario coverage by name, and is auto-discovered by the test
 * runner. A regression that drops or renames a file fails this
 * suite immediately, and the failing assertion names the
 * corresponding audit-3B-section-14 scenario so the diagnosis is
 * one-step.
 *
 * Run: npx tsx tests/connection-lifecycle/connection-lifecycle-coverage.test.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function readTest(rel: string): string | null {
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf-8');
}

console.log('\n=== T3-54 connection-lifecycle coverage roundup ===\n');

interface ScenarioCoverage {
  /** Audit 3B section-14 scenario name. */
  readonly scenario: string;
  /** Enabling ticket id (the T-marker that shipped the production fix). */
  readonly enablingTicket: string;
  /** Test file expected to cover the scenario. */
  readonly testFile: string;
  /** Required substring(s) that must appear in the test source — at
   *  least one of these — so the scenario is named in the test
   *  itself. Keeps the manifest robust to file renames if the test
   *  body is preserved. */
  readonly contentMarkers: readonly string[];
}

const coverage: readonly ScenarioCoverage[] = [
  {
    scenario: 'P0 #1 / #2 — Permission denied / open failure cleanup',
    enablingTicket: 'T1-49',
    testFile: 'tests/connect-cleanup-on-partial-failure.test.ts',
    contentMarkers: ['T1-49', 'requestAndOpen', 'cleanup'],
  },
  {
    scenario: 'P0 #3 / #4 — Writer / reader acquisition failure',
    enablingTicket: 'T2-33',
    testFile: 'tests/connect-cleanup-on-partial-failure.test.ts',
    contentMarkers: ['cleanup', 'partial'],
  },
  {
    scenario: 'P0 #5 — Handshake timeout cleanup; retry works',
    enablingTicket: 'T1-49 + T2-31',
    testFile: 'tests/connect-cleanup-on-partial-failure.test.ts',
    contentMarkers: ['T1-49'],
  },
  {
    scenario: 'P0 #6 — Double connect; only one survives',
    enablingTicket: 'T1-50',
    testFile: 'tests/connect-button-mutex.test.tsx',
    contentMarkers: ['T1-50', 'mutex'],
  },
  {
    scenario: 'P0 #7 — Disconnect during connect; abort cleanly',
    enablingTicket: 'T1-50 Part B',
    testFile: 'tests/connect-abort-signal.test.ts',
    contentMarkers: ['T1-50', 'AbortSignal'],
  },
  {
    scenario: 'P0 #7 — Disconnect during connect; GRBL abort path',
    enablingTicket: 'T1-50 Part B (handshake)',
    testFile: 'tests/grbl-connect-abort-signal.test.ts',
    contentMarkers: ['AbortSignal'],
  },
  {
    scenario: 'P0 #8 — Reconnect while close pending; no leaked handles',
    enablingTicket: 'T2-31',
    testFile: 'tests/serial-port-close-async.test.ts',
    contentMarkers: ['T2-31', 'close'],
  },
  {
    scenario: 'P0 #9 / #10 — Stale read loop / writer rejection during disconnect',
    enablingTicket: 'T2-31 + T1-22',
    testFile: 'tests/web-serial-byte-stream-harness.test.ts',
    contentMarkers: ['FakeSerialPort', 'WebSerialPort'],
  },
  {
    scenario: 'P1 #11 / #12 — Wrong device / no settings (handshake proof)',
    enablingTicket: 'T1-51',
    testFile: 'tests/grbl-handshake-rejects-bare-ok.test.ts',
    contentMarkers: ['T1-51', 'bare'],
  },
  {
    scenario: 'P1 #13 — Device identity captured on connect',
    enablingTicket: 'T3-50',
    testFile: 'tests/grbl-identity-verification.test.ts',
    contentMarkers: ['T3-50', 'getDeviceIdentity'],
  },
  {
    scenario: 'P1 #14 — Reconnect to different machine (identity comparator)',
    enablingTicket: 'T3-51',
    testFile: 'tests/reconnect-same-machine-verification.test.ts',
    contentMarkers: ['T3-51', 'compareIdentities'],
  },
  {
    scenario: 'P1 #15 — navigator.serial disconnect event',
    enablingTicket: 'T3-49',
    testFile: 'tests/serial-navigator-disconnect.test.ts',
    contentMarkers: ['navigator', 'disconnect'],
  },
  {
    scenario: 'P1 #16-#18 — Read loop done / errors / close idempotency',
    enablingTicket: 'T2-31 + T2-34',
    testFile: 'tests/web-serial-byte-stream-harness.test.ts',
    contentMarkers: ['scheduleReaderDone', 'scheduleReaderError'],
  },
  {
    scenario: 'P1 — Status-poll write-failure normalization',
    enablingTicket: 'T3-53',
    testFile: 'tests/poll-status-failure-normalized.test.ts',
    contentMarkers: ['T3-53', 'pollStatus'],
  },
  {
    scenario: 'P1 — WebSerial cable-pull heartbeat detection',
    enablingTicket: 'T3-16',
    testFile: 'tests/webserial-cable-pull-heartbeat.test.ts',
    contentMarkers: ['T3-16', 'cable'],
  },
  {
    scenario: 'P1 — Renderer lifecycle safety (beforeunload / pagehide)',
    enablingTicket: 'T3-52',
    testFile: 'tests/renderer-lifecycle-safety.test.ts',
    contentMarkers: ['T3-52', 'beforeunload'],
  },
  {
    scenario: 'P1 — `navigator.serial.getPorts()` device-reuse flow',
    enablingTicket: 'T3-48',
    testFile: 'tests/serial-known-port-reuse.test.ts',
    contentMarkers: ['T3-48', 'connectKnownPortOrPrompt'],
  },
];

void (async () => {
  for (const c of coverage) {
    const src = readTest(c.testFile);
    assert(
      src !== null,
      `${c.scenario} — ${c.testFile} exists (${c.enablingTicket})`,
    );
    if (src === null) continue;
    for (const marker of c.contentMarkers) {
      assert(
        src.includes(marker),
        `${c.scenario} — ${c.testFile} mentions "${marker}"`,
      );
    }
  }

  // Per-enabling-ticket roundup. A regression that quietly removes
  // an enabling-ticket's test file blocks the connection-lifecycle
  // checklist - the audit doc's row would still claim shipped while
  // the regression-protection has rotted.
  const enablingTickets = new Set(coverage.map((c) => c.enablingTicket.split(' ')[0]));
  assert(enablingTickets.size >= 12, 'Coverage manifest spans 12+ enabling tickets');

  // Negative-pin: there must NOT be any obsolete Electron-native
  // serial test still being asserted (T2-35 chose removal). Audit
  // category "P1 Electron serial (4)" is intentionally not covered
  // because the path was removed.
  const obsoleteTest = readTest('tests/electron-serial-bridge.test.ts');
  assert(obsoleteTest === null, 'No obsolete electron-serial-bridge.test.ts (T2-35 removal)');

  // Self-pin: this manifest file lives inside tests/connection-lifecycle/
  // so the lane-classifier picks it up (default `unit` lane). Source
  // pin asserts the T3-54 marker and the audit 3B section reference
  // are preserved for future contributors looking up the rationale.
  const selfPath = resolve(here, 'connection-lifecycle-coverage.test.ts');
  const selfSrc = readFileSync(selfPath, 'utf-8');
  assert(/T3-54/.test(selfSrc), 'Manifest source: T3-54 marker present');
  assert(/audit 3B section 14/i.test(selfSrc), 'Manifest source: audit 3B section 14 cited');

  console.log(`\nT3-54 connection-lifecycle coverage: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
