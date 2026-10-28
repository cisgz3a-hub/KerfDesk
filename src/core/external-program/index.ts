// core/external-program — running a G-code file made elsewhere through Frame
// and Start (ADR-630): the exact bytes to send, and what its review shows.

export {
  BASELINE_WORD_MEANINGS,
  EXTERNAL_PROGRAM_BASELINE,
  canonicalLine,
  createExternalProgramNormalizer,
  externalProgramBaseline,
  normalizeExternalProgram,
  sourceLines,
  stripComments,
  type ExternalProgram,
  type ExternalProgramNormalizer,
  type ExternalProgramResult,
} from './normalize-external-program';
export {
  reviewExternalProgram,
  type ExternalProgramContext,
  type ExternalProgramEnvelope,
  type ExternalProgramReview,
  type ExternalProgramUnits,
} from './external-program-review';
export { findLitRapids, type LitRapids } from './lit-rapids';
export { externalProgramZLifts, type ExternalProgramZLifts } from './program-z-lifts';
