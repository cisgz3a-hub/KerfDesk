import { describe, expect, it } from 'vitest';

import { defaultBarcodeSpec } from '../../core/barcode';
import {
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type ShapeObject,
} from '../../core/scene';
import {
  activeNumberFields,
  draftFromSpec,
  draftWithSymbology,
  previewBarcode,
  specFromDraft,
  type BarcodeDraft,
} from './barcode-form';

const NOW = new Date('2026-09-24T10:00:00.000Z');
const project: Project = {
  ...createProject(),
  variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 41 },
};
const subject: ShapeObject = {
  kind: 'shape',
  id: 'stand-in',
  spec: defaultBarcodeSpec('qr'),
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

function draft(overrides: Partial<BarcodeDraft> = {}): BarcodeDraft {
  return { ...draftFromSpec(defaultBarcodeSpec('qr')), ...overrides };
}

function preview(overrides: Partial<BarcodeDraft> = {}) {
  return previewBarcode(draft(overrides), { project, object: subject, now: NOW });
}

describe('barcode dialog form', () => {
  it('round-trips a spec through the draft', () => {
    const spec = { ...defaultBarcodeSpec('ean13'), invert: true, quietZoneModules: 12 };
    expect(specFromDraft(draftFromSpec(spec))).toEqual({ ok: true, spec });
  });

  it('follows untouched sample data and resets sizes across 2D and 1D types', () => {
    const toEan = draftWithSymbology(draft(), 'ean13');
    expect(toEan).toMatchObject({
      data: '5901234123457',
      quietZoneModules: '11',
      moduleMm: '0.33',
    });
    const typed = draftWithSymbology(draft({ data: 'ORDER 7', moduleMm: '0.8' }), 'data-matrix');
    expect(typed).toMatchObject({ data: 'ORDER 7', quietZoneModules: '2', moduleMm: '0.8' });
  });

  it('validates only the size fields the type and size mode use', () => {
    expect(activeNumberFields(draft())).toEqual(['moduleMm', 'quietZoneModules']);
    expect(activeNumberFields(draft({ symbology: 'code128', sizeMode: 'width' }))).toEqual([
      'widthMm',
      'barHeightMm',
      'quietZoneModules',
    ]);
    const hidden = specFromDraft(draft({ barHeightMm: 'abc', widthMm: '' }));
    expect(hidden).toMatchObject({ ok: true, spec: { barHeightMm: 15, widthMm: 25 } });
    expect(specFromDraft(draft({ moduleMm: '0' }))).toEqual({
      ok: false,
      message: 'Module size must be from 0.05 to 50 mm.',
    });
    expect(specFromDraft(draft({ quietZoneModules: '2.5' }))).toEqual({
      ok: false,
      message: 'Quiet zone must be a whole number from 0 to 40 modules.',
    });
  });

  it('previews literal data with its size summary inputs', () => {
    const ready = preview({ data: 'HELLO WORLD', moduleMm: '1' });
    expect(ready).toMatchObject({ kind: 'ready', value: 'HELLO WORLD' });
    if (ready.kind === 'ready') {
      expect(ready.layout.description).toBe(
        'QR Code version 1 (21 × 21 modules), error correction M',
      );
      expect(ready.layout.widthMm).toBe(29);
    }
  });

  it('refuses data the type cannot carry instead of drawing a code', () => {
    expect(preview({ symbology: 'ean13', data: '5901234123458' })).toEqual({
      kind: 'invalid',
      message: 'The EAN-13 check digit should be 7, not 8. Check the number.',
    });
    expect(preview({ data: '' })).toEqual({
      kind: 'invalid',
      message: 'Enter the data to encode.',
    });
  });

  it('previews variable data with the value the next output encodes', () => {
    const ready = preview({ data: 'SN-{{serial:6}}', variable: true });
    expect(ready).toMatchObject({ kind: 'ready', value: 'SN-000041' });
    const copy = preview({ data: 'SN-{{serial:6}}', variable: true, sequenceOffset: 2 });
    expect(copy).toMatchObject({
      kind: 'ready',
      value: 'SN-000043',
      spec: { variableTemplate: { sequenceOffset: 2 } },
    });
  });

  it('explains variable values the type cannot encode and malformed fields', () => {
    const tooShort = preview({ symbology: 'ean8', data: '{{serial:3}}', variable: true });
    expect(tooShort).toEqual({
      kind: 'invalid',
      message:
        'The current value "041" cannot be encoded. EAN-8 needs 7 digits, or 8 with the check digit.',
    });
    expect(preview({ data: 'SN-{{serial:99}}', variable: true })).toEqual({
      kind: 'invalid',
      message: 'Serial width must be an integer from 1 to 20.',
    });
  });

  it('previews sample data while a variable field cannot be evaluated yet', () => {
    const ready = preview({ data: '{{csv:Part}}', variable: true });
    expect(ready).toMatchObject({ kind: 'ready', value: 'https://example.com' });
    expect(ready.kind === 'ready' && ready.notes.join(' ')).toContain('preview shows sample data');
  });
});
