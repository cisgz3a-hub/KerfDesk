// Shared precision contract between CNC planning and ordinary emitted
// coordinates. The GRBL emitter writes XYZ to three decimal places; only a
// contour whose real XY motion would otherwise disappear may use the narrowest
// per-word representation supported by GRBL's eight parsed input digits (see
// cnc-contour-emission.ts). Mask-aware CAM keeps a full standard-output quantum
// of clearance in XY and Z, so that narrow exception cannot weaken its
// conservative clearance.

export const CNC_COORDINATE_DECIMAL_PLACES = 3;
export const CNC_COORDINATE_QUANTUM_MM = 10 ** -CNC_COORDINATE_DECIMAL_PLACES;

// A rounded XY pair can move by sqrt(2) * quantum/2. One full quantum is a
// simple conservative radial bound and also exceeds either axis's error.
export const CNC_MASK_EMISSION_XY_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;

// Z can round downward by quantum/2. A full quantum keeps the mask constraint
// conservative after the sampled tip surface is stored and emitted.
export const CNC_MASK_EMISSION_Z_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;
