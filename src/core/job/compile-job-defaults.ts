// Shared compile defaults that are consumed outside compile-job.ts.

// Default overscan kept here (not on Layer) so it can ride device
// profiles in the future without a .lf2 schema bump. 5 mm is a fixed
// starting value, not derived from the machine: reaching speed takes
// v^2 / (2a), about 6.9 mm at 5000 mm/min with 500 mm/s^2 acceleration.
export const DEFAULT_OVERSCAN_MM = 5;

// The most Scan Line runway a job applies, and the Overscan field's maximum. A
// larger stored value (a LightBurn percentage converted at high speed, or a
// hand-edited project) is applied at this length, so a lead-in cannot run the
// head tens of millimetres past the artwork (ADR-238 Amendment 3).
export const MAX_FILL_OVERSCAN_MM = 25;
