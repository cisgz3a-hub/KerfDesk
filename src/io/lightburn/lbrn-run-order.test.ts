import { describe, expect, it } from 'vitest';
import { artworkRunUnits } from '../../core/artwork-run-units';
import { compileJob } from '../../core/job/compile-job';
import type { Project } from '../../core/scene';
import { importLightBurnProject } from './lbrn-import';

// LightBurn runs a project layer by layer in its Cuts / Layers list order,
// which each CutSetting records as `priority`, whatever order the shapes were
// drawn in.
function project(settings: string, shapes: string): Project {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${settings}${shapes}</LightBurnProject>`,
    'tag.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

function runOrder(opened: Project): string[] {
  const names = new Map(opened.scene.layers.map((layer) => [layer.id, layer.name]));
  const order: string[] = [];
  for (const group of compileJob(opened.scene, opened.device).groups) {
    const name = names.get(group.layerId) ?? group.layerId;
    if (order.at(-1) !== name) order.push(name);
  }
  return order;
}

const ENGRAVE_THEN_CUT = `
  <CutSetting type="Scan"><index Value="0"/><name Value="Engrave"/><maxPower Value="20"/><speed Value="200"/><priority Value="0"/></CutSetting>
  <CutSetting type="Cut"><index Value="1"/><name Value="Cut out"/><maxPower Value="80"/><speed Value="10"/><priority Value="1"/></CutSetting>`;
const OUTLINE = (x: number) =>
  `<Shape Type="Rect" CutIndex="1" W="40" H="40"><XForm>1 0 0 1 ${x} 100</XForm></Shape>`;
const DOT = (x: number) =>
  `<Shape Type="Ellipse" CutIndex="0" Rx="5" Ry="5"><XForm>1 0 0 1 ${x} 100</XForm></Shape>`;

describe('LightBurn project run order', () => {
  it('engraves before it cuts the part free, even when the outline was drawn first', () => {
    const opened = project(ENGRAVE_THEN_CUT, OUTLINE(100) + DOT(100));
    expect(runOrder(opened)).toEqual(['Engrave', 'Cut out']);
    expect(opened.scene.layers.map((layer) => layer.name)).toEqual(['Engrave', 'Cut out']);
  });

  it('runs each layer once, in list order, when its shapes are interleaved', () => {
    const opened = project(ENGRAVE_THEN_CUT, OUTLINE(100) + DOT(100) + OUTLINE(200) + DOT(200));
    expect(runOrder(opened)).toEqual(['Engrave', 'Cut out']);
    expect(artworkRunUnits(opened.scene).map((unit) => unit.objectIds.length)).toEqual([2, 2]);
    // Canvas stacking keeps LightBurn's drawing order.
    expect(opened.scene.objects.map((object) => object.id)).toEqual([
      'lbrn-tag-1',
      'lbrn-tag-2',
      'lbrn-tag-3',
      'lbrn-tag-4',
    ]);
  });

  it('follows priority over the colour index, and index when priority ties or is missing', () => {
    // Ranks (priority, index): C00 (2, 0), C01 (0, 1), C02 without a priority
    // (2, 2), C03 (2, 3).
    const opened = project(
      `<CutSetting type="Cut"><index Value="0"/><name Value="B"/><priority Value="2"/></CutSetting>
       <CutSetting type="Cut"><index Value="1"/><name Value="A"/><priority Value="0"/></CutSetting>
       <CutSetting type="Cut"><index Value="3"/><name Value="D"/><priority Value="2"/></CutSetting>
       <CutSetting type="Cut"><index Value="2"/><name Value="C"/></CutSetting>`,
      [0, 3, 2, 1]
        .map(
          (index) =>
            `<Shape Type="Rect" CutIndex="${index}" W="10" H="10"><XForm>1 0 0 1 ${50 + index * 20} 50</XForm></Shape>`,
        )
        .join(''),
    );
    expect(opened.scene.layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(runOrder(opened)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('says so when the project did not ask LightBurn to run layers first', () => {
    const prefs = (byLayer: string) =>
      `<UIPrefs><Optimize_ByLayer Value="${byLayer}"/><Optimize_ByGroup Value="-1"/></UIPrefs>`;
    const warnings = (byLayer: string) => {
      const result = importLightBurnProject(
        `<LightBurnProject>${prefs(byLayer)}${ENGRAVE_THEN_CUT}${OUTLINE(100)}</LightBurnProject>`,
        'planner.lbrn2',
      );
      if (!result.ok) throw new Error(result.reason);
      return result.report.warnings;
    };
    expect(warnings('0')).toEqual([]);
    expect(warnings('-1')).toEqual([
      expect.stringContaining('does not run layers first (Optimize_ByLayer -1)'),
    ]);
  });
});
