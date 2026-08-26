import type { CSSProperties } from 'react';
import type { RasterPreviewDisplayAdvisory } from './draw-raster-preview';

export function RasterPreviewDisplayBanner(props: {
  readonly advisory: RasterPreviewDisplayAdvisory;
  readonly style: CSSProperties;
}): JSX.Element {
  const advisory = props.advisory;
  return (
    <div className="lf-banner lf-banner--warning" style={props.style} role="status">
      Raster display resolution reduced after output compilation for{' '}
      {advisory.objectCount.toLocaleString()} image{advisory.objectCount === 1 ? '' : 's'}. Largest
      emitted sampling grid: {advisory.largestSourceWidth.toLocaleString()} ×{' '}
      {advisory.largestSourceHeight.toLocaleString()}; displayed at{' '}
      {advisory.largestDisplayWidth.toLocaleString()} ×{' '}
      {advisory.largestDisplayHeight.toLocaleString()}. Emitted S-values and G-code are unchanged.
    </div>
  );
}
