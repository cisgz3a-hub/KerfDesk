import { describe, expect, it } from 'vitest';
import { importLightBurnClb, importLightBurnProject } from '../../io/lightburn';
import { parseDocumentImportText } from './document-import-parse';

const blob = new Blob();

describe('parseDocumentImportText', () => {
  it('matches the LightBurn project importer on worker-safe XML DOM', () => {
    const text = `<LightBurnProject AppVersion="1.7">
      <Shape Type="Rect" CutIndex="2" W="10" H="6">
        <XForm>1 0 0 1 5 5</XForm>
      </Shape>
    </LightBurnProject>`;
    const response = parseDocumentImportText(
      { id: 1, kind: 'lightburn-project', blob, source: 'sample.lbrn2' },
      text,
    );

    expect(response.kind).toBe('lightburn-project');
    if (response.kind === 'lightburn-project') {
      expect(response.result).toEqual(importLightBurnProject(text, 'sample.lbrn2'));
    }
  });

  it('matches CLB material conversion on worker-safe XML DOM', () => {
    const text = `<Library><Material Name="Birch"><Entry Thickness="3" Desc="Cut">
      <CutSetting Type="Cut" Speed="8" MaxPower="75"/>
    </Entry></Material></Library>`;
    const response = parseDocumentImportText(
      { id: 2, kind: 'lightburn-clb', blob, source: 'sample.clb' },
      text,
    );

    expect(response.kind).toBe('lightburn-clb');
    if (response.kind === 'lightburn-clb') {
      expect(response.result).toEqual(importLightBurnClb(text, 'sample.clb'));
    }
  });

  it('rejects malformed XML instead of accepting the worker DOM repair', () => {
    const response = parseDocumentImportText(
      { id: 3, kind: 'lightburn-clb', blob, source: 'broken.clb' },
      '<Library><Entry></Library>',
    );

    expect(response).toMatchObject({
      kind: 'lightburn-clb',
      result: { ok: false, reason: 'CLB file is not valid XML.' },
    });
  });
});
