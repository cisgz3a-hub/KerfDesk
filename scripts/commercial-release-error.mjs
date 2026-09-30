/**
 * A refusal raised by the commercial release tooling itself. Keep this shared
 * type dependency-free so qualification can run before package installation.
 * Messages are authored here, never copied from secrets or provider responses.
 */
export class CommercialReleaseError extends Error {}
