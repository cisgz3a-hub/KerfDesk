// GcodeInspectorDialog — ADR-255 stage 3 skeleton (WORKFLOW.md F-M1): parse
// the program text into the render model and show it in the shared 3D scene
// (work coordinates, Z-up, orbit + grid + triad). The timeline, palette
// lenses, DRO, source pane, and Program Health panels land in stages 4-9.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type { MachineKind } from '../../core/scene';
import { resolveViewer3dTheme } from '../viewer3d';
import { InspectorSidebar } from './InspectorSidebar';
import { InspectorTimeline } from './InspectorTimeline';
import { playheadAt } from './playhead';
import { useInspectorPlayback } from './use-inspector-playback';
import { useViewer3dScene } from './use-viewer3d-scene';

export type GcodeInspectorDialogProps = {
  readonly programName: string;
  readonly text: string;
  readonly machineKind: MachineKind;
  /** CNC-only handoff to the existing F-CNC10 2D simulator (flow retained). */
  readonly onOpen2dSimulator?: () => void;
  readonly onClose: () => void;
};

export function GcodeInspectorDialog(props: GcodeInspectorDialogProps): JSX.Element {
  const result = useMemo(() => buildGcodeRenderModel(props.text), [props.text]);
  return (
    <div
      role="dialog"
      aria-label={`G-code Inspector: ${props.programName}`}
      style={overlayStyle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <div style={panelStyle}>
        <header style={headerStyle}>
          <strong>{props.programName}</strong>
          <button type="button" className="lf-btn" onClick={props.onClose}>
            Close
          </button>
        </header>
        {result.kind === 'ok' ? (
          <InspectorBody model={result.model} />
        ) : (
          <p style={messageStyle}>{result.reason}</p>
        )}
        <footer style={footerStyle}>
          {result.kind === 'ok' ? <StatsStrip model={result.model} /> : <span />}
          {props.machineKind === 'cnc' && props.onOpen2dSimulator !== undefined ? (
            <button type="button" className="lf-btn" onClick={props.onOpen2dSimulator}>
              Open in 2D simulator
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function InspectorBody(props: { readonly model: GcodeRenderModel }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [travelVisible, setTravelVisible] = useState(true);
  const theme = useMemo(() => resolveViewer3dTheme(canvasRef.current), []);
  const { model } = props;
  const { handleRef, state, reason } = useViewer3dScene(canvasRef, model);
  const playback = useInspectorPlayback(model.totalRouteMm);
  const playhead = useMemo(() => playheadAt(model, playback.routeMm), [model, playback.routeMm]);
  // Fully-drawn playhead = show everything, so the scene never hides the tail
  // segment to floating-point rounding.
  const atEnd = playback.routeMm >= model.totalRouteMm;

  useEffect(() => {
    handleRef.current?.setPlayhead(atEnd ? null : playhead);
  }, [handleRef, playhead, atEnd, state]);

  return (
    <div style={bodyRowStyle}>
      <div style={viewColumnStyle}>
        <div style={viewportStyle}>
          <canvas ref={canvasRef} style={canvasStyle} />
          {state === 'no-webgl' ? (
            <p style={messageStyle}>
              3D view unavailable: {reason} The program parsed — readouts are live.
            </p>
          ) : null}
        </div>
        <InspectorTimeline playback={playback} totalRouteMm={model.totalRouteMm} />
      </div>
      <InspectorSidebar
        model={model}
        theme={theme}
        playhead={playhead}
        travelVisible={travelVisible}
        onTravelVisibleChange={(visible) => {
          setTravelVisible(visible);
          handleRef.current?.setTravelVisible(visible);
        }}
      />
    </div>
  );
}

function StatsStrip(props: { readonly model: GcodeRenderModel }): JSX.Element {
  const { stats, segmentCount, events, unsupportedWords, skippedMotions } = props.model;
  const bounds = stats.motionBounds;
  const size =
    bounds === null
      ? '—'
      : `${mm(bounds.maxX - bounds.minX)} × ${mm(bounds.maxY - bounds.minY)} × ${mm(
          bounds.maxZ - bounds.minZ,
        )} mm`;
  const findings = unsupportedWords.length + skippedMotions.length;
  return (
    <span style={statsStyle}>
      {segmentCount} segments · {size} · cut {mm(stats.cutMm)} mm · travel {mm(stats.travelMm)} mm ·{' '}
      {events.length} events{findings > 0 ? ` · ${findings} findings` : ''}
    </span>
  );
}

function mm(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--lf-backdrop)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  width: 'min(96vw, 1100px)',
  height: 'min(92vh, 760px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 8,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
};

const bodyRowStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const viewColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
};

const viewportStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
};

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderTop: '1px solid var(--lf-border)',
};

const statsStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.85,
};

const messageStyle: React.CSSProperties = {
  margin: 12,
};
