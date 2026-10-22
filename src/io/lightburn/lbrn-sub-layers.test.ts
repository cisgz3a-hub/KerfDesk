import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import type { Layer, Project } from '../../core/scene';
import { importLightBurnProject, type LbrnImportReport } from './lbrn-import';

// LightBurn 1.2 and later nest each sub-layer of a layer as a <SubLayer> inside
// its CutSetting, writing only the values that differ from the defaults, and
// run a layer's tabs in turn, left to right. Each tab has its own Output
// switch, `suboutput`, written `0` when off (ADR-388 Amendment 1, audit
// 21-P2-1 and 21-P2-2). The settings below copy the shapes of real LightBurn
// 1.6.03 and 1.7.08 projects named in the audit.

function opened(setting: string): { readonly project: Project; readonly report: LbrnImportReport } {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.6.03" FormatVersion="1" MirrorX="False" MirrorY="False">${setting}
      <Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 50 50</XForm></Shape>
    </LightBurnProject>`,
    'buttons.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result;
}

type Operation = Pick<Layer, 'name' | 'mode' | 'power' | 'speed' | 'passes' | 'output'> & {
  readonly kerf: number | undefined;
};

function operations(project: Project): Operation[] {
  return project.scene.layers.map(({ name, mode, power, speed, passes, output, kerfOffsetMm }) => ({
    name,
    mode,
    power,
    speed,
    passes,
    output,
    kerf: kerfOffsetMm,
  }));
}

/** Each compiled group's kind, operation, power and passes, in run order. */
function jobGroups(project: Project): ReadonlyArray<ReadonlyArray<string | number>> {
  return compileJob(project.scene, project.device).groups.map((group) =>
    group.kind === 'cnc'
      ? [group.kind, group.layerId]
      : [group.kind, group.layerId, group.power, group.passes],
  );
}

function operationIdsOf(project: Project): Array<ReadonlyArray<string> | undefined> {
  return project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? object.paths.map((path) => path.operationIds) : [],
  );
}

const SUB_LAYER_REPORT = /“SubLayer” settings were not imported/;

describe('LightBurn sub-layers', () => {
  it("keeps a sub-layer's passes and kerf out of the layer, and runs the sub-layer after it", () => {
    // The layer leaves numPasses and kerf at their defaults, so LightBurn omits them.
    const { project, report } = opened(`<CutSetting type="Cut">
        <index Value="0"/><name Value="C00"/><maxPower Value="30"/><speed Value="10"/><priority Value="0"/>
        <SubLayer type="Cut" index="1">
          <maxPower Value="60"/><speed Value="5"/><numPasses Value="4"/><kerf Value="0.3"/>
        </SubLayer>
      </CutSetting>`);
    expect(operations(project)).toEqual([
      { name: 'C00', mode: 'line', power: 30, speed: 600, passes: 1, output: true, kerf: 0 },
      {
        name: 'C00 (Sub-layer 2)',
        mode: 'line',
        power: 60,
        speed: 300,
        passes: 4,
        output: true,
        kerf: 0.3,
      },
    ]);
    const [layer, subLayer] = project.scene.layers as [Layer, Layer];
    expect(subLayer.color).not.toBe(layer.color);
    expect(operationIdsOf(project)).toEqual([[layer.id, subLayer.id]]);
    expect(jobGroups(project)).toEqual([
      ['cut', layer.id, 30, 1],
      ['cut', subLayer.id, 60, 4],
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('opens a Scan layer with a Cut sub-layer as a fill and then a line, each with its own settings', () => {
    // LightBurn's Fill+Line done with sub-layers (davidribyrne/laser signature/love.lbrn2, 1.7.08).
    const { project, report } = opened(`<CutSetting type="Scan">
        <index Value="0"/><name Value="Signature"/><minPower Value="12"/><maxPower Value="12"/>
        <speed Value="100"/><overscan Value="0"/><priority Value="0"/>
        <SubLayer type="Cut" index="1">
          <minPower Value="12"/><maxPower Value="12"/><speed Value="30"/><numPasses Value="3"/>
          <interval Value="0.5"/><angle Value="90"/>
        </SubLayer>
      </CutSetting>`);
    expect(operations(project)).toEqual([
      { name: 'Signature', mode: 'fill', power: 12, speed: 6000, passes: 1, output: true, kerf: 0 },
      {
        name: 'Signature (Sub-layer 2)',
        mode: 'line',
        power: 12,
        speed: 1800,
        passes: 3,
        output: true,
        kerf: 0,
      },
    ]);
    // The Cut sub-layer's interval and angle are not the fill's.
    const fill = project.scene.layers[0];
    expect([fill?.hatchAngleDeg, fill?.hatchSpacingMm]).toEqual([0, 0.1]);
    expect(jobGroups(project).map(([kind]) => kind)).toEqual(['fill', 'cut']);
    expect(report.warnings).not.toContainEqual(expect.stringMatching(SUB_LAYER_REPORT));
  });

  it('burns only the tabs LightBurn outputs, and names the ones switched off', () => {
    // rispeed/CL650-DCPCCP DCP_BUTTONS.lbrn2 (1.6.03), layer C00: only "GOOD FINAL" is on.
    const { project, report } = opened(`<CutSetting type="Scan">
        <index Value="0"/><name Value="C00"/><suboutput Value="0"/><minPower Value="0"/>
        <maxPower Value="15"/><speed Value="13.3333"/><scanOpt Value="byGroup"/>
        <subname Value="One"/><priority Value="0"/>
        <SubLayer type="Scan" index="1">
          <suboutput Value="0"/><minPower Value="10"/><maxPower Value="20"/>
          <speed Value="16.6667"/><scanOpt Value="byGroup"/><subname Value="Two"/>
        </SubLayer>
        <SubLayer type="Cut" index="2">
          <suboutput Value="0"/><maxPower Value="20"/><speed Value="13.3333"/>
        </SubLayer>
        <SubLayer type="Scan" index="3">
          <minPower Value="10"/><maxPower Value="10"/><speed Value="13.3333"/>
          <scanOpt Value="individual"/><subname Value="GOOD FINAL"/>
        </SubLayer>
      </CutSetting>`);
    expect(
      project.scene.layers.map(({ name, mode, power, output }) => ({ name, mode, power, output })),
    ).toEqual([
      { name: 'C00', mode: 'fill', power: 15, output: false },
      { name: 'C00 (Two)', mode: 'fill', power: 20, output: false },
      { name: 'C00 (Sub-layer 3)', mode: 'line', power: 20, output: false },
      { name: 'C00 (GOOD FINAL)', mode: 'fill', power: 10, output: true },
    ]);
    const goodFinal = project.scene.layers[3];
    expect(jobGroups(project)).toEqual([['fill', goodFinal?.id, 10, 1]]);
    expect(report.warnings).toContain(
      'C00: sub-layers “C00”, “C00 (Two)” and “C00 (Sub-layer 3)” are switched off in LightBurn, so their operations opened with Output off.',
    );
    // Each tab's own settings are reported under its own operation.
    expect(report.warnings).toContain(
      'C00 (GOOD FINAL): LightBurn Fill Grouping was not imported (scanOpt individual).',
    );
    expect(report.warnings).not.toContainEqual(expect.stringMatching(SUB_LAYER_REPORT));
    expect(report.warnings).not.toContainEqual(expect.stringMatching(/subname|suboutput/));
  });

  it('keeps a layer whose only tab is switched off out of the job, and says so', () => {
    const { project, report } = opened(`<CutSetting type="Cut">
        <index Value="0"/><name Value="C00"/><suboutput Value="0"/><maxPower Value="30"/>
        <speed Value="10"/>
      </CutSetting>`);
    expect(project.scene.layers.map((layer) => layer.output)).toEqual([false]);
    expect(jobGroups(project)).toEqual([]);
    expect(report.warnings).toEqual([
      'C00: sub-layer “C00” is switched off in LightBurn, so its operation opened with Output off.',
    ]);
  });

  it("keeps every sub-layer out of the job when the layer's Output switch is off", () => {
    // WouterVandeWiele/robox2024 rear-plate (1.7.08), layer "Letters uitensijden".
    const { project } = opened(`<CutSetting type="Scan">
        <index Value="0"/><name Value="Letters"/><maxPower Value="20"/><speed Value="20"/>
        <overscan Value="0"/><doOutput Value="0"/>
        <SubLayer type="Cut" index="1"><maxPower Value="0.25"/><speed Value="10"/></SubLayer>
      </CutSetting>`);
    expect(project.scene.layers.map((layer) => layer.output)).toEqual([false, false]);
    expect(jobGroups(project)).toEqual([]);
  });

  it('opens a Fill+Line sub-layer as a fill and then a line', () => {
    const { project } = opened(`<CutSetting type="Cut">
        <index Value="0"/><name Value="C00"/><maxPower Value="30"/><speed Value="10"/>
        <SubLayer type="Scan+Cut" index="1"><maxPower Value="50"/><speed Value="40"/>
          <subname Value="Badge"/></SubLayer>
      </CutSetting>`);
    expect(project.scene.layers.map(({ name, mode }) => ({ name, mode }))).toEqual([
      { name: 'C00', mode: 'line' },
      { name: 'C00 (Badge)', mode: 'fill' },
      { name: 'C00 (Badge) (Line)', mode: 'line' },
    ]);
    expect(new Set(project.scene.layers.map((layer) => layer.id)).size).toBe(3);
  });
});
