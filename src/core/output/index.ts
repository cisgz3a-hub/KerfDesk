/**
 * === FILE: /src/core/output/index.ts ===
 * 
 * Purpose:    Barrel export for the Output module.
 *             Importing this module also registers all built-in strategies.
 * Dependencies: All output module files
 * Last updated: Phase 1, Step 1 — Foundation
 */

export * from './Output';
export * from './GcodeOrigin';

// Import strategies to trigger self-registration
import './GrblStrategy';

export { GrblOutputStrategy } from './GrblStrategy';
