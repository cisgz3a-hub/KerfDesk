import { describe, expect, it } from 'vitest';
import type { Project } from '../../core/scene';
import { emitGcode } from '../gcode';
import { importLightBurnProject, type LbrnImportReport } from './lbrn-import';

// LightBurn's Shape Properties > Power Scale is written on the <Shape> as
// `PowerScale`, a percent of the layer's power, and left out at 100 %. Real
// files write it on Scan and Cut shapes alike, for example a LightBurn 1.4.02
// power-test grid (`<Shape Type="Rect" CutIndex="2" PowerScale="10" W="43" …>`)
// and a LightBurn 1.1.04 test pattern (`<Shape Type="Ellipse" CutIndex="4"
// PowerScale="20" …>`). It opens as the object's power scale (ADR-388 Amd 2).

const scan = (index: number, power: number) =>
  `<CutSetting type="Scan"><index Value="${index}"/><name Value="Grid"/><maxPower Value="${power}"/><speed Value="100"/></CutSetting>`;
const cut = (index: number, power: number) =>
  `<CutSetting type="Cut"><index Value="${index}"/><name Value="Rings"/><maxPower Value="${power}"/><speed Value="10"/></CutSetting>`;
const rect = (cutIndex: number, x: number, scale?: string) =>
  `<Shape Type="Rect" CutIndex="${cutIndex}"${scale === undefined ? '' : ` PowerScale="${scale}"`} W="10" H="10" Cr="0"><XForm>1 0 0 1 ${x} 50</XForm></Shape>`;
const ellipse = (cutIndex: number, x: number, scale?: string) =>
  `<Shape Type="Ellipse" CutIndex="${cutIndex}"${scale === undefined ? '' : ` PowerScale="${scale}"`} Rx="3" Ry="3"><XForm>1 0 0 1 ${x} 100</XForm></Shape>`;

function opened(body: string): { readonly project: Project; readonly report: LbrnImportReport } {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.4.02" FormatVersion="1" MirrorX="False" MirrorY="False">${body}</LightBurnProject>`,
    'grid.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function scales(project: Project): Array<number | undefined> {
  return project.scene.objects.map((object) => object.powerScale);
}

// The distinct laser S words the job burns with, lowest first.
function burnPowers(project: Project): number[] {
  const words = emitGcode(project).gcode.match(/S[1-9]\d*/g) ?? [];
  return [...new Set(words.map((word) => Number(word.slice(1))))].sort((a, b) => a - b);
}

describe('LightBurn shape Power Scale', () => {
  it('opens each shape at its own scale of the layer power, on Scan and Cut layers', () => {
    const { project, report } = opened(
      `${scan(0, 80)}${cut(1, 60)}${rect(0, 20)}${rect(0, 40, '25')}` +
        `<Shape Type="Group" CutIndex="0"><XForm>1 0 0 1 0 0</XForm><Children>${ellipse(1, 60, '50')}</Children></Shape>`,
    );
    expect(report.warnings).toEqual([]);
    expect(scales(project)).toEqual([undefined, 25, 50]);
    // 80 % → S800, 25 % of 80 % → S200, 50 % of 60 % → S300 on the 0–1000 S range.
    expect(burnPowers(project)).toEqual([200, 300, 800]);
  });

  it('opens a power-test grid with every cell at its own power', () => {
    const cells = [10, 20, 30, 40, 50, 60, 70, 80, 90]
      .map((scale, column) => rect(0, 20 + column * 15, String(scale)))
      .join('');
    const { project, report } = opened(`${scan(0, 100)}${cells}`);
    expect(report.warnings).toEqual([]);
    expect(scales(project)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(burnPowers(project)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('reads a Text shape’s scale for the outline it opens from', () => {
    const text =
      '<Shape Type="Text" CutIndex="0" Font="Arial" Str="Hi" H="5" PowerScale="40" HasBackupPath="1">' +
      '<BackupPath Type="Path" CutIndex="0"><XForm>1 0 0 1 50 50</XForm>' +
      '<VertList>V0 0V10 0V10 10V0 10</VertList><PrimList>LineClosed</PrimList></BackupPath></Shape>';
    const { project } = opened(`${cut(0, 50)}${text}`);
    expect(scales(project)).toEqual([40]);
    expect(burnPowers(project)).toEqual([200]);
  });

  it('opens a written 100 % as no scale', () => {
    const { project, report } = opened(`${cut(0, 50)}${rect(0, 20, '100')}`);
    expect(report.warnings).toEqual([]);
    expect(scales(project)).toEqual([undefined]);
  });

  it('names a scale the field cannot hold instead of applying it', () => {
    const { project, report } = opened(
      `${cut(0, 50)}${rect(0, 20, '-1')}${rect(0, 40, 'half')}${rect(0, 60, '150')}${rect(0, 80, '-1')}`,
    );
    expect(scales(project)).toEqual([undefined, undefined, undefined, undefined]);
    expect(report.warnings).toEqual([
      '4 shapes had a Power Scale that is not a percent from 0 to 100 ("-1", "half", "150"), so they open at their layer\'s full power. Set it as the Power multiplier in Advanced artwork settings before running the job.',
    ]);
    expect(project.notes).toContain('had a Power Scale that is not a percent');
  });

  it('names a Group’s own scale, which is not applied to its shapes', () => {
    const { project, report } = opened(
      `${cut(0, 50)}<Shape Type="Group" PowerScale="50"><Children>${rect(0, 20)}${rect(0, 40, '20')}</Children></Shape>`,
    );
    expect(scales(project)).toEqual([undefined, 20]);
    expect(report.warnings).toEqual([
      '1 Group carries a Power Scale ("50") that was not applied to the shapes inside: KerfDesk scales each shape on its own, and they open at their own Power Scale. Check their Power multiplier in Advanced artwork settings.',
    ]);
  });
});
