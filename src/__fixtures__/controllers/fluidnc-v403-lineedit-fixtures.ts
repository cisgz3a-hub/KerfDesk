/**
 * ASCII direct-Lineedit boundaries transcribed from FluidNC v4.0.3 source.
 * These literals are a test oracle, not a CurveDesk parser or a support claim.
 */
export const FLUIDNC_V403_LINEEDIT_FIXTURES = [
  { payloadBytes: 127, retainedBytes: 127, parserResult: 'accepted' },
  { payloadBytes: 128, retainedBytes: 128, parserResult: 'error:14' },
  { payloadBytes: 254, retainedBytes: 254, parserResult: 'error:14' },
  { payloadBytes: 255, retainedBytes: 254, parserResult: 'error:14' },
  { payloadBytes: 512, retainedBytes: 254, parserResult: 'error:14' },
] as const;
