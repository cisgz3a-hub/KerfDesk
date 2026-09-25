// What the trace settings panel reads from the current preview.

import type { TracePreviewState } from './use-trace-preview';

export function tracePreviewFacts(preview: TracePreviewState): {
  /** Whether the traced source has transparency, once known. */
  readonly sourceHasTransparency: boolean | undefined;
  /** The traced colours, for the Colour layers swatches (ADR-402). */
  readonly previewColours: ReadonlyArray<string> | undefined;
} {
  return {
    sourceHasTransparency:
      preview.kind === 'tracing' || preview.kind === 'ready'
        ? preview.sourceHasTransparency
        : undefined,
    previewColours: preview.kind === 'ready' ? preview.paths.map((path) => path.color) : undefined,
  };
}
