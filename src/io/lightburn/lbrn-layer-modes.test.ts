import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import type { Layer, Project } from '../../core/scene';
import { importLightBurnProject, type LbrnImportReport } from './lbrn-import';

// A CutSetting's `type` is LightBurn's layer mode: Line is "Cut", Fill is
// "Scan" and Fill+Line is "Scan+Cut" (ADR-388).

function opened(setting: string): { readonly project: Project; readonly report: LbrnImportReport } {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${setting}
      <Shape Type="Rect" CutIndex="0" W="40" H="20"><XForm>1 0 0 1 100 100</XForm></Shape>
    </LightBurnProject>`,
    'badge.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const cutSetting = (type: string, fields = '') =>
  `<CutSetting${type === '' ? '' : ` type="${type}"`}><index Value="0"/><name Value="Badge"/><maxPower Value="40"/><speed Value="100"/>${fields}</CutSetting>`;

function modes(project: Project): Array<Pick<Layer, 'name' | 'mode'>> {
  return project.scene.layers.map(({ name, mode }) => ({ name, mode }));
}

function operationIdsOf(project: Project): Array<ReadonlyArray<string> | undefined> {
  return project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? object.paths.map((path) => path.operationIds) : [],
  );
}

describe('LightBurn layer modes', () => {
  it.each([
    ['Cut', 'line'],
    ['Scan', 'fill'],
    ['', 'line'],
  ] as const)('opens type "%s" as a %s operation with nothing to report', (type, mode) => {
    const { project, report } = opened(cutSetting(type));
    expect(modes(project)).toEqual([{ name: 'Badge', mode }]);
    expect(report.warnings).toEqual([]);
  });

  it('opens Fill+Line (Scan+Cut) as a fill and then a line on the same shapes', () => {
    const { project, report } = opened(
      cutSetting('Scan+Cut', '<interval Value="0.1"/><kerf Value="0.1"/><priority Value="2"/>'),
    );
    expect(report.warnings).toEqual([]);
    expect(modes(project)).toEqual([
      { name: 'Badge', mode: 'fill' },
      { name: 'Badge (Line)', mode: 'line' },
    ]);
    const [fill, line] = project.scene.layers as [Layer, Layer];
    expect([fill.power, fill.speed, fill.hatchSpacingMm]).toEqual([40, 6000, 0.1]);
    expect([line.power, line.speed, line.kerfOffsetMm]).toEqual([40, 6000, 0.1]);
    expect(line.color).not.toBe(fill.color);
    expect(operationIdsOf(project)).toEqual([[fill.id, line.id]]);
    const groups = compileJob(project.scene, project.device).groups;
    expect(groups.map((group) => [group.kind, group.layerId])).toEqual([
      ['fill', fill.id],
      ['cut', line.id],
    ]);
  });

  it('names a mode KerfDesk has no equivalent for and opens it as a Line operation', () => {
    const { project, report } = opened(cutSetting('Offset Fill'));
    expect(modes(project)).toEqual([{ name: 'Badge', mode: 'line' }]);
    expect(report.warnings).toEqual([
      expect.stringMatching(/^Badge: LightBurn layer mode “Offset Fill” .*Line operation/),
    ]);
  });

  it("opens LightBurn's air assist (runBlower) on each operation of the layer", () => {
    const airAssist = (type: string, value: string) => {
      const { project, report } = opened(cutSetting(type, `<runBlower Value="${value}"/>`));
      expect(report.warnings).toEqual([]);
      return project.scene.layers.map((layer) => layer.airAssist);
    };
    expect(airAssist('Cut', '1')).toEqual([true]);
    expect(airAssist('Scan', '1')).toEqual([true]);
    expect(airAssist('Scan+Cut', '1')).toEqual([true, true]);
    expect(airAssist('Cut', '0')).toEqual([false]);
  });

  it('does not report a Scan layer priority, which sets the run order', () => {
    expect(opened(cutSetting('Scan', '<priority Value="3"/>')).report.warnings).toEqual([]);
  });

  it('keeps a layer LightBurn does not output (doOutput 0) out of the job', () => {
    const output = (type: string, value: string) => {
      const { project, report } = opened(cutSetting(type, `<doOutput Value="${value}"/>`));
      expect(report.warnings).toEqual([]);
      return project.scene.layers.map((layer) => layer.output);
    };
    expect(output('Cut', '0')).toEqual([false]);
    expect(output('Scan', '0')).toEqual([false]);
    expect(output('Scan+Cut', '0')).toEqual([false, false]);
    expect(output('Cut', '1')).toEqual([true]);
    expect(output('Scan', '1')).toEqual([true]);
    const { project } = opened(cutSetting('Cut', '<doOutput Value="0"/>'));
    expect(compileJob(project.scene, project.device).groups).toEqual([]);
  });
});
