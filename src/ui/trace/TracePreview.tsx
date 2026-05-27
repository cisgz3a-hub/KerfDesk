// TracePreview — visual frame inside ImportImageDialog that shows
// the current preset's output on the picked image. Renders the
// sanitized SVG via dangerouslySetInnerHTML; sanitization happens
// in useTracePreview before the string lands here.
//
// States: idle (no file), decoding, tracing, ready, error. Each gets
// a stable-sized panel so the dialog doesn't reflow when the state
// changes — important so the preset radio buttons don't jump under
// the cursor.

import type { TracePreviewState } from './use-trace-preview';

type Props = {
  readonly state: TracePreviewState;
};

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  return (
    <div style={frameStyle} aria-label="Trace preview">
      <Inner state={state} />
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

const frameStyle: React.CSSProperties = {
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

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  fontStyle: 'italic',
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#b00020',
  padding: 8,
  textAlign: 'center',
};

const svgWrapStyle: React.CSSProperties = {
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
