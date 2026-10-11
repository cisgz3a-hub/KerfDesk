import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const eslint = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const subtrees = ['src/core', 'src/ui/state', 'src/ui/laser'];

// Only split the input files. Each fresh process keeps the same config,
// TypeScript project and import resolver, including imports outside its input.
// The final catch-all also covers new directories without updating this list.
export const lintPartitions = [
  ...subtrees.map((subtree) => [subtree]),
  ['.', ...subtrees.flatMap((subtree) => ['--ignore-pattern', `${subtree}/**`])],
];

export function runEslint(args = [], { spawn = spawnSync, cwd = process.cwd() } = {}) {
  // Global CLI semantics (warning budgets, output files, explicit patterns,
  // etc.) belong to ESLint itself. Preserve its original single invocation
  // for custom arguments; the ordinary CI command and --fix use fresh heaps.
  const partitions = args.every((arg) => arg === '--fix') ? lintPartitions : [['.']];
  let exitCode = 0;
  for (const partition of partitions) {
    const result = spawn(
      process.execPath,
      ['--max-old-space-size=5120', eslint, ...partition, ...args],
      {
        cwd,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    if (result.error || result.signal || result.status === null) {
      console.error('[lint] ESLint did not complete:', result.error?.message ?? result.signal);
      return 1;
    }
    if (result.status !== 0 && result.status !== 1) return result.status;
    // An ordinary lint error must not prevent later diagnostics or fixes.
    exitCode = Math.max(exitCode, result.status);
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runEslint(process.argv.slice(2));
}
