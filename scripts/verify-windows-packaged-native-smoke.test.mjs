import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { validResult } from './native-smoke-test-support.mjs';
import {
  nativeSmokeLaunchOptions,
  validateNativeSmokeResult,
} from './verify-windows-packaged-native-smoke.mjs';

test('launches the packaged app without a Windows hide override', () => {
  const executable = resolve('release', 'win-unpacked', 'KerfDesk.exe');
  assert.deepEqual(nativeSmokeLaunchOptions(executable), {
    cwd: resolve('release', 'win-unpacked'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
});

test('accepts only packaged, isolated, ready/imported/saved results', () => {
  const userData = resolve('tmp', 'native-smoke');
  const result = validResult(userData);
  assert.equal(validateNativeSmokeResult(result, userData), result);
});

test('rejects readiness evidence when the packaged window never became visible', () => {
  const userData = resolve('tmp', 'native-smoke');
  assert.throws(
    () => validateNativeSmokeResult(validResult(userData, { windowVisible: false }), userData),
    /window did not become visible/,
  );
});

test('rejects successful UI evidence when a runtime security setting is weakened or missing', () => {
  const userData = resolve('tmp', 'native-smoke');
  for (const [name, weakened] of Object.entries({
    available: false,
    sandbox: false,
    contextIsolation: false,
    nodeIntegration: true,
    webSecurity: false,
    preload: '/unexpected-preload.js',
  })) {
    for (const value of [weakened, undefined]) {
      const result = validResult(userData);
      result.webPreferences[name] = value;
      assert.throws(() => validateNativeSmokeResult(result, userData), /runtime/);
    }
  }
});

test('requires an actual DevTools open attempt to remain closed', () => {
  const userData = resolve('tmp', 'native-smoke');
  for (const probe of [undefined, { opened: false }, { method: 'openDevTools', opened: true }]) {
    assert.throws(
      () => validateNativeSmokeResult(validResult(userData, { devToolsProbe: probe }), userData),
      /runtime DevTools/,
    );
  }
});

test('rejects every leaked or uninspected renderer Node primitive', () => {
  const userData = resolve('tmp', 'native-smoke');
  for (const name of ['require', 'process', 'module', 'Buffer']) {
    for (const value of ['function', 'object', undefined]) {
      const result = validResult(userData);
      result.renderer.nodePrimitives[name] = value;
      assert.throws(() => validateNativeSmokeResult(result, userData), /renderer Node primitive/);
    }
  }
});

test('refuses to represent the smoke picker and memory-write stubs as native file I/O', () => {
  const userData = resolve('tmp', 'native-smoke');
  for (const name of ['openPicker', 'savePicker', 'writeTarget']) {
    const result = validResult(userData);
    result.renderer.fileAccess[name] = 'native';
    assert.throws(() => validateNativeSmokeResult(result, userData), /stubbed pickers/);
  }
});

test('rejects a legacy or mismatched profile before accepting UI evidence', () => {
  assert.throws(
    () =>
      validateNativeSmokeResult(
        {
          ok: true,
          isPackaged: true,
          isolated: false,
          userData: resolve('real-profile'),
          sessionData: resolve('real-profile'),
          failures: [],
          renderer: { readyToShow: true, imported: true, saved: true, savedBytes: 10 },
        },
        resolve('disposable-profile'),
      ),
    /profile was not isolated/,
  );
});
