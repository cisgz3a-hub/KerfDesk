// The Linux AppImage's runtime and usr/lib libraries are pinned by hand in
// docs/licensing/appimage-runtime-notices.txt (ADR-017 Amendment 1), because
// they come from electron-builder's toolset rather than node_modules. These
// checks keep that notice, the shipped notices file and the package check's
// list of allowed libraries saying the same thing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { appImageRuntimeSections } from './generate-third-party-notices.mjs';
import { REPO_ROOT } from './third-party-closure.mjs';

const section = appImageRuntimeSections()
  .join('\n\n')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+$/gm, '');

test('the shipped notices carry the AppImage section before the standard texts', () => {
  const notice = fs.readFileSync(path.join(REPO_ROOT, 'public/third-party-notices.txt'), 'utf8');
  assert.ok(notice.includes(`${section}\n\n=== Apache-2.0 full license text ===\n`));
});

test('the package check allows exactly the libraries the notice names', () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts/verify-linux-package.sh'), 'utf8');
  const allowed = [...script.matchAll(/\b(lib[\w-]+\.so\.\d+)\*/g)].map((match) => match[1]);
  const named = [...section.matchAll(/^--- AppImage component: (lib[\w-]+\.so\.\d+),/gm)].map(
    (match) => match[1],
  );
  assert.equal(allowed.length, 6);
  assert.deepEqual([...allowed].sort(), [...named].sort());
});

test('the runtime names its pinned source and ships the copyleft texts it needs', () => {
  assert.match(section, /type2-runtime\/tree\/dd6cebedcbddde9c82f89b011e8e1d40b6e43868/);
  assert.match(section, /84021a78ee214ae6fd33a2d62a92ba25542dd10bc86bf117a9b2d0bba44e7665/);
  assert.match(section, /fuse-3\.15\.0\.tar\.xz/);
  assert.match(section, /GNU LESSER GENERAL PUBLIC LICENSE\n\s+Version 2\.1, February 1999/);
  assert.match(section, /GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/);
  for (const component of ['musl libc', 'squashfuse', 'Zstandard', 'zlib', 'mimalloc'])
    assert.match(section, new RegExp(`--- AppImage component: ${component} `));
});
