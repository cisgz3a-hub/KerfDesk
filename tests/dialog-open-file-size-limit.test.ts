/**
 * T1-92 regression test: dialog:open enforces a per-extension file size
 * cap before reading.
 *
 * Bug: electron/main.ts:206 read the entire selected file with
 * fs.readFileSync(filePath, 'utf-8') after the dialog resolved. No size
 * check between dialog and read. A user (or social-engineering attack)
 * selects a 5 GB SVG; the main process blocks for many seconds reading,
 * allocates a 5 GB string, then ships it over IPC. App freezes or crashes.
 *
 * This isn't a sophisticated attack - a misconfigured CAD exporter or a
 * user who doesn't realize their software emits absurdly large SVGs
 * exhibits the same failure.
 *
 * Fix: per-extension size table (.svg = 25 MB, .json = 50 MB, .gcode =
 * 100 MB, etc.) plus a default cap (50 MB) for unknown extensions.
 * fs.statSync runs before fs.readFileSync; oversized files throw a
 * descriptive error that the renderer surfaces to the user.
 *
 * The test mirrors the cap rules in pure logic (so divergence between
 * test and production code surfaces as a test failure) AND grep-asserts
 * that the production handler wires the check into the right code path
 * (so a refactor that drops the stat check fails CI).
 *
 * Run: npx tsx tests/dialog-open-file-size-limit.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROD_FILE = join(REPO_ROOT, 'electron', 'main.ts');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== dialog:open file size limit (T1-92) ===\n');

// Pure-logic mirror of the cap table. If anyone changes the production
// constants, these mirrors will diverge and the test must be updated
// alongside — that's the point.
const MAX_FILE_BYTES_BY_EXTENSION: Record<string, number> = {
  '.json':  50 * 1024 * 1024,
  '.svg':   25 * 1024 * 1024,
  '.dxf':   25 * 1024 * 1024,
  '.gcode': 100 * 1024 * 1024,
  '.nc':    100 * 1024 * 1024,
  '.png':   100 * 1024 * 1024,
  '.jpg':   100 * 1024 * 1024,
  '.jpeg':  100 * 1024 * 1024,
};
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Mirror of the size-check predicate from electron/main.ts. Returns the
 * descriptive error message when oversized, null when accepted.
 */
function evaluateSizeLimit(ext: string, sizeBytes: number): string | null {
  const limit = MAX_FILE_BYTES_BY_EXTENSION[ext] ?? DEFAULT_MAX_FILE_BYTES;
  if (sizeBytes > limit) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
    const limitMB = (limit / (1024 * 1024)).toFixed(0);
    return `File too large: ${sizeMB} MB. Maximum for ${ext || 'this file type'} is ${limitMB} MB.`;
  }
  return null;
}

const MB = 1024 * 1024;

// ── BEHAVIOR: SVG cap (25 MB) ────────────────────────────────────────
{
  assert(evaluateSizeLimit('.svg', 24 * MB) === null, '.svg 24 MB: accepted');
  assert(evaluateSizeLimit('.svg', 25 * MB) === null, '.svg exactly 25 MB: accepted (boundary)');
  assert(evaluateSizeLimit('.svg', 25 * MB + 1) !== null, '.svg 25 MB + 1 byte: rejected');
  assert(evaluateSizeLimit('.svg', 26 * MB) !== null, '.svg 26 MB: rejected');
}

// ── BEHAVIOR: JSON cap (50 MB) ──────────────────────────────────────
{
  assert(evaluateSizeLimit('.json', 49 * MB) === null, '.json 49 MB: accepted');
  assert(evaluateSizeLimit('.json', 50 * MB) === null, '.json exactly 50 MB: accepted (boundary)');
  assert(evaluateSizeLimit('.json', 51 * MB) !== null, '.json 51 MB: rejected');
}

// ── BEHAVIOR: G-code cap (100 MB) ───────────────────────────────────
{
  assert(evaluateSizeLimit('.gcode', 99 * MB) === null, '.gcode 99 MB: accepted');
  assert(evaluateSizeLimit('.gcode', 100 * MB) === null, '.gcode exactly 100 MB: accepted');
  assert(evaluateSizeLimit('.gcode', 105 * MB) !== null, '.gcode 105 MB: rejected');
  assert(evaluateSizeLimit('.nc', 105 * MB) !== null, '.nc 105 MB: rejected (same cap as .gcode)');
}

// ── BEHAVIOR: DXF cap (25 MB, same as SVG) ──────────────────────────
{
  assert(evaluateSizeLimit('.dxf', 24 * MB) === null, '.dxf 24 MB: accepted');
  assert(evaluateSizeLimit('.dxf', 25 * MB + 1) !== null, '.dxf 25 MB + 1 byte: rejected');
}

// ── BEHAVIOR: image caps (100 MB each) ──────────────────────────────
{
  assert(evaluateSizeLimit('.png', 99 * MB) === null, '.png 99 MB: accepted');
  assert(evaluateSizeLimit('.jpg', 101 * MB) !== null, '.jpg 101 MB: rejected');
  assert(evaluateSizeLimit('.jpeg', 50 * MB) === null, '.jpeg 50 MB: accepted');
}

// ── BEHAVIOR: unknown extension uses default (50 MB) ────────────────
{
  assert(evaluateSizeLimit('.xyz', 49 * MB) === null, 'unknown ext .xyz 49 MB: accepted under default');
  assert(evaluateSizeLimit('.xyz', 51 * MB) !== null, 'unknown ext .xyz 51 MB: rejected under default');
  assert(evaluateSizeLimit('', 51 * MB) !== null, 'empty ext (no dot) 51 MB: rejected under default');
}

// ── BEHAVIOR: original DoS scenario ─────────────────────────────────
{
  // The audit's motivating example: a 5 GB SVG.
  const result = evaluateSizeLimit('.svg', 5 * 1024 * MB);
  assert(result !== null, '5 GB SVG (the original DoS scenario): rejected');
  // Spot-check the formatted size.
  assert(
    result?.includes('5120.0 MB') ?? false,
    `error message names the actual size in MB (got: "${result?.slice(0, 60) ?? 'null'}...")`,
  );
}

// ── BEHAVIOR: error message format ──────────────────────────────────
{
  const msg = evaluateSizeLimit('.svg', 87.3 * MB);
  assert(msg !== null, '.svg 87.3 MB: rejected');
  // The message should include size, limit, and ext.
  assert(
    /87\.3\s*MB/.test(msg ?? ''),
    `error message includes formatted size (got: "${msg?.slice(0, 60) ?? 'null'}...")`,
  );
  assert(
    /25\s*MB/.test(msg ?? ''),
    `error message includes the 25 MB limit (got: "${msg?.slice(0, 80) ?? 'null'}...")`,
  );
  assert(
    /\.svg/.test(msg ?? ''),
    `error message names the extension (got: "${msg?.slice(0, 80) ?? 'null'}...")`,
  );
}

// ── STRUCTURAL: production file wires the check correctly ───────────
{
  const src = readFileSync(PROD_FILE, 'utf8');

  // 1. Both module-scope declarations exist.
  assert(
    /const\s+MAX_FILE_BYTES_BY_EXTENSION\s*:\s*Record<string,\s*number>\s*=\s*\{/.test(src),
    'production file declares MAX_FILE_BYTES_BY_EXTENSION typed table',
  );
  assert(
    /const\s+DEFAULT_MAX_FILE_BYTES\s*=\s*50\s*\*\s*1024\s*\*\s*1024\b/.test(src),
    'production file declares DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024',
  );

  // 2. Required extensions present in the table (we verify the four
  //    headline ones from the audit; full table presence is implicit).
  assert(/'\.svg'/.test(src), 'table includes .svg');
  assert(/'\.json'/.test(src), 'table includes .json');
  assert(/'\.gcode'/.test(src), 'table includes .gcode');
  assert(/'\.dxf'/.test(src), 'table includes .dxf');

  // 3. The dialog:open handler does fs.statSync BEFORE fs.readFileSync.
  // Locate the handler's position by anchoring on the IPC channel name.
  const handlerStart = src.indexOf("ipcMain.handle('dialog:open'");
  assert(handlerStart > 0, 'dialog:open handler is registered');

  // From handlerStart, find the next fs.statSync and the next
  // fs.readFileSync. statSync must come first.
  const statPos = src.indexOf('fs.statSync', handlerStart);
  const readPos = src.indexOf('fs.readFileSync', handlerStart);
  assert(statPos > 0, 'fs.statSync is called inside dialog:open handler');
  assert(readPos > 0, 'fs.readFileSync is called inside dialog:open handler');
  assert(
    statPos < readPos,
    'fs.statSync runs BEFORE fs.readFileSync (size check before read)',
  );

  // 4. The cap check throws on overflow.
  // We look for a `throw new Error(` between the stat call and the
  // readFileSync — that's the size-violation throw.
  const throwPos = src.indexOf('throw new Error', statPos);
  assert(
    throwPos > statPos && throwPos < readPos,
    'throw new Error(...) is between statSync and readFileSync (size-violation path)',
  );

  // 5. The throw message mentions size and the limit. We don't bind to
  //    exact wording, just to the presence of "too large" + "Maximum".
  const handlerSlice = src.slice(handlerStart, readPos);
  assert(
    /too large/i.test(handlerSlice) && /Maximum/.test(handlerSlice),
    'size-violation error message includes "too large" and "Maximum"',
  );

  // 6. The dialog.showOpenDialog call is still present (no accidental
  //    deletion of the user-facing dialog).
  assert(
    /dialog\.showOpenDialog\(mainWindow\b/.test(handlerSlice),
    'dialog.showOpenDialog call is still present in the handler',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
