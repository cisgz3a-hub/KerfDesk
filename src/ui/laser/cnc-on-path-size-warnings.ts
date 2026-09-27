// detectCncOnPathSizeWarnings — CNC-mode advisory for ADR-256's default cut type.
// On path centres the bit on the drawn line, so a closed shape cut through the
// stock comes out one bit diameter smaller, and a hole one bit diameter larger.
// That is right for engraving a line and wrong for a part that has to fit, so
// Job Review says it whenever an on-path layer cuts a closed shape through the
// stock. Through means depth >= stock thickness, the same rule the through-cut
// tab advisory uses, so the shallow out-of-box layer never trips it.
//
// A bit that narrows toward its tip cuts less than its diameter at the top
// face when the cut is shallower than its flutes, so the amount is the width
// it cuts there, the layout's wall width (ADR-368 Amendment 3).
//
// Advisory only (ADR-206): On path stays the default the maintainer chose.

// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { cncLayoutCutWidths } from '../../core/cnc/layout-cut-widths';
import { DEFAULT_CNC_LAYER_SETTINGS, layerCncTool, type Project } from '../../core/scene';
import { cncNoteContours } from '../layers/cnc-note-contours';
import { formatMm } from './job-review/job-review-format';

export function detectCncOnPathSizeWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'profile-on-path') continue;
    if (settings.depthMm < machine.stock.thicknessMm) continue;
    const { polylines } = cncNoteContours(project.scene.objects, layer, project.device);
    if (!polylines.some((polyline) => polyline.closed)) continue;
    const tool = layerCncTool(machine, settings);
    const { wallDiameterMm } = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
    const widthMm = formatMm(wallDiameterMm);
    const sizeChange =
      wallDiameterMm < tool.diameterMm
        ? `at the top face its closed parts come out ${widthMm} mm (the width the bit cuts ` +
          `there) smaller and its holes ${widthMm} mm larger`
        : `its closed parts come out ${widthMm} mm (one bit diameter) smaller and its holes ` +
          `${widthMm} mm larger`;
    warnings.push(
      `Layer ${layer.id} cuts On path through the stock, so ${sizeChange}. ` +
        'Choose Outside or Inside to keep their drawn size.',
    );
  }
  return warnings;
}
