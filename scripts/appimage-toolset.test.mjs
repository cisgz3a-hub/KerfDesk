// The AppImage is built from electron-builder's toolset without the libraries
// KerfDesk does not ship (ADR-017 Amendment 2). verify-linux-package.sh checks
// the built AppImage on Linux; these checks cover the hook and its wiring.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  APPIMAGE_TOOLSET,
  LEFT_OUT_LIBRARIES,
  copyToolsetWithoutLeftOutLibraries,
  isLeftOutLibrary,
  prepareAppImageToolset,
} from './appimage-toolset.mjs';
import { REPO_ROOT } from './third-party-closure.mjs';

const TOOLSET_LIBRARIES = [
  'libXss.so.1',
  'libXss.so.1.0.0',
  'libXtst.so.6',
  'libXtst.so.6.1.0',
  'libnotify.so.4',
  'libnotify.so.4.0.0',
  'libgconf-2.so.4',
  'libgconf-2.so.4.1.5',
  'libappindicator3.so.1',
  'libappindicator3.so.1.0.0',
  'libindicator3.so.7',
  'libindicator3.so.7.0.0',
];

// A folder shaped like the static-runtime toolset getAppImageTools returns.
function fakeToolset(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-toolset-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text = file) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write('appimage-tool', '#!/usr/bin/env bash\n');
  fs.chmodSync(path.join(root, 'appimage-tool'), 0o755);
  write('mksquashfs', 'stands in for the wrapper link');
  write('desktop-file-validate');
  write('runtimes/runtime-x64');
  write('linux/x64/lib/libgconf-2.so.4', 'a tool library, not an AppImage one');
  for (const arch of ['x64', 'ia32']) {
    for (const name of TOOLSET_LIBRARIES) write(`lib/${arch}/${name}`);
  }
  return root;
}

test('the hook leaves out exactly the GPL-3.0 libraries and GConf', () => {
  assert.deepEqual(LEFT_OUT_LIBRARIES, [
    'libappindicator3.so.1',
    'libindicator3.so.7',
    'libgconf-2.so.4',
  ]);
  assert.deepEqual(TOOLSET_LIBRARIES.filter(isLeftOutLibrary), [
    'libgconf-2.so.4',
    'libgconf-2.so.4.1.5',
    'libappindicator3.so.1',
    'libappindicator3.so.1.0.0',
    'libindicator3.so.7',
    'libindicator3.so.7.0.0',
  ]);
  assert.equal(isLeftOutLibrary('libindicator3.so.70'), false);
});

test('the copy drops left-out libraries from every lib/<arch> folder and nothing else', async (t) => {
  const source = fakeToolset(t);
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-copy-')), 'tools');
  t.after(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
  const leftOut = await copyToolsetWithoutLeftOutLibraries(source, target);
  assert.equal(leftOut.length, 12);
  for (const arch of ['x64', 'ia32']) {
    assert.deepEqual(fs.readdirSync(path.join(target, 'lib', arch)).sort(), [
      'libXss.so.1',
      'libXss.so.1.0.0',
      'libXtst.so.6',
      'libXtst.so.6.1.0',
      'libnotify.so.4',
      'libnotify.so.4.0.0',
    ]);
  }
  assert.ok(fs.existsSync(path.join(target, 'linux/x64/lib/libgconf-2.so.4')));
  assert.ok(fs.existsSync(path.join(target, 'runtimes/runtime-x64')));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(target, 'appimage-tool')).mode & 0o777, 0o755);
  }
});

test('symbolic links stay relative, so usr/lib does not point back into the toolset', async (t) => {
  if (process.platform === 'win32') return t.skip('symbolic links need Linux or macOS');
  const source = fakeToolset(t);
  fs.rmSync(path.join(source, 'mksquashfs'));
  fs.symlinkSync('appimage-tool', path.join(source, 'mksquashfs'));
  fs.rmSync(path.join(source, 'lib/x64/libXss.so.1'));
  fs.symlinkSync('libXss.so.1.0.0', path.join(source, 'lib/x64/libXss.so.1'));
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-copy-')), 'tools');
  t.after(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
  await copyToolsetWithoutLeftOutLibraries(source, target);
  assert.equal(fs.readlinkSync(path.join(target, 'mksquashfs')), 'appimage-tool');
  assert.equal(fs.readlinkSync(path.join(target, 'lib/x64/libXss.so.1')), 'libXss.so.1.0.0');
});

test('the hook points electron-builder at the copy, for the AppImage only', async (t) => {
  const source = fakeToolset(t);
  const previous = process.env.APPIMAGE_TOOLS_PATH;
  t.after(() => {
    if (previous === undefined) delete process.env.APPIMAGE_TOOLS_PATH;
    else process.env.APPIMAGE_TOOLS_PATH = previous;
  });
  delete process.env.APPIMAGE_TOOLS_PATH;
  const asked = [];
  const getAppImageTools = async (version, arch) => {
    asked.push([version, arch]);
    return {
      mksquashfs: path.join(source, 'mksquashfs'),
      desktopFileValidate: path.join(source, 'desktop-file-validate'),
      runtime: path.join(source, 'runtimes', 'runtime-x64'),
      runtimeLibraries: path.join(source, 'lib', 'x64'),
    };
  };
  assert.equal(
    await prepareAppImageToolset({ targetPresentableName: 'deb' }, getAppImageTools),
    null,
  );
  assert.equal(process.env.APPIMAGE_TOOLS_PATH, undefined);
  const prepared = await prepareAppImageToolset(
    { targetPresentableName: 'AppImage', arch: 1 },
    getAppImageTools,
  );
  t.after(() => fs.rmSync(prepared.target, { recursive: true, force: true }));
  assert.deepEqual(asked, [[APPIMAGE_TOOLSET, 1]]);
  assert.equal(process.env.APPIMAGE_TOOLS_PATH, prepared.target);
  assert.ok(path.isAbsolute(prepared.target));
  assert.deepEqual(prepared.shipped, [
    'libXss.so.1',
    'libXss.so.1.0.0',
    'libXtst.so.6',
    'libXtst.so.6.1.0',
    'libnotify.so.4',
    'libnotify.so.4.0.0',
  ]);
  assert.ok(fs.existsSync(path.join(prepared.target, 'mksquashfs')));
});

test('both Linux configs run the hook on the toolset it copies', () => {
  for (const config of ['electron-builder.yml', 'electron-builder.preview.yml']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, config), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, /^artifactBuildStarted: scripts\/appimage-toolset\.mjs$/m, config);
    assert.match(text, new RegExp(`^toolsets:\\n  appimage: ${APPIMAGE_TOOLSET}$`, 'm'), config);
  }
});
