// Narrow public surface for the shared ordinary-GRBL coordinate contract.
// This keeps cross-module consumers off the frozen legacy core/cnc barrel.
export {
  CNC_MASK_EMISSION_XY_CLEARANCE_MM,
  cncCoordinateRepresentationMm,
  formatCncCoordinateMm,
  representedCncCoordinateMm,
  requestedCncCoordinateText,
  type CncCoordinateRepresentation,
} from '../cnc-output-precision';
export { cncContourEmissionVertices, type CncContourEmissionVertex } from '../cnc-contour-emission';
