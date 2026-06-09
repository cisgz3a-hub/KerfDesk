import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_PRESETS_KEY,
  readUserImagePresets,
  saveUserImagePreset,
  type ImagePresetSettings,
  writeUserImagePresets,
} from './AdjustImageDialog.user-presets';

const settings: ImagePresetSettings = {
  brightness: 20,
  contrast: -5,
  gamma: 1.4,
  ditherAlgorithm: 'jarvis',
  minPower: 4,
  linesPerMm: 12,
  dotWidthCorrectionMm: 0.01,
  negativeImage: true,
  passThrough: false,
  invertDisplay: true,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Adjust Image user presets storage', () => {
  it('normalizes, writes, and reads settings-only user presets', () => {
    const result = saveUserImagePreset([], '  Wood   logo  ', settings, 123);
    if (result.kind !== 'ok') throw new Error(`unexpected result ${result.kind}`);

    expect(writeUserImagePresets(result.presets)).toEqual({ kind: 'ok' });
    expect(readUserImagePresets()).toEqual([{ name: 'Wood logo', settings, updatedAt: 123 }]);
  });

  it('rejects empty names and built-in preset names', () => {
    expect(saveUserImagePreset([], '  ', settings)).toEqual({ kind: 'invalid-name' });
    expect(saveUserImagePreset([], 'Basic', settings)).toEqual({ kind: 'reserved-name' });
    expect(saveUserImagePreset([], 'Black Paint on White', settings)).toEqual({
      kind: 'reserved-name',
    });
  });

  it('ignores corrupt storage records instead of throwing', () => {
    localStorage.setItem(IMAGE_PRESETS_KEY, '{ not json');

    expect(readUserImagePresets()).toEqual([]);
  });

  it('reports storage failures without claiming the preset was written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });

    expect(writeUserImagePresets([{ name: 'Wood logo', settings, updatedAt: 123 }])).toEqual(
      expect.objectContaining({ kind: 'failed' }),
    );
  });
});
