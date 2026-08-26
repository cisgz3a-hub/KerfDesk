import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNativeSmokeConfig } from './native-smoke.js';

describe('packaged native smoke configuration', () => {
  it('leaves ordinary launches on the legacy profile contract', () => {
    expect(readNativeSmokeConfig(['KerfDesk.exe'])).toBeNull();
  });

  it('requires two absolute disposable paths', () => {
    const userData = resolve('tmp', 'native-smoke-user-data');
    const result = resolve('tmp', 'native-smoke-result.json');
    expect(
      readNativeSmokeConfig([
        `--kerfdesk-native-smoke-user-data=${userData}`,
        `--kerfdesk-native-smoke-result=${result}`,
      ]),
    ).toEqual({ userDataPath: userData, resultPath: result });
    expect(() =>
      readNativeSmokeConfig(['--kerfdesk-native-smoke-user-data=relative-path']),
    ).toThrow(/both user-data and result paths/);
  });
});
