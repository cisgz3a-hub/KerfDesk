/**
 * T3-10: input import limits for DXF bombs and oversized file reads.
 *
 * Run: npx tsx tests/import-limits.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DXF_IMPORT_LIMITS,
  DxfImportLimitError,
  assertDxfFileSize,
  parseDxf,
} from '../src/import/dxf/DxfParser';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

console.log('\n=== T3-10 import limits ===\n');

const MB = 1024 * 1024;

assert(DXF_IMPORT_LIMITS.MAX_FILE_BYTES === 50 * MB, 'DXF file cap is 50 MB');
assert(DXF_IMPORT_LIMITS.MAX_ENTITY_COUNT === 500_000, 'DXF entity cap is 500K');
assert(DXF_IMPORT_LIMITS.MAX_GROUPS_PER_ENTITY === 10_000, 'DXF per-entity group cap is 10K');

{
  assertDxfFileSize(50 * MB);
  const err = catchError(() => assertDxfFileSize(100 * MB));
  assert(err instanceof DxfImportLimitError, '100 MB DXF stub is rejected before read');
  if (err instanceof DxfImportLimitError) {
    assert(err.limit === 'MAX_FILE_BYTES', 'oversized DXF reports MAX_FILE_BYTES');
  }
}

{
  const dxf = [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    '8', 'Layer 1',
    '10', '0',
    '20', '0',
    '11', '10',
    '21', '10',
    '0', 'ENDSEC',
  ].join('\n');
  const parsed = parseDxf(dxf);
  assert(parsed.entities.length === 1, 'small DXF still parses');
}

{
  const dxf = [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    '8', 'Layer 1',
    '0', 'CIRCLE',
    '8', 'Layer 2',
    '0', 'ARC',
    '8', 'Layer 3',
    '0', 'ENDSEC',
  ].join('\n');
  const err = catchError(() => parseDxf(dxf, { maxEntities: 2 }));
  assert(err instanceof DxfImportLimitError, 'entity count limit rejects parser bomb');
  if (err instanceof DxfImportLimitError) {
    assert(err.limit === 'MAX_ENTITY_COUNT', 'entity bomb reports MAX_ENTITY_COUNT');
  }
}

{
  const groups: string[] = [];
  for (let i = 0; i < 4; i++) {
    groups.push('999', `comment ${i}`);
  }
  const dxf = [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    ...groups,
    '0', 'ENDSEC',
  ].join('\n');
  const err = catchError(() => parseDxf(dxf, { maxGroupsPerEntity: 3 }));
  assert(err instanceof DxfImportLimitError, 'per-entity group limit rejects dense entity');
  if (err instanceof DxfImportLimitError) {
    assert(err.limit === 'MAX_GROUPS_PER_ENTITY', 'dense entity reports MAX_GROUPS_PER_ENTITY');
  }
}

{
  const src = readFileSync(resolve(process.cwd(), 'src/import/dxf/DxfParser.ts'), 'utf-8');
  assert(src.includes('DXF_IMPORT_LIMITS'), 'DxfParser declares DXF_IMPORT_LIMITS');
  assert(src.includes('assertDxfFileSize'), 'DxfParser exports read-boundary size check');
  assert(src.includes('MAX_ENTITY_COUNT'), 'DxfParser enforces entity cap');
  assert(src.includes('MAX_GROUPS_PER_ENTITY'), 'DxfParser enforces group cap');
}

{
  const toolbar = readFileSync(resolve(process.cwd(), 'src/ui/components/FileToolbar.tsx'), 'utf-8');
  const dropHook = readFileSync(resolve(process.cwd(), 'src/ui/hooks/useImport.ts'), 'utf-8');

  const toolbarCheck = toolbar.indexOf('assertDxfFileSize(file.size)');
  const toolbarRead = toolbar.indexOf('file.text()', toolbar.indexOf('handleDxfSelected'));
  assert(toolbarCheck > 0 && toolbarRead > toolbarCheck, 'DXF file input checks size before file.text()');

  const dropCheck = dropHook.indexOf('assertDxfFileSize(file.size)');
  const dropRead = dropHook.indexOf('file.text()', dropCheck);
  assert(dropCheck > 0 && dropRead > dropCheck, 'DXF drag/drop checks size before file.text()');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
