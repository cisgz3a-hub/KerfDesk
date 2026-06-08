// TracePreview — visual frame inside ImportImageDialog that shows
// the current preset's output on the picked image. Renders the
// sanitized SVG via dangerouslySetInnerHTML; sanitization happens
// in useTracePreview before the string lands here.
//
// States: idle (no file), decoding, tracing, ready, error. Each gets
// a stable-sized panel so the dialog doesn't reflow when the state
// changes — important so the preset radio buttons don't jump under
// the cursor.

import { useState } from 'react';

import type { TracePreviewState } from './use-trace-preview';

type Props = {
  readonly state: TracePreviewState;
  readonly sourceDataUrl?: string;
};

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  const [isSourceFaded, setIsSourceFaded] = useState(false);
  const hasSource = props.sourceDataUrl !== undefined && props.sourceDataUrl.length > 0;
  return (
    <div style={stackStyle}>
      {hasSource ? (
        <button
          type="button"
          aria-pressed={isSourceFaded}
          onClick={() => setIsSourceFaded((next) => !next)}
          style={fadeButtonStyle}
        >
          Fade Image
        </button>
      ) : null}
      <div style={frameStyle} aria-label="Trace preview">
        {hasSource ? (
          <img
            src={props.sourceDataUrl}
            alt=""
            aria-label="Trace source image"
            style={sourceImageStyle(isSourceFaded)}
          />
        ) : null}
        <Inner state={state} />
      </div>
    </div>
  );
}

function Inner(props: { readonly state: TracePreviewState }): JSX.Element {
  const { state } = props;
  switch (state.kind) {
    case 'idle':
      return <span style={hintStyle}>Pick an image to preview the trace.</span>;
    case 'decoding':
      return <span style={hintStyle}>Decoding image…</span>;
    case 'tracing':
      return <span style={hintStyle}>Tracing…</span>;
    case 'error':
      return <span style={errorStyle}>Preview failed: {state.message}</span>;
    case 'ready':
      return (
        <div
          style={svgWrapStyle}
          // SVG comes from imagetracerjs (trusted local dep) AND is
          // run through sanitizeSvg before reaching here. Two layers
          // of trust — safe enough for dangerouslySetInnerHTML.
          dangerouslySetInnerHTML={{ __html: state.svg }}
          aria-label={`Trace preview (${state.width}×${state.height} px)`}
        />
      );
  }
}

const SOURCE_NORMAL_OPACITY = 1;
const SOURCE_FADED_OPACITY = 0.2;

const stackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const fadeButtonStyle: React.CSSProperties = {
  justifySelf: 'start',
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
};

const frameStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 240,
  background: '#fafafa',
  border: '1px solid #ddd',
  borderRadius: 4,
  overflow: 'hidden',
};

function sourceImageStyle(isFaded: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    opacity: isFaded ? SOURCE_FADED_OPACITY : SOURCE_NORMAL_OPACITY,
    pointerEvents: 'none',
  };
}

const hintStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  fontSize: 12,
  color: '#888',
  fontStyle: 'italic',
};

const errorStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  fontSize: 12,
  color: '#b00020',
  padding: 8,
  textAlign: 'center',
};

const svgWrapStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // The SVG itself is sized to its viewBox; scale it to fit the
  // frame via the wrapper. Letterboxing is fine — the preview is
  // about shape fidelity, not absolute mm size.
  // The `& > svg` selector isn't possible inline; we apply the
  // contain style on the wrapper and the SVG inherits via CSS.
};
