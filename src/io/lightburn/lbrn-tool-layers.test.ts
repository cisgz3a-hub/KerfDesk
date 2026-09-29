import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import { importLightBurnProject } from './lbrn-import';

// LightBurn's tool layers, T1 and T2 (CutIndex 30 and 31, type "Tool"), hold
// guides that LightBurn never cuts (ADR-388).

const square = (index: number, x: number) =>
  `<Shape Type="Rect" CutIndex="${index}" W="10" H="10"><XForm>1 0 0 1 ${x} 50</XForm></Shape>`;

function opened(content: string) {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${content}</LightBurnProject>`,
    'jig.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('LightBurn tool layers', () => {
  it('opens T1 and T2 with Output off, as LightBurn never cuts them', () => {
    const { project, report } = opened(
      '<CutSetting type="Tool"><index Value="31"/><name Value="Guides"/><maxPower Value="100"/><speed Value="5"/></CutSetting>' +
        square(0, 20) +
        square(30, 40) +
        square(31, 60),
    );
    expect(project.scene.layers.map(({ name, output }) => ({ name, output }))).toEqual([
      { name: 'LightBurn C00', output: true },
      { name: 'LightBurn T1', output: false },
      { name: 'Guides', output: false },
    ]);
    expect(report.warnings).toEqual([
      'Guides: a LightBurn tool layer, which LightBurn never cuts, so it opened with Output off.',
      'LightBurn T1: a LightBurn tool layer, which LightBurn never cuts, so it opened with Output off.',
    ]);
    const groups = compileJob(project.scene, project.device).groups;
    expect(groups.map((group) => group.layerId)).toEqual([project.scene.layers[0]?.id]);
  });
});
