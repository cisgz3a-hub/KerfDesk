import assert from 'node:assert/strict';
import test from 'node:test';

import { installersNeeded, packagingScope } from './desktop-packaging-scope.mjs';

// ADR-647: a pull request skips the Linux installer and commercial rehearsal
// jobs only when every file it changes is renderer, test or documentation
// source; everything else, and every run that is not a pull request, builds them.

test('renderer, test and documentation changes skip the installer jobs', () => {
  assert.equal(
    installersNeeded([
      'src/ui/canvas/Workspace.tsx',
      'src/core/cam/toolpath.ts',
      'e2e/workbench.e2e.ts',
      'docs/decisions/ADR-647-lighter-pull-request-ci.md',
      'DECISIONS.md',
      'website/index.html',
      'electron/licensing.test.ts',
      'playwright.config.ts',
      '.github/workflows/e2e.yml',
    ]),
    false,
  );
});

test('packaging, desktop and unknown changes build the installers', () => {
  for (const path of [
    'electron/main.ts',
    'scripts/build-commercial-platform.sh',
    'services/desktop-licensing/worker.mjs',
    'public/desktop-release-keys.json',
    'patches/some-package.patch',
    'electron-builder.preview.yml',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'vite.config.ts',
    'tsconfig.json',
    'index.html',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    '.github/workflows/desktop-package-check.yml',
    '.github/actions/setup-remote-control/action.yml',
    // The renderer areas the packaged and commercial launches reach.
    'src/platform/electron/licensing.ts',
    'src/ui/app/main.tsx',
    'src/ui/licensing/LicencePanel.tsx',
    'a-new-top-level-file.json',
  ]) {
    assert.equal(installersNeeded(['src/ui/canvas/Workspace.tsx', path]), true, path);
  }
});

test('an empty or missing change list builds the installers', () => {
  assert.equal(installersNeeded([]), true);
  assert.throws(() => installersNeeded(undefined), /required/);
});

test('only a pull request reads its changes; every other run builds the installers', () => {
  for (const event of ['push', 'merge_group', 'workflow_dispatch', 'schedule']) {
    const scope = packagingScope(event, () => {
      throw new Error('must not read the diff');
    });
    assert.equal(scope.installers, true, event);
  }
  assert.equal(
    packagingScope('pull_request', () => ['src/ui/canvas/Workspace.tsx']).installers,
    false,
  );
  assert.equal(packagingScope('pull_request', () => ['electron/main.ts']).installers, true);
  assert.throws(() =>
    packagingScope('pull_request', () => {
      throw new Error('git failed');
    }),
  );
});
