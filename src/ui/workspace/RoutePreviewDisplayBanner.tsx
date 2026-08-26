import type { CSSProperties } from 'react';
import type { PreviewDisplayDecimation } from './preview-display-decimation';

export function RoutePreviewDisplayBanner(props: {
  readonly decimation: PreviewDisplayDecimation;
  readonly style: CSSProperties;
}): JSX.Element {
  const fact = props.decimation;
  return (
    <div className="lf-banner lf-banner--warning" style={props.style} role="status">
      Route display decimated: {fact.drawnSteps.toLocaleString()} of{' '}
      {fact.sourceSteps.toLocaleString()} steps and {fact.drawnSegments.toLocaleString()} of{' '}
      {fact.sourceSegments.toLocaleString()} XY segments are drawn. Retained cut paths stay
      connected and keep their endpoints; emitted output is unchanged.
    </div>
  );
}
