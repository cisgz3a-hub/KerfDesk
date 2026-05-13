/**
 * T1-238: F-016 follow-up for the audit prompt's no-skip Phase 4 rule.
 *
 * The generated inventory is intentionally honest: it does not claim every
 * export received a full manual deep review, but it does guarantee every live
 * exported symbol has a row and cannot drift silently after future edits.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface ExportRecord {
  file: string;
  line: number;
  kind: string;
  name: string;
}

const inventoryDoc = readFileSync('docs/AUDIT-EXPORTED-SYMBOL-INVENTORY.md', 'utf8');

function collectExports(): ExportRecord[] {
  const stdout = execFileSync(process.execPath, ['scripts/exported-symbol-inventory.mjs', '--json'], {
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as ExportRecord[];
}

test('exported symbol inventory is generated from the live tree', () => {
  const output = execFileSync(process.execPath, ['scripts/exported-symbol-inventory.mjs', '--check'], {
    encoding: 'utf8',
  });

  assert.match(output, /AUDIT-EXPORTED-SYMBOL-INVENTORY\.md is current with \d+ export rows/);
});

test('inventory covers the audit scope at current scale', () => {
  const exports = collectExports();
  const files = new Set(exports.map(record => record.file));

  assert(exports.length >= 2600, `expected at least 2600 export rows, saw ${exports.length}`);
  assert(files.size >= 480, `expected at least 480 files with exports, saw ${files.size}`);
  assert(exports.every(record => record.file.startsWith('src/') || record.file.startsWith('electron/')));
});

test('inventory contains representative safety and boundary exports', () => {
  const keys = new Set(collectExports().map(record => `${record.file}#${record.name}`));

  assert(keys.has('src/app/MachineService.ts#MachineService'));
  assert(keys.has('src/app/PipelineService.ts#compileGcode'));
  assert(keys.has('src/security/TrustedSender.ts#assertTrustedSenderFrame'));
  assert(keys.has('src/controllers/grbl/GrblController.ts#GrblController'));
  assert(keys.has('src/communication/WebSerialPort.ts#WebSerialPort'));
  assert(keys.has('electron/cspPolicy.ts#buildCspPolicy'));
});

test('inventory document is tied to F-016 and does not overclaim manual review', () => {
  assert.match(inventoryDoc, /\*\*Ticket:\*\* T1-238/);
  assert.match(inventoryDoc, /F-016/);
  assert.match(inventoryDoc, /every exported symbol discovered in `src\/` and `electron\/`/);
  assert.match(inventoryDoc, /intentionally avoids claiming that every symbol has had a full manual/);
});
