// Shared compile defaults that are consumed outside compile-job.ts.

// Default overscan kept here (not on Layer) so it can ride device
// profiles in the future without a .lf2 schema bump. 5 mm is a fixed
// starting value, not derived from the machine: reaching speed takes
// v^2 / (2a), about 6.9 mm at 5000 mm/min with 500 mm/s^2 acceleration.
export const DEFAULT_OVERSCAN_MM = 5;
