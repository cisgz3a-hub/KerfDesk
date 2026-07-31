import type { CncTool } from './cnc-tool';

// Starter bit library — common hobby-router bits. Names are mm-first with the
// imperial fraction the bit is physically sold by in parens, so an operator can
// match the bit in hand while the app stays metric. Diameters in mm. Existing
// ids are STABLE (referenced by .lf2 files, the default toolId, and tests) —
// only ever append here.
export const DEFAULT_CNC_TOOLS: ReadonlyArray<CncTool> = [
  { id: 'em-3175', name: '3.175 mm (1/8") end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'em-1588', name: '1.588 mm (1/16") end mill', kind: 'end-mill', diameterMm: 1.588 },
  { id: 'em-6350', name: '6.35 mm (1/4") end mill', kind: 'end-mill', diameterMm: 6.35 },
  { id: 'em-9525', name: '9.525 mm (3/8") end mill', kind: 'end-mill', diameterMm: 9.525 },
  { id: 'em-1000', name: '1 mm end mill', kind: 'end-mill', diameterMm: 1 },
  { id: 'em-2000', name: '2 mm end mill', kind: 'end-mill', diameterMm: 2 },
  { id: 'em-3000', name: '3 mm end mill', kind: 'end-mill', diameterMm: 3 },
  { id: 'em-6000', name: '6 mm end mill', kind: 'end-mill', diameterMm: 6 },
  { id: 'dc-3175', name: '3.175 mm (1/8") downcut end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'cp-6350', name: '6.35 mm (1/4") compression bit', kind: 'end-mill', diameterMm: 6.35 },
  { id: 'bn-3175', name: '3.175 mm (1/8") ball nose', kind: 'ball-nose', diameterMm: 3.175 },
  { id: 'bn-1588', name: '1.588 mm (1/16") ball nose', kind: 'ball-nose', diameterMm: 1.588 },
  { id: 'bn-6350', name: '6.35 mm (1/4") ball nose', kind: 'ball-nose', diameterMm: 6.35 },
  { id: 'vb-30', name: '30° V-bit', kind: 'v-bit', diameterMm: 3.175, tipAngleDeg: 30 },
  { id: 'vb-45', name: '45° V-bit', kind: 'v-bit', diameterMm: 6.35, tipAngleDeg: 45 },
  { id: 'vb-60', name: '60° V-bit', kind: 'v-bit', diameterMm: 6.35, tipAngleDeg: 60 },
  { id: 'vb-90', name: '90° V-bit', kind: 'v-bit', diameterMm: 12.7, tipAngleDeg: 90 },
  {
    id: 'eng-15',
    name: '15° engraving bit',
    kind: 'engraving',
    diameterMm: 3.175,
    tipAngleDeg: 15,
  },
  {
    id: 'vb-90-6350-hobby',
    name: '90° V-bit — 6.35 mm (1/4") cut, 3.175 mm (1/8") shank',
    kind: 'v-bit',
    diameterMm: 6.35,
    tipAngleDeg: 90,
  },
  {
    id: 'vb-90-12700-hobby',
    name: '90° V-bit — 12.7 mm (1/2") cut, 6.35 mm (1/4") shank',
    kind: 'v-bit',
    diameterMm: 12.7,
    tipAngleDeg: 90,
  },
];
