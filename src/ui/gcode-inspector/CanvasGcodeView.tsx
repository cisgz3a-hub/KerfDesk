// CanvasGcodeView — a G-code PREVIEW in place of the design canvas (ADR-255
// stage 9b). The canvas switch shows the toolpath and its transport, nothing
// else: it answers "what will this run?" at a glance. The toolbar's
// "Inspect G-code (3D)" opens the in-depth screen with readouts, source and
// health.
//
// It only reads: nothing here writes, streams, or advances variable text, and
// it stays available during a job (watching what is running is the point).

import { useMemo } from 'react';
import { InspectorView } from './InspectorView';
import { useCurrentGcode, type CurrentGcode } from './use-current-gcode';
import { useGcodeInspection, type InspectionState } from './use-gcode-inspection';
import { InspectionPressureNotice } from './InspectionPressureNotice';
import { MainThreadInspectionNotice } from './MainThreadInspectionNotice';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';

export function CanvasGcodeView(props: { readonly active: boolean }): JSX.Element {
  const { state, stale, refresh } = useCurrentGcode(props.active);
  const text = state.kind === 'ready' ? state.text : '';
  const source = useMemo(() => (text === '' ? null : { kind: 'text' as const, text }), [text]);
  const inspection = useGcodeInspection(source);

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
      <Body inspection={inspection} state={state} />
    </div>
  );
}

function Body(props: {
  readonly inspection: InspectionState;
  readonly state: CurrentGcode;
}): JSX.Element {
  const stateMessage = currentGcodeMessage(props.state);
  if (stateMessage !== null) return <p style={messageStyle}>{stateMessage}</p>;
  if (props.inspection.kind === 'idle') {
    return <p style={messageStyle}>Switch to G-code to compile this design.</p>;
  }
  if (props.inspection.kind === 'loading') {
    if (props.inspection.phase === 'fallback') return <MainThreadInspectionNotice />;
    const queued =
      props.inspection.phase === 'queued' && props.inspection.queuePosition > 0
        ? ` (${props.inspection.queuePosition} ahead)`
        : '';
    return <p style={messageStyle}>Preparing preview in worker{queued}…</p>;
  }
  if (props.inspection.kind === 'error') {
    return <p style={messageStyle}>{props.inspection.reason}</p>;
  }
  if (!hasGcodeInspectorAnalysis(props.inspection.result)) {
    return <p style={messageStyle}>{props.inspection.result.parsed.reason}</p>;
  }
  return (
    <>
      {props.inspection.mainThreadFallback ? <MainThreadInspectionNotice /> : null}
      <InspectionPressureNotice result={props.inspection.result} />
      <InspectorView
        model={props.inspection.result.parsed.model}
        analysis={props.inspection.result.analysis}
        variant="preview"
      />
    </>
  );
}

function currentGcodeMessage(state: CurrentGcode): string | null {
  if (state.kind === 'compiling') return compilationProgressMessage(state.progress);
  if (state.kind === 'empty') {
    return 'This design produces no G-code yet. Add artwork to see it.';
  }
  if (state.kind === 'stale' || state.kind === 'unavailable') return state.reason;
  return null;
}

function compilationProgressMessage(
  progress: Extract<CurrentGcode, { readonly kind: 'compiling' }>['progress'],
): string {
  if (progress === undefined) return 'Waiting for the background G-code compiler…';
  const phase =
    progress.phase === 'normalizing'
      ? 'Normalizing operations'
      : progress.phase === 'planning'
        ? 'Planning toolpaths'
        : progress.phase === 'merging'
          ? 'Merging ordered regions'
          : 'Finalizing G-code';
  if (progress.total === 0) return `${phase}…`;
  return `${phase} — ${progress.completed} of ${progress.total} regions complete, ${progress.active} active, ${progress.queued} queued.`;
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
