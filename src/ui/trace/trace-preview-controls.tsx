import {
  formatPreviewZoom,
  isAtZoomLimit,
  MIN_PREVIEW_ZOOM,
  stepPreviewZoom,
  type PreviewZoomRange,
} from './trace-preview-zoom-math';

export type TracePreviewView = 'original' | 'trace' | 'overlay';

type Props = {
  readonly view: TracePreviewView;
  readonly hasSource: boolean;
  readonly hasTrace: boolean;
  readonly zoom: number;
  readonly zoomRange: PreviewZoomRange;
  readonly isSourceFaded: boolean;
  readonly shouldShowPoints: boolean;
  readonly hasBoundary: boolean;
  readonly boundaryDisabled?: boolean;
  readonly onViewChange: (view: TracePreviewView) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onToggleFade: () => void;
  readonly onTogglePoints: () => void;
  readonly onBoundaryClear: (() => void) | undefined;
};

export function TracePreviewControls(props: Props): JSX.Element {
  return (
    <>
      <div className="lf-trace-preview__toolbar">
        <ViewControls view={props.view} hasSource={props.hasSource} onChange={props.onViewChange} />
        <ZoomControls zoom={props.zoom} range={props.zoomRange} onChange={props.onZoomChange} />
      </div>
      <div className="lf-trace-preview__options" role="group" aria-label="Preview overlays">
        {props.hasSource ? (
          <button
            type="button"
            aria-pressed={props.isSourceFaded}
            disabled={props.view !== 'overlay'}
            onClick={props.onToggleFade}
            className="lf-btn"
            title="Fade the original image behind the blue trace in Overlay view."
          >
            Fade Image
          </button>
        ) : null}
        {props.hasTrace ? (
          <button
            type="button"
            aria-pressed={props.shouldShowPoints}
            disabled={props.view === 'original'}
            onClick={props.onTogglePoints}
            className="lf-btn"
            title="Show traced vector points. Dense overlapping markers combine on screen; zoom in to separate them."
          >
            Show Points
          </button>
        ) : null}
        {props.hasBoundary ? (
          <button
            type="button"
            onClick={props.onBoundaryClear}
            disabled={props.boundaryDisabled}
            className="lf-btn lf-trace-preview__clear"
            title="Clear the selected trace boundary and trace the full image again."
          >
            Clear Boundary
          </button>
        ) : null}
      </div>
    </>
  );
}

function ViewControls(props: {
  readonly view: TracePreviewView;
  readonly hasSource: boolean;
  readonly onChange: (view: TracePreviewView) => void;
}): JSX.Element {
  return (
    <div className="lf-trace-preview__views" role="group" aria-label="Trace preview view">
      {VIEW_CHOICES.map(([view, label, accessibleLabel, description]) => (
        <button
          key={view}
          type="button"
          className="lf-btn"
          aria-label={accessibleLabel}
          title={description}
          aria-pressed={props.view === view}
          disabled={view !== 'trace' && !props.hasSource}
          onClick={() => props.onChange(view)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ZoomControls(props: {
  readonly zoom: number;
  readonly range: PreviewZoomRange;
  readonly onChange: (zoom: number) => void;
}): JSX.Element {
  const { zoom, range } = props;
  const actualSize = range.actualSize;
  const nativePercent =
    actualSize === null ? '' : ` (${Math.round((zoom / actualSize) * 100)}% of image pixels)`;
  return (
    <div className="lf-trace-preview__zoom" role="group" aria-label="Preview zoom">
      <button
        type="button"
        className="lf-btn"
        aria-label="Zoom out"
        title="Halve preview magnification (− key, or wheel down over the preview)."
        disabled={zoom <= range.min || isAtZoomLimit(zoom, range.min)}
        onClick={() => props.onChange(stepPreviewZoom(zoom, -1))}
      >
        −
      </button>
      <span
        aria-label="Preview magnification"
        title={`Magnification relative to Fit${nativePercent}`}
      >
        {formatPreviewZoom(zoom)}×
      </span>
      <button
        type="button"
        className="lf-btn"
        aria-label="Zoom in"
        title={`Double preview magnification, up to ${formatPreviewZoom(range.max)} times Fit (+ key, or wheel up over the preview).`}
        disabled={zoom >= range.max || isAtZoomLimit(zoom, range.max)}
        onClick={() => props.onChange(stepPreviewZoom(zoom, 1))}
      >
        +
      </button>
      <button
        type="button"
        className="lf-btn"
        title="Fit the entire image in the preview (0 key)"
        onClick={() => props.onChange(MIN_PREVIEW_ZOOM)}
      >
        Fit
      </button>
      <button
        type="button"
        className="lf-btn"
        aria-label="Actual size"
        title="Show one image pixel per screen pixel (1 key)"
        disabled={actualSize === null}
        onClick={() => {
          if (actualSize !== null) props.onChange(actualSize);
        }}
      >
        1:1
      </button>
    </div>
  );
}

const VIEW_CHOICES = [
  [
    'original',
    'Original',
    'Show original image',
    'View the original image without traced vectors.',
  ],
  ['trace', 'Trace', 'Show trace result', 'View the trace in its actual output colours.'],
  [
    'overlay',
    'Overlay',
    'Show overlay',
    'Compare the blue trace with the original image. Blue is for preview only.',
  ],
] as const;
