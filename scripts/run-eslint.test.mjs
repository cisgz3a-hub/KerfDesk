import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lintPartitions, runEslint } from './run-eslint.mjs';

const eslint = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));

test('lint and lint:fix use sequential fresh heaps and forward arguments without a shell', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.lint, 'node scripts/run-eslint.mjs');
  assert.equal(pkg.scripts['lint:fix'], 'pnpm lint --fix');
  const calls = [];
  assert.equal(
    runEslint(['--fix'], {
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    }),
    0,
  );
  assert.equal(calls.length, 4);
  for (const [index, [executable, args, options]] of calls.entries()) {
    assert.equal(executable, process.execPath);
    assert.deepEqual(args, [
      '--max-old-space-size=5120',
      eslint,
      ...lintPartitions[index],
      '--fix',
    ]);
    assert.equal(options.shell, undefined);
    assert.equal(options.stdio, 'inherit');
  }
});

for (const failure of [
  { status: 2 },
  { status: null, signal: 'SIGTERM' },
  { status: null, error: new Error('launch failed') },
]) {
  test(`stops and fails when a child returns ${JSON.stringify(failure)}`, () => {
    let calls = 0;
    const code = runEslint([], { spawn: () => (++calls === 2 ? failure : { status: 0 }) });
    assert.equal(code, failure.status ?? 1);
    assert.equal(calls, 2);
  });
}

test('ordinary lint errors retain failure while allowing later diagnostics and fixes', () => {
  let calls = 0;
  assert.equal(runEslint(['--fix'], { spawn: () => ({ status: ++calls === 1 ? 1 : 0 }) }), 1);
  assert.equal(calls, 4);
});

test('global options and explicit paths retain the original single ESLint invocation', () => {
  for (const args of [
    ['--max-warnings', '2'],
    ['--output-file', 'result.json'],
    ['src/core'],
    ['--fix', '--quiet'],
  ]) {
    const calls = [];
    assert.equal(
      runEslint(args, {
        spawn: (...call) => {
          calls.push(call);
          return { status: 1 };
        },
      }),
      1,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ['--max-old-space-size=5120', eslint, '.', ...args]);
  }
});

test('real ESLint preserves scope, cross-partition cycles, type-aware rules and fixes', async () => {
  const fixture = await realpath(await mkdtemp(path.join(tmpdir(), 'kerfdesk-eslint-partitions-')));
  const put = async (name, contents) => {
    await mkdir(path.dirname(path.join(fixture, name)), { recursive: true });
    await writeFile(path.join(fixture, name), contents);
  };
  try {
    await symlink(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      path.join(fixture, 'node_modules'),
      'junction',
    );
    // Import the actual repository rules; only the fixture's project location
    // differs. No rule or import graph is disabled for partitioned invocations.
    await put(
      'eslint.config.mjs',
      `import config from ${JSON.stringify(new URL('../eslint.config.mjs', import.meta.url).href)};
export default [...config, { files: ['src/**/*.ts'], languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } }, settings: { 'import/resolver': { typescript: { project: './tsconfig.json' }, node: { extensions: ['.ts', '.js'] } } } }];\n`,
    );
    await put(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
        },
        include: ['src/**/*.ts'],
      }),
    );
    await put(
      'src/core/clean.ts',
      'export const clean = 1;\nexport type Item = { value: number };\n',
    );
    await put(
      'src/ui/state/cycle.ts',
      "import { laser } from '../laser/cycle';\nexport function state() { return laser(); }\nPromise.resolve();\n",
    );
    await put(
      'src/ui/laser/cycle.ts',
      "import { state } from '../state/cycle';\nexport function laser() { return state(); }\n",
    );
    await put('src/future/added.ts', 'export const future = 1;\n');
    await put('future-directory/added.js', 'const future = 1;\n');
    await put(
      'src/future/fixable.ts',
      "import { Item } from '../core/clean';\nexport const item: Item = { value: 1 };\n",
    );
    await put('dist/ignored.js', 'not valid JavaScript !\n');
    const lint = (args) => {
      const result = spawnSync(process.execPath, [eslint, ...args, '--format', 'json'], {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
      });
      assert.ok(result.status === 0 || result.status === 1, result.stderr || result.error?.message);
      return JSON.parse(result.stdout).map((file) => ({
        file: path.relative(fixture, file.filePath).replaceAll('\\', '/'),
        messages: file.messages.map(({ ruleId, line, message }) => ({ ruleId, line, message })),
      }));
    };
    const whole = lint(['.']);
    const parts = lintPartitions.flatMap((partition) => lint(partition));
    const byFile = (a, b) => a.file.localeCompare(b.file);
    assert.deepEqual(parts.sort(byFile), whole.sort(byFile));
    assert.equal(new Set(parts.map((f) => f.file)).size, parts.length, 'no duplicated inputs');
    assert.ok(parts.some((f) => f.file === 'future-directory/added.js'));
    assert.ok(parts.some((f) => f.file === 'src/future/added.ts'));
    assert.ok(!parts.some((f) => f.file.startsWith('dist/')));
    assert.ok(
      parts
        .find((f) => f.file === 'src/ui/state/cycle.ts')
        .messages.some((m) => m.ruleId === '@typescript-eslint/no-floating-promises'),
    );
    // The installed import plugin's default extension set omits TypeScript.
    // Supplement the exact-config comparison above with an explicit extension
    // map to exercise graph traversal across inputs excluded from this process.
    await put(
      'dist/cycle.config.mjs',
      `import config from '../eslint.config.mjs';
export default [...config, { files: ['src/**/*.ts'], settings: { 'import/extensions': ['.ts', '.tsx', '.js'] } }];\n`,
    );
    const cycleArgs = ['--config', 'dist/cycle.config.mjs'];
    const cycleWhole = lint(['.', ...cycleArgs]);
    const cycleParts = lintPartitions.flatMap((partition) => lint([...partition, ...cycleArgs]));
    assert.deepEqual(cycleParts.sort(byFile), cycleWhole.sort(byFile));
    for (const file of ['src/ui/state/cycle.ts', 'src/ui/laser/cycle.ts']) {
      assert.ok(
        cycleParts
          .find((f) => f.file === file)
          .messages.some((m) => m.ruleId === 'import/no-cycle'),
        `${file}: ${JSON.stringify(cycleParts.find((f) => f.file === file))}`,
      );
    }
    lint([...lintPartitions.at(-1), '--fix']);
    assert.match(
      await readFile(path.join(fixture, 'src/future/fixable.ts'), 'utf8'),
      /^import \{ type Item \}/u,
    );
  } finally {
    // mkdtemp produced this exact owned directory; never clean the checkout.
    assert.equal(path.dirname(fixture), await realpath(tmpdir()));
    await rm(fixture, { recursive: true, force: true });
  }
});
