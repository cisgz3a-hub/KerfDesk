import { describe, expect, it } from 'vitest';
import { importLightBurnProject } from './lbrn-import';

// A LightBurn project's notes open as the project's notes, with the import
// report beneath them, so the report stays with the project (ADR-388).

const RECT = '<Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape>';
const BITMAP = '<Shape Type="Bitmap" CutIndex="0" W="5" H="5"/>';

function opened(content: string) {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="2.0.05" FormatVersion="1">${content}</LightBurnProject>`,
    'sign.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return { notes: result.project.notes, warnings: result.report.warnings };
}

const NOTES = '<Notes ShowOnLoad="0" Notes="Birch, 3 mm.&#10;Run the engrave twice."/>';

describe('LightBurn project notes', () => {
  it("opens LightBurn's notes as the project's notes", () => {
    expect(opened(NOTES + RECT)).toEqual({
      notes: 'Birch, 3 mm.\nRun the engrave twice.',
      warnings: [],
    });
    expect(opened('<Notes ShowOnLoad="0" Notes=""/>' + RECT).notes).toBe('');
  });

  it('keeps the import report beneath them', () => {
    const { notes, warnings } = opened(NOTES + RECT + BITMAP);
    expect(notes).toBe(
      [
        'Birch, 3 mm.\nRun the engrave twice.',
        '',
        'LightBurn import report for sign.lbrn2:',
        ...warnings.map((warning) => `- ${warning}`),
      ].join('\n'),
    );
    expect(opened(RECT + BITMAP).notes).toMatch(
      /^LightBurn import report for sign\.lbrn2:\n- 1 Bitmap/,
    );
  });

  it('says where to read notes LightBurn shows when the project opens', () => {
    const { warnings } = opened(NOTES.replace('ShowOnLoad="0"', 'ShowOnLoad="1"') + RECT);
    expect(warnings).toEqual([
      "LightBurn shows this project's notes when it opens: read them in Window > Project Notes.",
    ]);
  });
});
