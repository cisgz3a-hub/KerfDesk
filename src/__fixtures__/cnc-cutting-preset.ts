import type { CncTool } from '../core/scene';
import type { CncCuttingPreset } from '../core/scene/cnc-cutting-preset';
export const CNC_CONTEXT_TOOL: CncTool = {
  id: 'shop-3mm',
  name: 'Shop 3 mm downcut',
  kind: 'end-mill',
  diameterMm: 3,
  family: 'downcut',
  fluteCount: 2,
  fluteLengthMm: 5,
  stickoutMm: 10,
  shankDiameterMm: 3,
  holderSegments: [{ name: 'Collet', startMm: 10, lengthMm: 12, diameterMm: 12 }],
};
export const CNC_CONTEXT_PRESET: CncCuttingPreset = {
  id: 'shop-plywood',
  name: 'Plywood roughing',
  units: 'mm-min-rpm',
  feedMmPerMin: 800,
  plungeMmPerMin: 200,
  spindleRpm: 12000,
  depthPerPassMm: 1.2,
  stepoverPercent: 35,
  context: {
    tool: {
      id: CNC_CONTEXT_TOOL.id,
      name: CNC_CONTEXT_TOOL.name,
      kind: 'end-mill',
      diameterMm: 3,
      family: 'downcut',
      fluteCount: 2,
    },
    materialKey: 'plywood-mdf',
    machine: {
      name: 'Shop router',
      profileId: 'router-a',
      controllerKind: 'grbl-v1.1',
      spindleMaxRpm: 24000,
      maxFeedMmPerMin: 3000,
    },
  },
  provenance: { kind: 'operator', reference: 'Local operator trial record fixture' },
  qualification: { status: 'unverified', notes: 'Test data only; no material cut claimed.' },
};
