import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import { polylineBounds } from '../../core/job/segment-bounds';
import type { Project } from '../../core/scene';
import { importLightBurnProject, type LbrnImportReport } from './lbrn-import';

// LightBurn's Kerf Offset moves a Cut layer's closed shapes out by the offset
// and the holes inside them in, as KerfDesk's Kerf Offset does (ADR-486), so
// it opens as the layer's own (ADR-388). One that cannot come across is named.

// A 100 mm plate with a 20 mm square hole.
const PLATE_WITH_HOLE = [100, 20]
  .map(
    (size) =>
      `<Shape Type="Rect" CutIndex="0" W="${size}" H="${size}"><XForm>1 0 0 1 100 100</XForm></Shape>`,
  )
  .join('');

function opened(setting: string): { readonly project: Project; readonly report: LbrnImportReport } {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${setting}${PLATE_WITH_HOLE}</LightBurnProject>`,
    'plate.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const cutSetting = (type: string, kerf: string) =>
  `<CutSetting type="${type}"><index Value="0"/><name Value="Plate"/><maxPower Value="80"/><speed Value="10"/><kerf Value="${kerf}"/></CutSetting>`;

describe('LightBurn kerf offset', () => {
  it('opens a Cut layer kerf as its Kerf Offset: the plate grows, the hole shrinks', () => {
    const { project, report } = opened(cutSetting('Cut', '0.15'));
    expect(report.warnings).toEqual([]);
    expect(project.scene.layers.map((layer) => layer.kerfOffsetMm)).toEqual([0.15]);
    expect(cutWidths(project)).toEqual([100.3, 19.7]);
  });

  it('names a Cut layer kerf the Kerf Offset field cannot hold instead of dropping it', () => {
    for (const kerf of ['12', 'wide']) {
      const { project, report } = opened(cutSetting('Cut', kerf));
      expect(project.scene.layers.map((layer) => layer.kerfOffsetMm)).toEqual([0]);
      expect(report.warnings).toEqual([
        expect.stringMatching(new RegExp(`^Plate: LightBurn kerf offset “${kerf}”.*not imported`)),
      ]);
      expect(cutWidths(project)).toEqual([100, 20]);
    }
  });

  it('opens a kerf of 0 as no offset, with nothing to report', () => {
    const { project, report } = opened(cutSetting('Cut', '0'));
    expect(report.warnings).toEqual([]);
    expect(project.scene.layers.map((layer) => layer.kerfOffsetMm)).toEqual([0]);
  });

  it('names a Scan layer kerf, which KerfDesk does not apply to fills', () => {
    const { report } = opened(cutSetting('Scan', '0.1'));
    expect(report.warnings).toEqual([expect.stringContaining('“kerf” was not imported')]);
  });
});

// Widths of the cut contours, largest first, on the offset engine's 0.001 mm grid.
function cutWidths(project: Project): number[] {
  return compileJob(project.scene, project.device)
    .groups.flatMap((group) => (group.kind === 'cut' ? group.segments : []))
    .map((segment) => {
      const bounds = polylineBounds(segment.polyline);
      if (bounds === null) throw new Error('empty contour');
      return Math.round((bounds.maxX - bounds.minX) * 1000) / 1000;
    })
    .sort((left, right) => right - left);
}
