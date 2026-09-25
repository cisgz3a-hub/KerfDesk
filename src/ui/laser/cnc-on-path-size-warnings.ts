// detectCncOnPathSizeWarnings — CNC-mode advisory for ADR-256's default cut type.
// On path centres the bit on the drawn line, so a closed shape cut through the
// stock comes out one bit diameter smaller, and a hole one bit diameter larger.
// That is right for engraving a line and wrong for a part that has to fit, so
// Job Review says it whenever an on-path layer cuts a closed shape through the
// stock. Through means depth >= stock thickness, the same rule the through-cut
// tab advisory uses, so the shallow out-of-box layer never trips it.
//
// Advisory only (ADR-206): On path stays the default the maintainer chose.

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
    const bitMm = formatMm(layerCncTool(machine, settings).diameterMm);
    warnings.push(
      `Layer ${layer.id} cuts On path through the stock, so its closed parts come out ` +
        `${bitMm} mm (one bit diameter) smaller and its holes ${bitMm} mm larger. ` +
        'Choose Outside or Inside to keep their drawn size.',
    );
  }
  return warnings;
}
