import type { RasterImage } from '../../core/scene';
import { rasterDisplayDataUrl } from '../workspace/draw-raster';
import { BoundaryModePicker } from './BoundaryModePicker';
import type { TraceOutput } from './dialog-parts';
import { TracePreview } from './TracePreview';
import { TraceCommitGridNote } from './trace-commit-grid-note';
import { traceSourceHasMask } from './trace-source-mask';
import type { BoundarySelection } from './use-boundary-selection';
import type { TracePreviewState } from './use-trace-preview';

export function TracePreviewPanel(props: {
  readonly submission: { readonly busy: boolean; readonly output: TraceOutput };
  readonly cropOnlyNote: string | null;
  readonly preview: TracePreviewState;
  readonly seed: RasterImage;
  readonly file: File | null;
  readonly boundarySelection: BoundarySelection;
}): JSX.Element {
  const selection = props.boundarySelection;
  return (
    <>
      <TracePreview
        state={props.preview}
        sourceDataUrl={comparisonSource(props)}
        imageSize={{ width: props.seed.pixelWidth, height: props.seed.pixelHeight }}
        boundary={selection.boundary}
        boundaryDisabled={props.submission.busy}
        isRasterizing={
          props.submission.busy &&
          props.submission.output === 'raster' &&
          props.preview.kind === 'ready'
        }
        onBoundaryChange={selection.setBoundary}
        onBoundaryClear={selection.clearBoundary}
      />
      {selection.boundary !== null ? (
        <BoundaryModePicker
          value={selection.boundaryMode}
          onChange={selection.setBoundaryMode}
          cropOnlyNote={props.cropOnlyNote}
          disabled={props.submission.busy}
        />
      ) : null}
      <TraceCommitGridNote preview={props.preview} source={props.seed} />
    </>
  );
}

function comparisonSource(props: {
  readonly preview: TracePreviewState;
  readonly seed: RasterImage;
  readonly file: File | null;
}): string | undefined {
  if (props.preview.kind === 'ready' && props.preview.sourceDataUrl !== undefined)
    return props.preview.sourceDataUrl;
  // Do not briefly display the unmasked source while the masked decode is pending.
  return props.seed.imageMaskId !== undefined ||
    props.seed.imageClip !== undefined ||
    (props.file !== null && traceSourceHasMask(props.file))
    ? undefined
    : rasterDisplayDataUrl(props.seed);
}
