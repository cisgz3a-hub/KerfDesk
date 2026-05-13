/**
 * T1-232: production diagnostics should use a structured log sink, not
 * direct console.log calls that support bundles cannot capture.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  appendStructuredDiagnosticLogEvent,
  clearStructuredDiagnosticLogForTests,
  serializeStructuredDiagnosticLogForSupport,
  tailStructuredDiagnosticLogEvents,
} from '../src/core/logging/StructuredDiagnosticLog';

const productionFiles = [
  'src/controllers/grbl/GrblController.ts',
  'src/core/job/OperationOrderer.ts',
  'src/io/ImageStore.ts',
  'src/core/materials/MaterialLibrary.ts',
];

test('production diagnostic callsites do not use console.log directly', () => {
  for (const file of productionFiles) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /console\.log\(/, file);
    assert.match(src, /appendStructuredDiagnosticLogEvent/, `${file} uses structured sink`);
  }
});

test('structured diagnostic log is a bounded support-bundle-ready sink', () => {
  assert.equal(existsSync('src/core/logging/StructuredDiagnosticLog.ts'), true);

  clearStructuredDiagnosticLogForTests();
  const event = appendStructuredDiagnosticLogEvent(
    {
      domain: 'controller',
      event: 'grbl-consent-resolved',
      message: 'Machine baseline resolved.',
      details: { bedWidth: 400, bedHeight: 400, homingDir: 1, laserMode: true },
    },
    1234,
  );

  assert.equal(event.id, 'diag_1234_000001');
  assert.equal(event.domain, 'controller');
  assert.equal(event.event, 'grbl-consent-resolved');
  assert.deepEqual(tailStructuredDiagnosticLogEvents(1), [event]);

  const support = serializeStructuredDiagnosticLogForSupport(1235);
  assert.equal(support.schemaVersion, 1);
  assert.equal(support.capturedAt, 1235);
  assert.deepEqual(support.entries, [event]);
});
