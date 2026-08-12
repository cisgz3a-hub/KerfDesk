// Shared precision contract between CNC planning and emitted coordinates.
// The GRBL emitter writes XYZ to three decimal places. Mask-aware CAM keeps a
// full output quantum of clearance in XY and Z so nearest-decimal rounding,
// residual rotation/translation, and representable-number noise cannot turn a
// mathematically tangent path into excluded-stock removal.

export const CNC_COORDINATE_DECIMAL_PLACES = 3;
export const CNC_COORDINATE_QUANTUM_MM = 10 ** -CNC_COORDINATE_DECIMAL_PLACES;

// A rounded XY pair can move by sqrt(2) * quantum/2. One full quantum is a
// simple conservative radial bound and also exceeds either axis's error.
export const CNC_MASK_EMISSION_XY_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;

// Z can round downward by quantum/2. A full quantum keeps the mask constraint
// conservative after the sampled tip surface is stored and emitted.
export const CNC_MASK_EMISSION_Z_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;
