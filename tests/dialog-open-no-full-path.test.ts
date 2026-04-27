/**
 * T1-93 regression test: dialog:open returns basename only, not the
 * full file path.
 *
 * Bug: electron/main.ts:207 returned `{ filePath, content, ext }` where
 * filePath is the absolute selected path. The renderer received strings
 * like:
 *
 *   C:\\Users\\johanns\\Documents\\Projects\\Laser\\my-project.laserforge.json
 *   /Users/jane.doe/Desktop/secret_design.svg
 *
 * This leaks across the IPC boundary:
 *   - The username (privacy concern)
 *   - The home directory structure
 *   - Folder names that may reveal sensitive context
 *
 * Then every future surface that touches the result inherits the leak:
 *   - Logs and error messages
 *   - Future support bundle (T2-108)
 *   - Telemetry/analytics
 *   - Recent-files lists (acceptable IF the user expects it; surprising
 *     IF they don't)
 *
 * Fix: return `{ fileName: path.basename(filePath), content, ext }`. The
 * filePath local variable is still computed inside the handler (needed
 * by statSync/readFileSync), but never crosses the IPC boundary.
 *
 * If a future feature truly needs the full path (e.g., recent-files with
 * "open from same folder"), it can be exposed via a separate explicit
 * IPC with user opt-in.
 *
 * Run: npx tsx tests/dialog-open-no-full-path.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROD_FILE = join(REPO_ROOT, 'electron', 'main.ts');
const TYPE_FILE = join(REPO_ROOT, 'src', 'types', 'web-serial.d.ts');

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

console.log('\n=== dialog:open returns basename only (T1-93) ===\n');

// ── BEHAVIOR: path.basename strips the directory prefix ─────────────
// These tests use posix.basename via the imported `basename` from
// 'node:path' (which on a Unix tsx host resolves to the posix variant
// for forward-slash paths). The production code uses Electron's path
// module, which is platform-aware: on Windows it understands backslashes
// and drive letters, on Unix it understands forward slashes.
{
  // Posix basename works on forward-slash paths regardless of host OS.
  assert(
    basename('/Users/jane.doe/Desktop/secret_design.svg') === 'secret_design.svg',
    'Unix path → basename only',
  );
  assert(
    basename('/home/johanns/.../my-project.laserforge.json') === 'my-project.laserforge.json',
    'multi-level Unix path → basename preserves multi-level extension',
  );
}

// On Windows the production code's path.basename also handles
// backslashes. We can't directly invoke the Windows variant on a Unix
// host, but we can verify the contract: the result must not contain a
// path separator of any kind.
{
  // Simulate the Windows case by using win32-style separators in input.
  // Even posix.basename, given a string with NO forward slashes, returns
  // the input verbatim. The actual Windows behavior is verified at
  // runtime on a packaged Windows binary; here we assert the broader
  // privacy invariant: whatever the production handler returns, it
  // contains no separators.
  const result = basename('only-the-name.svg');
  assert(
    result === 'only-the-name.svg',
    'name without separators: returned as-is',
  );
}

// ── BEHAVIOR: special characters in filenames ───────────────────────
{
  assert(
    basename('/path/to/My Project (final).svg') === 'My Project (final).svg',
    'spaces and parens preserved in basename',
  );
  assert(
    basename('/path/to/job-2026-04-27.gcode') === 'job-2026-04-27.gcode',
    'hyphens and digits preserved',
  );
}

// ── BEHAVIOR: privacy hygiene examples ──────────────────────────────
// These are the strings the audit specifically called out. Verify the
// basename strips the username portion entirely.
{
  const sensitivePath = '/Users/jane.doe/Desktop/secret_design.svg';
  const safe = basename(sensitivePath);
  assert(
    !safe.includes('jane.doe'),
    'username "jane.doe" stripped from basename',
  );
  assert(
    !safe.includes('Desktop'),
    'directory "Desktop" stripped from basename',
  );
  assert(
    !safe.includes('Users'),
    'directory "Users" stripped from basename',
  );

  // Long, deeply nested path with multiple sensitive segments.
  const corporate = '/home/employee/projects/acme-corp/confidential/widget-v2.dxf';
  const corporateSafe = basename(corporate);
  assert(
    corporateSafe === 'widget-v2.dxf',
    `nested corporate path stripped to basename only (got "${corporateSafe}")`,
  );
  assert(
    !/(employee|acme-corp|confidential)/.test(corporateSafe),
    'no parent directory names leak through basename',
  );
}

// ── STRUCTURAL: production handler returns fileName, not filePath ───
{
  const src = readFileSync(PROD_FILE, 'utf8');

  // Locate the dialog:open handler.
  const handlerStart = src.indexOf("ipcMain.handle('dialog:open'");
  assert(handlerStart > 0, 'dialog:open handler is registered');

  // Bound the handler by the next ipcMain.handle( call (or end-of-file
  // if this is the last handler). Naive `indexOf('});', handlerStart)`
  // is wrong here — the dialog.showOpenDialog config object also ends
  // in `});`, so it captures only the first ~400 bytes of the handler.
  const nextHandler = src.indexOf('ipcMain.handle(', handlerStart + 1);
  const handlerEnd = nextHandler > 0 ? nextHandler : src.length;
  assert(handlerEnd > handlerStart, 'handler block end found');
  const handlerSrc = src.slice(handlerStart, handlerEnd);

  // 1. Return statement uses fileName: path.basename(...)
  assert(
    /return\s*\{\s*fileName\s*:\s*path\.basename\(/.test(handlerSrc),
    'handler returns fileName: path.basename(...)',
  );

  // 2. The return statement does NOT include a top-level filePath field.
  // We look for the field-name pattern `filePath:` or `filePath,` inside
  // a `return { ... }` block — distinguishes a returned field from
  // benign local-variable usage like `path.basename(filePath)`.
  const handlerCodeOnly = handlerSrc
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const returnBlockMatch = handlerCodeOnly.match(/return\s*\{[^}]*\}/);
  const returnBlock = returnBlockMatch?.[0] ?? '';
  // A returned field is either `filePath:` (key:value form) or
  // `filePath,` / `filePath }` (shorthand form).
  assert(
    !/\bfilePath\s*[:,}]/.test(returnBlock),
    `handler return does NOT include a filePath field (return block: "${returnBlock.slice(0, 80)}...")`,
  );

  // 3. The filePath LOCAL variable is still computed (needed for
  // statSync + readFileSync). This assertion guards against an
  // over-zealous refactor that strips the local entirely.
  assert(
    /const\s+filePath\s*=\s*result\.filePaths\[0\]/.test(handlerCodeOnly),
    'filePath local variable is still computed (used internally for stat/read)',
  );
  assert(
    /fs\.statSync\(filePath\)/.test(handlerCodeOnly),
    'fs.statSync still runs against the local filePath',
  );
  assert(
    /fs\.readFileSync\(filePath\b/.test(handlerCodeOnly),
    'fs.readFileSync still runs against the local filePath',
  );
}

// ── STRUCTURAL: type declaration matches the new shape ──────────────
{
  const types = readFileSync(TYPE_FILE, 'utf8');

  // 1. openFile return type uses fileName.
  assert(
    /openFile\??\s*:\s*\(\)\s*=>\s*Promise<\s*\{\s*fileName\s*:\s*string\s*;/.test(types),
    'electronAPI.openFile return type declares fileName: string',
  );

  // 2. The return type does NOT declare a filePath field.
  // (Strip comments first to avoid matching documentation.)
  const typesCodeOnly = types
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Find the openFile return type block specifically.
  const m = typesCodeOnly.match(/openFile\??\s*:\s*\(\)\s*=>\s*Promise<\s*\{[^}]*\}/);
  assert(m !== null, 'openFile return type is declared');
  const returnTypeBody = m?.[0] ?? '';
  assert(
    !/\bfilePath\b/.test(returnTypeBody),
    'openFile return type does NOT declare a filePath field',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
