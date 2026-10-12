import { describe, expect, it } from 'vitest';
import { importLightBurnProject } from './lbrn-import';

// The import report names every shape a project opened without, and how many
// of them (ADR-388).

const RECT = '<Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape>';

function report(shapes: string) {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${RECT}${shapes}</LightBurnProject>`,
    'sign.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result.report;
}

describe('LightBurn shapes named in the import report', () => {
  it('names each kind of shape left out, and how many', () => {
    const bitmap = '<Shape Type="Bitmap" CutIndex="3" W="20" H="20" Data="iVBORw0KGgo="/>';
    const text = '<Shape Type="Text" CutIndex="0" Font="Arial" Str="Hi" H="5"/>';
    const group = `<Shape Type="Group"><Children>${bitmap}</Children></Shape>`;
    const { warnings, unsupportedShapeTypes } = report(bitmap + bitmap + text + group);
    expect(unsupportedShapeTypes).toEqual(['Bitmap', 'Text without BackupPath']);
    expect(warnings).toEqual([
      '3 Bitmap shapes were not imported: KerfDesk opens only the Rect, Ellipse, Path, Text and Group shapes of a LightBurn project.',
      '1 Text shape was not imported: the file holds no outline (BackupPath) for it, and KerfDesk does not lay out LightBurn text. Convert the text to paths in LightBurn to bring it across.',
    ]);
  });

  it('names the shapes it found no geometry in, and how many', () => {
    const emptyPath =
      '<Shape Type="Path" CutIndex="0"><VertList></VertList><PrimList></PrimList></Shape>';
    const { warnings } = report(
      `<Shape Type="Rect" CutIndex="0" W="0" H="10"/>${emptyPath}${emptyPath}`,
    );
    expect(warnings).toEqual([
      '2 Path shapes had no geometry KerfDesk could read and were not imported.',
      '1 Rect shape had no geometry KerfDesk could read and was not imported.',
    ]);
  });

  it('leaves out shapes whose coordinates are not finite or out of range', () => {
    const path = (vertices: string) =>
      `<Shape Type="Path" CutIndex="0"><VertList>${vertices}</VertList><PrimList>LineClosed</PrimList></Shape>`;
    const huge = path('V0 0V1e308 0V0 10');
    const scaled =
      '<Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1e300 0 0 1e300 0 0</XForm></Shape>';
    const { warnings } = report(huge + scaled);
    expect(warnings).toEqual([
      '1 Path shape had coordinates that are not numbers or lie beyond ±1,000,000 mm, and was not imported. The file may be damaged.',
      '1 Rect shape had coordinates that are not numbers or lie beyond ±1,000,000 mm, and was not imported. The file may be damaged.',
    ]);
  });

  it('says why when every shape was out of range', () => {
    const result = importLightBurnProject(
      '<LightBurnProject AppVersion="1.7.08" FormatVersion="1"><Shape Type="Path" CutIndex="0"><VertList>V0 0V1e309 0V0 10</VertList><PrimList>LineClosed</PrimList></Shape></LightBurnProject>',
      'sign.lbrn2',
    );
    expect(result).toEqual({
      ok: false,
      reason:
        'LightBurn project contains no supported vector geometry. 1 Path shape had coordinates that are not numbers or lie beyond ±1,000,000 mm, and was not imported. The file may be damaged.',
    });
  });
});
