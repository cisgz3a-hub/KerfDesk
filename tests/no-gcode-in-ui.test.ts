/**
 * Static audit: no machine-level GRBL gcode substrings in `src/ui/` (code, not
 * JSDoc/block comments) — gcode is owned by app services / ExecutionCoordinator.
 * Comment-aware line stripping matches `no-localstorage-in-core.test.ts`.
 *
 * Run: npx tsx tests/no-gcode-in-ui.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const ROOT = 'src/ui' as const;

const GCODE_CODE_PATTERNS: readonly RegExp[] = [
  /\bM3\s*S/i,
  /\bM4\s*S/i,
  /\bM5\s*S/i,
  /\bG10\s*L20\b/i,
  /(?<![A-Za-z0-9_])\$X(?![A-Za-z0-9_])/,
  /(?<![A-Za-z0-9_])\$H(?![A-Za-z0-9_])/,
];

const FILE_ALLOWLIST: readonly string[] = [
  // Empty by default. Add a path (forward slashes) only for exceptional UI
  // strings that are not gcode and cannot be rephrased (avoid if possible).
];

/**
 * Per physical line: strip end-of-line // comments and block comments so only
 * code tokens remain (aligns with no-localstorage-in-core).
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

function walkTs(dir: string, out: string[] = []): string[] {
  const abs = path.join(projectRoot, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel.split(path.sep).join('/'));
    }
  }
  return out;
}

const relPaths = walkTs(ROOT);
const allowSet = new Set(FILE_ALLOWLIST);
const violations: { file: string; line: number; text: string; pattern: string }[] = [];

for (const rel of relPaths) {
  if (allowSet.has(rel)) continue;
  const full = path.join(projectRoot, ...rel.split('/'));
  const raw = fs.readFileSync(full, 'utf8');
  const rawLines = raw.split('\n');
  const codeLines = codeOnlyPerLine(rawLines);

  for (let i = 0; i < codeLines.length; i++) {
    const c = codeLines[i];
    if (c == null) continue;
    for (const pat of GCODE_CODE_PATTERNS) {
      if (pat.test(c)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: (rawLines[i] ?? '').trim(),
          pattern: pat.toString(),
        });
        break;
      }
    }
  }
}

if (violations.length > 0) {
  const msg = violations
    .map(v => `  ${v.file}:${v.line} [${v.pattern}]: ${v.text}`)
    .join('\n');
  throw new Error(
    'Gcode substrings in src/ui/ (move literals to core/app, or add allowlist with justification):\n'
    + msg,
  );
}

console.log('\n=== no gcode literals in src/ui/ (audit) ===');
console.log(`  ✓ ${relPaths.length} files under ${ROOT} scanned`);
process.stdout.write('\nno-gcode-in-ui: OK\n');
