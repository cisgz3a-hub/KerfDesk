// Shared compile defaults that are consumed outside compile-job.ts.

// Default overscan kept here (not on Layer) so it can ride device
// profiles in the future without a .lf2 schema bump. 5 mm matches
// the ADR-020 baseline for diode lasers.
export const DEFAULT_OVERSCAN_MM = 5;
