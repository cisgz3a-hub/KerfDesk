/**
 * Device output format identifier shared by profiles, strategies, and compile paths.
 *
 * Kept outside `Output.ts` so type-only consumers do not import the heavier
 * output strategy module and its preflight validation dependencies.
 */
export type OutputFormat = 'grbl' | 'marlin' | 'smoothie' | 'ruida' | 'custom';
