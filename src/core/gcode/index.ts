// Shared G-code parsing primitives (ADR-255 stage 1) — the single modal
// engine composed by io/gcode/parse-gcode-program.ts and
// core/job/motion-manifest-parser.ts.

export {
  GCODE_WORD_PATTERN,
  INCH_TO_MM,
  scanCompleteGcodeWords,
  scanGcodeWords,
  stripInlineComments,
  type GcodeWordMatch,
} from './word-scan';
export {
  applySharedGCode,
  resolveAxisTarget,
  type AxisTriple,
  type CoreMotionModal,
} from './modal-axes';
export {
  ARC_EPSILON,
  arcSweepAngle,
  ijArcCenter,
  rArcGeometry,
  type RArcGeometry,
  type XyPoint,
} from './arc-solve';
// `motion-words` is imported directly by the emitter that spells with it: this
// barrel is at its public-export ratchet (ADR-332).
export {
  formatGcodeCoordinateMm,
  GCODE_COORDINATE_DECIMAL_PLACES,
  hasGcodeXyMotionAtEmitPrecision,
} from './coordinate-format';
export { PROGRAM_PARSE_REASON } from './program-parse-reason';
