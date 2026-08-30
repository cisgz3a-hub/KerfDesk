import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { validateNativeSmokeResult } from './verify-windows-packaged-native-smoke.mjs';

test('accepts only packaged, isolated, ready/imported/saved results', () => {
  const userData = resolve('tmp', 'native-smoke');
  const result = {
    ok: true,
    isPackaged: true,
    isolated: true,
    userData,
    sessionData: userData,
    windowVisible: true,
    failures: [],
    renderer: {
      readyToShow: true,
      imported: true,
      saved: true,
      savedBytes: 2048,
      url: 'app://app/index.html',
    },
  };
  assert.equal(validateNativeSmokeResult(result, userData), result);
});

test('rejects readiness evidence when the packaged window never became visible', () => {
  const userData = resolve('tmp', 'native-smoke');
  assert.throws(
    () =>
      validateNativeSmokeResult(
        {
          ok: true,
          isPackaged: true,
          isolated: true,
          userData,
          sessionData: userData,
          windowVisible: false,
          failures: [],
          renderer: {
            readyToShow: true,
            imported: true,
            saved: true,
            savedBytes: 2048,
            url: 'app://app/index.html',
          },
        },
        userData,
      ),
    /window did not become visible/,
  );
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
