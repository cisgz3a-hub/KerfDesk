// design-carve-source — what the carve preview knows about the machine
// (ADR-272 Amendment 1). On a CNC project this is the real stock footprint in
// SCENE frame (the ADR-261 one-frame rule: the same toSceneCoords mapping the
// CNC result pane uses), the real tool table, and the active bit. On a laser
// project the Studio still previews: the whole bed as stock at the default
// thickness, with the starter bits — informative, never blocking.

import { isChiploadMaterialKey, type ChiploadMaterial } from '../../../core/cnc';
import type { CarveStock } from '../../../core/design-carve';
import { toSceneCoords } from '../../../core/devices';
import {
  DEFAULT_CNC_STOCK,
  DEFAULT_CNC_TOOLS,
  activeCncTool,
  type CncTool,
  type Project,
} from '../../../core/scene';

export type DesignCarveSource = {
  readonly stock: CarveStock;
  readonly tools: ReadonlyArray<CncTool>;
  readonly activeTool: CncTool;
  readonly materialKey?: ChiploadMaterial;
};

const FALLBACK_TOOL: CncTool = DEFAULT_CNC_TOOLS[0] ?? {
  id: 'em-3175',
  name: '3.175 mm end mill',
  kind: 'end-mill',
  diameterMm: 3.175,
};

export function designCarveSource(project: Project): DesignCarveSource {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') {
    return {
      stock: {
        widthMm: project.workspace.width,
        heightMm: project.workspace.height,
        thicknessMm: DEFAULT_CNC_STOCK.thicknessMm,
        originX: 0,
        originY: 0,
      },
      tools: DEFAULT_CNC_TOOLS,
      activeTool: FALLBACK_TOOL,
    };
  }
  const stock = machine.stock;
  const a = toSceneCoords(stock.originOffset, project.device);
  const b = toSceneCoords(
    { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
    project.device,
  );
  const materialKey = stock.materialKey;
  return {
    stock: {
      widthMm: Math.abs(b.x - a.x),
      heightMm: Math.abs(b.y - a.y),
      thicknessMm: stock.thicknessMm,
      originX: Math.min(a.x, b.x),
      originY: Math.min(a.y, b.y),
    },
    tools: machine.tools,
    activeTool: activeCncTool(machine),
    // materialKey is a plain string on the model; an unrecognised key just
    // means generic timber shading, same as the CNC pane.
    ...(isChiploadMaterialKey(materialKey) ? { materialKey } : {}),
  };
}
