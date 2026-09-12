import { MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM } from './trace-preview-zoom';

export type TracePreviewView = 'original' | 'trace' | 'overlay';

type Props = {
  readonly view: TracePreviewView;
  readonly hasSource: boolean;
  readonly hasTrace: boolean;
  readonly zoom: number;
  readonly isSourceFaded: boolean;
  readonly shouldShowPoints: boolean;
  readonly hasBoundary: boolean;
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
        <ZoomControls zoom={props.zoom} onChange={props.onZoomChange} />
      </div>
      <div className="lf-trace-preview__options" role="group" aria-label="Preview overlays">
        {props.hasSource ? (
          <button
            type="button"
            aria-pressed={props.isSourceFaded}
            disabled={props.view !== 'overlay'}
            onClick={props.onToggleFade}
            className="lf-btn"
            title="Fade the source image in Overlay view to inspect the traced vectors."
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
            title="Show or hide traced vector points in the preview."
          >
            Show Points
          </button>
        ) : null}
        {props.hasBoundary ? (
          <button
            type="button"
            onClick={props.onBoundaryClear}
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
      {VIEW_CHOICES.map(([view, label, accessibleLabel]) => (
        <button
          key={view}
          type="button"
          className="lf-btn"
          aria-label={accessibleLabel}
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
  readonly onChange: (zoom: number) => void;
}): JSX.Element {
  return (
    <div className="lf-trace-preview__zoom" role="group" aria-label="Preview zoom">
      <button
        type="button"
        className="lf-btn"
        aria-label="Zoom out"
        disabled={props.zoom <= MIN_PREVIEW_ZOOM}
        onClick={() => props.onChange(props.zoom / 2)}
      >
        −
      </button>
      <span aria-label="Preview magnification" title="Magnification relative to Fit">
        {props.zoom}×
      </span>
      <button
        type="button"
        className="lf-btn"
        aria-label="Zoom in"
        disabled={props.zoom >= MAX_PREVIEW_ZOOM}
        onClick={() => props.onChange(props.zoom * 2)}
      >
        +
      </button>
      <button
        type="button"
        className="lf-btn"
        title="Fit the entire image in the preview"
        onClick={() => props.onChange(MIN_PREVIEW_ZOOM)}
      >
        Fit
      </button>
    </div>
  );
}

const VIEW_CHOICES = [
  ['original', 'Original', 'Show original image'],
  ['trace', 'Trace', 'Show trace result'],
  ['overlay', 'Overlay', 'Show overlay'],
] as const;
