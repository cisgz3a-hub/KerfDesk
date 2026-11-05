import type { CSSProperties } from 'react';
import type { RasterPreviewDisplayAdvisory } from './draw-raster-preview';

// Plain words first: the reduction is display-only, so a beginner should not
// read it as a problem with the burn (UX audit U3-P3-5). The grid sizes stay
// for anyone checking.
export function RasterPreviewDisplayBanner(props: {
  readonly advisory: RasterPreviewDisplayAdvisory;
  readonly style: CSSProperties;
}): JSX.Element {
  const advisory = props.advisory;
  const images =
    advisory.objectCount === 1
      ? 'this image'
      : `these ${advisory.objectCount.toLocaleString()} images`;
  return (
    <div className="lf-banner lf-banner--info" style={props.style} role="status">
      Preview shows {images} at a lower resolution so it stays fast. The engraving uses full
      resolution, and the G-code is unchanged. Largest burn grid:{' '}
      {advisory.largestSourceWidth.toLocaleString()} ×{' '}
      {advisory.largestSourceHeight.toLocaleString()} pixels, shown at{' '}
      {advisory.largestDisplayWidth.toLocaleString()} ×{' '}
      {advisory.largestDisplayHeight.toLocaleString()}; each shown pixel is the average power of the
      pixels it covers.
    </div>
  );
}
