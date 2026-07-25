// Public API for the toolpath module: machine-facing conditioning of final
// polylines, denominated in physical units (mm). Distinct from core/trace
// (visual-fidelity px domain) and core/geometry (whose barrel is at the
// ADR-015 export cap). Cross-module consumers import from here.
export { weldOpenPolylines, type WeldOpenPolylinesOptions } from './weld-open-polylines';
