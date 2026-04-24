/**
 * Static audit: no `localStorage` in src/core/ or src/entitlements/ except
 * one-shot migration helpers (localStorage → getStorage()).
 *
 * Run: npx tsx tests/no-localstorage-in-core.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const PATTERN = /\blocalStorage\b/;
const MIGRATION_FN = /migrate\w*FromLocalStorage/i;

/** Paths under project root using forward slashes. */
const LOCALSTORAGE_MIGRATION_ALLOWLIST: readonly string[] = [
  'src/entitlements/EntitlementService.ts',
  'src/core/devices/DeviceProfile.ts',
  'src/core/job/JobLog.ts',
  'src/core/replay/JobReplay.ts',
  'src/core/materials/MaterialLibrary.ts',
  'src/core/materials/MaterialPresets.ts',
  'src/core/materials/MaterialFeedback.ts',
];

const ROOTS = ['src/core', 'src/entitlements'] as const;

function walkTs(dir: string, out: string[] = []): string[] {
  const abs = path.join(projectRoot, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      walkTs(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Per physical line: strip // suffix and /* *\/ blocks, tracking block state
 * across lines. Output length matches `lines.length` so indices align with the
 * source file (unlike deleting block comments globally, which merges lines).
 */
function codeOnlyPerLine(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    let seg = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = line.length;
          break;
        }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const blockStart = line.indexOf('/*', i);
      const lineComment = line.indexOf('//', i);
      const nextBlock = blockStart === -1 ? Number.POSITIVE_INFINITY : blockStart;
      const nextLine = lineComment === -1 ? Number.POSITIVE_INFINITY : lineComment;
      if (nextBlock === Number.POSITIVE_INFINITY && nextLine === Number.POSITIVE_INFINITY) {
        seg += line.slice(i);
        break;
      }
      if (nextLine < nextBlock) {
        seg += line.slice(i, nextLine);
        break;
      }
      seg += line.slice(i, nextBlock);
      inBlock = true;
      i = nextBlock + 2;
    }
    out.push(seg);
  }
  return out;
}

function findEnclosingFunctionName(lines: readonly string[], atLine: number): string | null {
  const patterns: RegExp[] = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    /^\s*async\s+function\s+(\w+)\s*\(/,
    /^\s*(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    /^\s*(?:private|public|protected)\s+(?:async\s+)?(\w+)\s*\(/,
  ];
  for (let i = atLine - 1; i >= Math.max(0, atLine - 120); i--) {
    const line = lines[i];
    for (const pat of patterns) {
      const m = pat.exec(line);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

const scanned = ROOTS.flatMap(r => walkTs(r));
const allowSet = new Set(LOCALSTORAGE_MIGRATION_ALLOWLIST);

// ─── 1) No unauthorized localStorage (in code, not comments) ──────
const violations: { file: string; line: number; text: string }[] = [];
for (const rel of scanned) {
  const full = path.join(projectRoot, ...rel.split('/'));
  const raw = fs.readFileSync(full, 'utf8');
  const rawLines = raw.split('\n');
  const codeLines = codeOnlyPerLine(rawLines);
  if (!codeLines.some(l => PATTERN.test(l))) continue;

  if (allowSet.has(rel)) continue;

  for (let i = 0; i < codeLines.length; i++) {
    if (PATTERN.test(codeLines[i])) {
      violations.push({
        file: rel,
        line: i + 1,
        text: (rawLines[i] ?? '').trim(),
      });
    }
  }
}

if (violations.length > 0) {
  const msg = violations.map(v => `  ${v.file}:${v.line}: ${v.text}`).join('\n');
  throw new Error(
    'Unauthorized localStorage usage in core/entitlements (use getStorage() / Storage adapter):\n'
    + `${msg}\n\n`
    + 'If this is a one-shot migration helper, add the file to LOCALSTORAGE_MIGRATION_ALLOWLIST '
    + 'and name the helper migrate*FromLocalStorage.',
  );
}

// ─── 2) Allowlist: localStorage only inside migrate*FromLocalStorage ─
const allowViolations: { file: string; line: number; text: string; reason: string }[] = [];
for (const relPath of LOCALSTORAGE_MIGRATION_ALLOWLIST) {
  const full = path.join(projectRoot, ...relPath.split('/'));
  if (!fs.existsSync(full)) {
    allowViolations.push({
      file: relPath,
      line: 0,
      text: '',
      reason: 'allowlisted file missing — remove from LOCALSTORAGE_MIGRATION_ALLOWLIST',
    });
    continue;
  }
  const raw = fs.readFileSync(full, 'utf8');
  const rawLines = raw.split('\n');
  const codeLines = codeOnlyPerLine(rawLines);
  if (!codeLines.some(l => PATTERN.test(l))) {
    allowViolations.push({
      file: relPath,
      line: 0,
      text: '',
      reason: 'allowlisted file has no localStorage in code — remove from allowlist',
    });
    continue;
  }

  for (let i = 0; i < codeLines.length; i++) {
    if (!PATTERN.test(codeLines[i])) continue;
    const enclosing = findEnclosingFunctionName(rawLines, i);
    const ok = enclosing != null && MIGRATION_FN.test(enclosing);
    if (!ok) {
      allowViolations.push({
        file: relPath,
        line: i + 1,
        text: (rawLines[i] ?? '').trim(),
        reason: enclosing
          ? `localStorage outside migration helper (inside '${enclosing}')`
          : 'localStorage not inside a named migrate*FromLocalStorage function',
      });
    }
  }
}

if (allowViolations.length > 0) {
  const msg = allowViolations
    .map(v => `  ${v.file}:${v.line}: ${v.text}\n    → ${v.reason}`)
    .join('\n');
  throw new Error(`Allowlist / migration-helper violations:\n${msg}`);
}

console.log('\n=== no localStorage in core/ (audit) ===');
console.log(`  ✓ ${scanned.length} files under src/core + src/entitlements scanned`);
console.log(`  ✓ ${LOCALSTORAGE_MIGRATION_ALLOWLIST.length} migration allowlist entries validated`);
process.stdout.write('\nno-localstorage-in-core: OK\n');
