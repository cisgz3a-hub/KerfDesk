import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { validResult } from './native-smoke-test-support.mjs';
import { DESKTOP_LICENCE_WINDOW } from '../public/desktop-licence-window.mjs';
import {
  nativeSmokeLaunchOptions,
  parseNativeSmokeArgs,
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

test('requires local licensing evidence without imposing sandbox policy on Preview', () => {
  const userData = resolve('tmp', 'native-smoke');
  for (const licensing of [undefined, { kind: 'not-app-runtime' }, { kind: 'observed' }]) {
    const result = validResult(userData);
    result.renderer.licensing = licensing;
    assert.throws(() => validateNativeSmokeResult(result, userData), /local licensing status/);
  }
});

test('accepts an observed available manual update without treating it as downloaded or armed', () => {
  const userData = resolve('tmp', 'native-smoke');
  const result = validResult(userData);
  result.renderer.licensing.updateState = 'available';
  assert.equal(validateNativeSmokeResult(result, userData), result);
  result.renderer.licensing.updateState = 'installing';
  assert.throws(() => validateNativeSmokeResult(result, userData), /local licensing status/);
});

/** A fresh commercial build settles behind its licence window, with no workspace (ADR-623). */
function licenceWindowResult(userData) {
  const result = validResult(userData);
  const renderer = { ...result.renderer, licenceWindow: true, imported: false, saved: false };
  delete renderer.fileAccess;
  delete renderer.savedBytes;
  renderer.licensing = {
    kind: 'observed',
    channel: 'commercial',
    state: 'activation-required',
    edition: 'free',
    proEnabled: false,
    updateState: 'up-to-date',
  };
  result.renderer = renderer;
  return result;
}

test('fresh-sandbox expectation requires the commercial Free state and unavailable updates', () => {
  const userData = resolve('tmp', 'native-smoke');
  const result = licenceWindowResult(userData);
  const expected = {
    kind: 'observed',
    channel: 'commercial',
    state: 'activation-required',
    edition: 'free',
    proEnabled: false,
    updateState: 'unavailable',
  };
  result.renderer.licensing = expected;
  const options = { expectFreshSandbox: true, licenceWindow: true };
  assert.equal(validateNativeSmokeResult(result, userData, options), result);
  for (const patch of [
    { channel: 'free' },
    { state: 'ready' },
    { state: 'unavailable' },
    { edition: 'pro', proEnabled: true },
    { updateState: 'idle' },
  ]) {
    result.renderer.licensing = { ...expected, ...patch };
    assert.throws(() => validateNativeSmokeResult(result, userData, options), /fresh sandbox/);
  }
});

test('fresh-sandbox and default workspace smoke retain their distinct expectations', () => {
  const userData = resolve('tmp', 'native-smoke');
  const sandboxLicensing = {
    kind: 'observed',
    channel: 'commercial',
    state: 'activation-required',
    edition: 'free',
    proEnabled: false,
    updateState: 'unavailable',
  };
  const workspace = validResult(userData);
  workspace.renderer.licensing = sandboxLicensing;
  assert.throws(
    () =>
      validateNativeSmokeResult(workspace, userData, {
        expectFreshSandbox: true,
        licenceWindow: true,
      }),
    /behind the licence window/,
  );
  // Ordinary workspace smoke still requires import and save.
  const gated = licenceWindowResult(userData);
  assert.throws(() => validateNativeSmokeResult(gated, userData), /SVG import was not observed/);
});

test('every licence-window expectation rejects workspace I/O reported behind the window', () => {
  const userData = resolve('tmp', 'native-smoke');
  const sandboxLicensing = {
    kind: 'observed',
    channel: 'commercial',
    state: 'activation-required',
    edition: 'free',
    proEnabled: false,
    updateState: 'unavailable',
  };
  for (const options of [
    { expectFreshSandbox: true, licenceWindow: true },
    { expectLicenceWindow: true, licenceWindow: true },
    { acceptLicenceWindow: true },
  ]) {
    const clean = licenceWindowResult(userData);
    clean.renderer.licensing = sandboxLicensing;
    assert.equal(validateNativeSmokeResult(clean, userData, options), clean);
    for (const patch of [
      { imported: true },
      { saved: true },
      { savedBytes: 10 },
      { fileAccess: { openPicker: 'stubbed', savePicker: 'stubbed', writeTarget: 'memory' } },
    ]) {
      const leaked = licenceWindowResult(userData);
      leaked.renderer = { ...leaked.renderer, licensing: sandboxLicensing, ...patch };
      assert.throws(
        () => validateNativeSmokeResult(leaked, userData, options),
        /licence window reported workspace|no workspace I\/O/,
      );
    }
  }
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

test('commercial licence-window expectation accepts a settled unlicensed gate without workspace I/O', () => {
  const userData = resolve('tmp', 'native-smoke');
  const result = licenceWindowResult(userData);
  const options = { expectLicenceWindow: true, licenceWindow: true };
  assert.equal(validateNativeSmokeResult(result, userData, options), result);
  assert.throws(() => validateNativeSmokeResult(result, userData), /SVG import was not observed/);
  assert.throws(
    () =>
      validateNativeSmokeResult(result, userData, {
        expectFreshSandbox: true,
        licenceWindow: true,
      }),
    /fresh sandbox/,
  );
});

test('a commercial package must be one a trial or key can open', () => {
  const userData = resolve('tmp', 'native-smoke');
  const options = { expectLicenceWindow: true, licenceWindow: true };
  const fresh = licenceWindowResult(userData);
  assert.equal(validateNativeSmokeResult(fresh, userData, options), fresh);
  // Unavailable: an unusable release identity, keychain or Linux keyring could never
  // admit anyone. The Linux rehearsal runs with an unlocked GNOME Keyring, so it too
  // must reach activation-required.
  for (const state of ['unavailable', 'trial-expired']) {
    const result = licenceWindowResult(userData);
    result.renderer.licensing.state = state;
    assert.throws(
      () => validateNativeSmokeResult(result, userData, options),
      /commercial licence window/,
    );
  }
});

test('commercial licence-window expectation rejects wrong licensing and workspace evidence', () => {
  const userData = resolve('tmp', 'native-smoke');
  const options = { expectLicenceWindow: true, licenceWindow: true };
  for (const patch of [
    { channel: 'free' },
    { edition: 'pro', proEnabled: true },
    { state: 'ready' },
  ]) {
    const result = licenceWindowResult(userData);
    Object.assign(result.renderer.licensing, patch);
    assert.throws(
      () => validateNativeSmokeResult(result, userData, options),
      /commercial licence window/,
    );
  }
  for (const patch of [
    { licenceWindow: false },
    { licenceWindow: undefined },
    { imported: true },
    { imported: undefined },
    { saved: true },
    { saved: undefined },
    { savedBytes: 100 },
    { fileAccess: { openPicker: 'stubbed', savePicker: 'stubbed', writeTarget: 'memory' } },
  ]) {
    const result = licenceWindowResult(userData);
    Object.assign(result.renderer, patch);
    assert.throws(
      () => validateNativeSmokeResult(result, userData, options),
      /commercial licence window/,
    );
  }
  assert.throws(
    () => validateNativeSmokeResult(validResult(userData), userData, options),
    /commercial licence window/,
  );
});

test('CLI parsing selects an explicit licence-window expectation without weakening defaults', () => {
  const executable = resolve('release', 'linux-unpacked', 'kerfdesk');
  const args = parseNativeSmokeArgs([executable, '--expect-licence-window']);
  assert.equal(args.executable, executable);
  assert.equal(args.expectLicenceWindow, true);
  assert.equal(args.expectFreshSandbox, false);
  assert.equal(parseNativeSmokeArgs([executable]).expectLicenceWindow, false);
  const sandbox = parseNativeSmokeArgs([executable, '--expect-fresh-sandbox']);
  assert.equal(sandbox.expectFreshSandbox, true);
  assert.equal(sandbox.expectLicenceWindow, false);
  assert.throws(
    () => parseNativeSmokeArgs([executable, '--expect-fresh-sandbox', '--expect-licence-window']),
    /choose one licensing expectation/,
  );
});

/** An unlicensed commercial package opened in KerfDesk Free (ADR-623 Amendment 3). */
function unlicensedFreeResult(userData, updateState = 'up-to-date') {
  const result = validResult(userData);
  result.renderer.licensing = {
    kind: 'observed',
    channel: 'commercial',
    state: 'activation-required',
    edition: 'free',
    proEnabled: false,
    updateState,
  };
  return result;
}

test('while the licence window is held off, an unlicensed package must open its Free workspace', () => {
  const userData = resolve('tmp', 'native-smoke');
  const options = { expectLicenceWindow: true, licenceWindow: false };
  const free = unlicensedFreeResult(userData);
  assert.equal(validateNativeSmokeResult(free, userData, options), free);
  // A package still behind a licence window, or without import and save, fails.
  assert.throws(
    () => validateNativeSmokeResult(licenceWindowResult(userData), userData, options),
    /Free workspace/,
  );
  for (const patch of [{ imported: false }, { saved: false }]) {
    const result = unlicensedFreeResult(userData);
    Object.assign(result.renderer, patch);
    assert.throws(() => validateNativeSmokeResult(result, userData, options));
  }
  for (const patch of [
    { channel: 'free' },
    { edition: 'pro', proEnabled: true },
    { state: 'unavailable' },
    { state: 'ready' },
  ]) {
    const result = unlicensedFreeResult(userData);
    Object.assign(result.renderer.licensing, patch);
    assert.throws(() => validateNativeSmokeResult(result, userData, options), /Free workspace/);
  }
});

test('while the licence window is held off, a fresh sandbox opens its Free workspace', () => {
  const userData = resolve('tmp', 'native-smoke');
  const options = { expectFreshSandbox: true, licenceWindow: false };
  const free = unlicensedFreeResult(userData, 'unavailable');
  assert.equal(validateNativeSmokeResult(free, userData, options), free);
  const gated = licenceWindowResult(userData);
  gated.renderer.licensing.updateState = 'unavailable';
  assert.throws(
    () => validateNativeSmokeResult(gated, userData, options),
    /SVG import was not observed/,
  );
});

test('the CLI and default validation follow the shared licence window setting', () => {
  const executable = resolve('release', 'win-unpacked', 'KerfDesk.exe');
  const args = parseNativeSmokeArgs([executable, '--expect-licence-window']);
  assert.equal(args.licenceWindow, DESKTOP_LICENCE_WINDOW);
  const userData = resolve('tmp', 'native-smoke');
  const expected = DESKTOP_LICENCE_WINDOW
    ? licenceWindowResult(userData)
    : unlicensedFreeResult(userData);
  assert.equal(
    validateNativeSmokeResult(expected, userData, { expectLicenceWindow: true }),
    expected,
  );
});
