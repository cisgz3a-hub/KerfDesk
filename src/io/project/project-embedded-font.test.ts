import { describe, expect, it } from 'vitest';
import { createProject, type EmbeddedFont } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const FONT: EmbeddedFont = {
  key: 'embedded:studio',
  fileName: 'Studio.otf',
  dataBase64: btoa('OTTO\0\x01\x02\x03'),
};

describe('project embedded fonts', () => {
  it('round-trips font bytes with the project', () => {
    const project = { ...createProject(), embeddedFonts: [FONT] };
    const result = deserializeProject(serializeProject(project));
    expect(result).toMatchObject({ kind: 'ok', project: { embeddedFonts: [FONT] } });
  });

  it.each([
    [{ ...FONT, dataBase64: '' }, 'dataBase64'],
    [{ ...FONT, dataBase64: '%%%%' }, 'dataBase64'],
  ])('rejects malformed font data %#', (font, reason) => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['embeddedFonts'] = [font];
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining(reason),
    });
  });

  it('rejects duplicate embedded font keys', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['embeddedFonts'] = [FONT, { ...FONT, fileName: 'Duplicate.otf' }];
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('.key'),
    });
  });
});
