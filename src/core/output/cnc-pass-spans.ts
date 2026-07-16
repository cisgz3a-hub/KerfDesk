// CncPassSpan — where each CncPass landed in the emitted CNC program, in the
// 1-based RAW line numbering that rawResumeLine / Start-from-line speak.
//
// Produced by emitCncJobWithPassSpans (cnc-grbl-strategy.ts) as a sidecar of
// the ordinary emission — recording spans never changes the emitted bytes.
// Consumed by CNC pass-boundary recovery (ADR-215) to map the checkpoint's
// acknowledged-line count onto the pass the recovery job should rewind to.

export type CncPassSpan = {
  /** Index into Job.groups (not the CNC-only ordinal). */
  readonly groupIndex: number;
  /** Index into that group's passes. */
  readonly passIndex: number;
  /** 1-based inclusive raw line numbers into the emitted program. Lines
   * between spans (preamble, group comments, tool changes, postamble) belong
   * to no pass; a degenerate pass that emits no lines gets no span. */
  readonly firstRawLine: number;
  readonly lastRawLine: number;
};

export type CncPassSpanRecorder = (span: CncPassSpan) => void;

export type CncPassSpanEmission = {
  readonly gcode: string;
  readonly spans: ReadonlyArray<CncPassSpan>;
};
