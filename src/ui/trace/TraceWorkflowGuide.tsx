import type { ComponentProps } from 'react';
import type { RasterImage } from '../../core/scene';
import { mergeLightBurnTraceSettings } from './trace-options';
import type { TraceSettingsControls } from './TraceSettingsControls';

type Settings = ComponentProps<typeof TraceSettingsControls>;

export function traceSourceContext(source: RasterImage, settings: Settings): string {
  const options = mergeLightBurnTraceSettings(settings.preset, settings.overrides);
  const maskCapable = options.photoDetail === undefined && options.colourLayers === undefined;
  const alpha =
    maskCapable && options.traceTransparency === true && settings.sourceHasTransparency === true;
  const context = !maskCapable
    ? 'This style traces bitmap shading or colour regions; it does not use the Trace alpha mask option.'
    : alpha
      ? 'Tracing the bitmap alpha mask: opaque areas define the outline; the brightness controls apply to alpha.'
      : settings.sourceHasTransparency === undefined
        ? 'Checking source transparency. The preview will identify whether alpha-mask tracing is available.'
        : 'Tracing bitmap colour and brightness. Source transparency is separate from a canvas mask.';
  const canvasMask = source.imageMaskId !== undefined || source.imageClip !== undefined;
  return canvasMask
    ? `${context} The canvas mask or clip applies to the comparison image, preview and both trace outputs. Original shows the masked source; the stored bitmap and native clip are kept. A trace boundary can further crop or enhance this area. Cut paths may become editable polylines at the existing clipping tolerance.`
    : context;
}

export function TraceWorkflowGuide(props: {
  readonly source: RasterImage;
  readonly settings: Settings;
  readonly output: 'vector' | 'raster';
  readonly photoShading: boolean;
}): JSX.Element {
  return (
    <details className="lf-trace-settings-details" open>
      <summary title="Choose the result, compare the outline with its source, then place it.">
        Image to outline
      </summary>
      <ol className="lf-trace-hint">
        <li>
          Choose a trace style for your artwork. Editable vectors give you paths for cutting, line
          engraving or filled engraving; Raster scan engraves the traced pattern.
        </li>
        <li>
          Compare Original, Trace and Overlay. Check gaps and small details at 1:1; Fade Image and
          Show Points change only the view.
        </li>
        <li>
          Choose the output below, then Trace. Keep the source image if you want to compare or
          re-trace it later. Review the resulting operation and Frame the placed job.
        </li>
      </ol>
      <p className="lf-trace-hint" role="status">
        {traceSourceContext(props.source, props.settings)}
      </p>
      <p className="lf-trace-hint">
        {props.photoShading
          ? 'Photo shading preserves tones as filled lines; it is not a simple cutting outline.'
          : props.output === 'vector'
            ? 'Current result: editable vectors. Choose the required line or fill operation after tracing.'
            : 'Current result: raster scan of the traced pattern. Choose Editable vectors for cutting outlines.'}
      </p>
    </details>
  );
}
