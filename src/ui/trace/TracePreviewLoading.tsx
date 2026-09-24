import { useEffect, useState } from 'react';
import type { TracePhase } from '../../core/trace/trace-progress';

const descriptions: Record<TracePhase, readonly [string, string]> = {
  preparing: ['Preparing trace', 'Preparing the image for the selected trace style.'],
  tracing: ['Tracing image', 'Finding the lines and shapes in the image.'],
  refining: ['Refining trace', 'Refining the geometry and preparing the result.'],
};

export function TracePreviewLoading(props: {
  readonly isDecoding: boolean;
  readonly isRasterizing?: boolean | undefined;
  readonly phase?: TracePhase | undefined;
  readonly startedAt?: number | undefined;
}): JSX.Element {
  const [mountedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - (props.startedAt ?? mountedAt)) / 1000));
  const [title, description] = props.isRasterizing
    ? [
        'Preparing raster output',
        'Converting the trace into its final image. Cancel remains available.',
      ]
    : props.isDecoding
      ? ['Preparing image', 'Reading the image before tracing begins.']
      : descriptions[props.phase ?? 'tracing'];
  return (
    <div className="lf-trace-preview__loading">
      <div
        className="lf-trace-preview__loading-card"
        role="progressbar"
        aria-label={
          props.isRasterizing
            ? 'Preparing raster output'
            : props.isDecoding
              ? 'Preparing image for tracing'
              : 'Tracing image'
        }
      >
        <span className="lf-trace-preview__spinner" aria-hidden="true" />
        <strong>{title}</strong>
        <p>{description}</p>
        <span aria-hidden="true">
          Elapsed {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}
