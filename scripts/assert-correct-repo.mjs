import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const expectedRepoName = 'LaserForge-2.0';
const expectedRemote = 'https://github.com/cisgz3a-hub/LaserForge-2.0.git';

function fail(message) {
  console.error(`Repository guard failed: ${message}`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    fail(`unable to run git ${args.join(' ')}: ${error.message}`);
  }
}

const repoRoot = resolve(git(['rev-parse', '--show-toplevel']));
const repoName = basename(repoRoot);
if (repoName !== expectedRepoName) {
  fail(`expected checkout folder "${expectedRepoName}", got "${repoRoot}"`);
}

const origin = git(['remote', 'get-url', 'origin']);
if (origin !== expectedRemote) {
  fail(`expected origin ${expectedRemote}, got ${origin}`);
}

const indexHtml = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');
if (!indexHtml.includes('<title>LaserForge 2.0</title>') || !indexHtml.includes('id="app-root"')) {
  fail('index.html does not look like the LaserForge 2.0 app shell');
}

console.log(`Repository guard passed: ${repoRoot}`);
