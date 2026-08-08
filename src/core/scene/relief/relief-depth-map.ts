/**
 * Lossless source samples for a top-down depth-map relief (ADR-290).
 * Samples are row-major grayscale values embedded as canonical base64;
 * 16-bit samples use PNG/network byte order. Polarity states whether a
 * lighter sample represents the stock surface or the deepest cut.
 */
export type ReliefDepthMap = {
  readonly schemaVersion: 1;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8 | 16;
  readonly samplesBase64: string;
  readonly polarity: 'light-is-high' | 'light-is-deep';
};
