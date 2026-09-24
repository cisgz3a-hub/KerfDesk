import type { RasterImage } from '../../core/scene';

export function PhotoOutputGuidance(props: {
  readonly source: RasterImage;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element {
  const { source } = props;
  const width = Math.abs((source.bounds.maxX - source.bounds.minX) * source.transform.scaleX);
  const height = Math.abs((source.bounds.maxY - source.bounds.minY) * source.transform.scaleY);
  return (
    <details className="lf-trace-settings-details lf-trace-photo-guidance">
      <summary title="How size, fill direction and resolution affect photo shading.">
        Photo output tips
      </summary>
      <p className="lf-trace-hint">
        Source size: {width.toFixed(1)} × {height.toFixed(1)} mm before cropping. Shrinking the
        result also narrows its lightest lines and gaps. Judge the detail at your final engraving
        size.
      </p>
      <p className="lf-trace-hint">
        {props.machineKind === 'cnc'
          ? 'Use a tool small enough to reach the narrow filled shapes. Preview the toolpaths at the final size.'
          : 'Use Fill across the vertical ribbons (0° before rotating the artwork). Parallel passes can skip highlights. Finer spacing or raster resolution helps retain small tone changes, but takes longer.'}
      </p>
      {props.machineKind === 'laser' ? (
        <p className="lf-trace-hint">
          For the original photo’s tones, cancel Trace and keep the image on an Image layer. Its
          Dither setting offers dot patterns or Grayscale. Raster scan here engraves the traced
          ribbon pattern.
        </p>
      ) : null}
    </details>
  );
}
