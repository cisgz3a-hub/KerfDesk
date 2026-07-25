// CanvasGcodeView — a G-code PREVIEW in place of the design canvas (ADR-255
// stage 9b). The canvas switch shows the toolpath and its transport, nothing
// else: it answers "what will this run?" at a glance. The toolbar's
// "Inspect G-code (3D)" opens the in-depth screen with readouts, source and
// health.
//
// It only reads: nothing here writes, streams, or advances variable text, and
// it stays available during a job (watching what is running is the point).

import { useMemo } from 'react';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { InspectorView } from './InspectorView';
import { useCurrentGcode, type CurrentGcode } from './use-current-gcode';

export function CanvasGcodeView(props: { readonly active: boolean }): JSX.Element {
  const { state, stale, refresh } = useCurrentGcode(props.active);
  const text = state.kind === 'ready' ? state.text : '';
  const parsed = useMemo(() => (text === '' ? null : buildGcodeRenderModel(text)), [text]);
  const lines = useMemo(() => (text === '' ? [] : text.split(/\r\n|\n|\r/)), [text]);

  return (
    <div style={wrapStyle} aria-label="G-code canvas view">
      <div style={barStyle}>
        <span style={nameStyle}>
          {state.kind === 'ready' ? state.programName : 'Current design'}
        </span>
        {stale ? <span style={staleStyle}>Design changed</span> : null}
        <button
          type="button"
          className="lf-btn"
          style={refreshStyle}
          title="Recompile this project's G-code"
          onClick={refresh}
          disabled={state.kind === 'compiling'}
        >
          {state.kind === 'compiling' ? 'Compiling…' : 'Refresh'}
        </button>
      </div>
      <Body parsed={parsed} lines={lines} state={state} />
    </div>
  );
}

function Body(props: {
  readonly parsed: ReturnType<typeof buildGcodeRenderModel> | null;
  readonly lines: ReadonlyArray<string>;
  readonly state: CurrentGcode;
}): JSX.Element {
  if (props.state.kind === 'compiling') {
    return <p style={messageStyle}>Compiling G-code…</p>;
  }
  if (props.state.kind === 'empty') {
    return <p style={messageStyle}>This design produces no G-code yet. Add artwork to see it.</p>;
  }
  if (props.parsed === null) {
    return <p style={messageStyle}>Switch to G-code to compile this design.</p>;
  }
  if (props.parsed.kind !== 'ok') {
    return <p style={messageStyle}>{props.parsed.reason}</p>;
  }
  return <InspectorView model={props.parsed.model} lines={props.lines} variant="preview" />;
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  zIndex: 2,
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
  fontSize: 'var(--lf-text-sm)',
};

const nameStyle: React.CSSProperties = { fontWeight: 600 };

const staleStyle: React.CSSProperties = {
  color: 'var(--lf-warning)',
  fontSize: 'var(--lf-text-xs)',
};

const refreshStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '1px 8px',
  fontSize: 'var(--lf-text-xs)',
};

const messageStyle: React.CSSProperties = { margin: 16 };
