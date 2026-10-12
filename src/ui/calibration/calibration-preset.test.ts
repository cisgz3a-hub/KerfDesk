import { describe, expect, it } from 'vitest';
import { parseCalibrationPreset, serializeCalibrationPreset } from './calibration-draft-storage';
import {
  DEFAULT_MATERIAL_TEST_DRAFT,
  MATERIAL_TEST_DRAFT_FIELDS,
  type MaterialTestDraft,
} from './material-test-draft';

describe('calibration preset files', () => {
  it('round-trips a Material Test draft and keeps defaults for missing fields', () => {
    const draft: MaterialTestDraft = { ...DEFAULT_MATERIAL_TEST_DRAFT, rows: '4', powerMax: '80' };
    const text = serializeCalibrationPreset('kerfdesk-material-test', draft);
    expect(
      parseCalibrationPreset(
        'kerfdesk-material-test',
        text,
        DEFAULT_MATERIAL_TEST_DRAFT,
        MATERIAL_TEST_DRAFT_FIELDS,
      ),
    ).toEqual(draft);
    const partial = JSON.stringify({
      kind: 'kerfdesk-material-test',
      schemaVersion: 1,
      draft: { rows: '3', bogus: 'x' },
    });
    expect(
      parseCalibrationPreset(
        'kerfdesk-material-test',
        partial,
        DEFAULT_MATERIAL_TEST_DRAFT,
        MATERIAL_TEST_DRAFT_FIELDS,
      ),
    ).toEqual({ ...DEFAULT_MATERIAL_TEST_DRAFT, rows: '3' });
  });

  it('refuses another test kind and non-preset files', () => {
    const interval = serializeCalibrationPreset('kerfdesk-interval-test', { steps: '5' });
    expect(() =>
      parseCalibrationPreset(
        'kerfdesk-material-test',
        interval,
        DEFAULT_MATERIAL_TEST_DRAFT,
        MATERIAL_TEST_DRAFT_FIELDS,
      ),
    ).toThrow('different test');
    expect(() =>
      parseCalibrationPreset(
        'kerfdesk-material-test',
        'nope',
        DEFAULT_MATERIAL_TEST_DRAFT,
        MATERIAL_TEST_DRAFT_FIELDS,
      ),
    ).toThrow('not a KerfDesk test preset');
  });
});
