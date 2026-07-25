// GcodeInspectorDialog — ADR-255 stage 3 skeleton (WORKFLOW.md F-M1): parse
// the program text into the render model and show it in the shared 3D scene
// (work coordinates, Z-up, orbit + grid + triad). The timeline, palette
// lenses, DRO, source pane, and Program Health panels land in stages 4-9.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type { MachineKind } from '../../core/scene';
import { createViewer3dScene, type Viewer3dSceneHandle } from '../viewer3d';

export type GcodeInspectorDialogProps = {
  readonly programName: string;
  readonly text: string;
  readonly machineKind: MachineKind;
  /** CNC-only handoff to the existing F-CNC10 2D simulator (flow retained). */
  readonly onOpen2dSimulator?: () => void;
  readonly onClose: () => void;
};

type SceneState = 'loading' | 'ready' | 'no-webgl';

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
  const handleRef = useRef<Viewer3dSceneHandle | null>(null);
  const [state, setState] = useState<SceneState>('loading');
  const [reason, setReason] = useState('');
  const { model } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    setState('loading');
    void createViewer3dScene(canvas)
      .then((outcome) => {
        if (cancelled) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind === 'ok') {
          handleRef.current = outcome.handle;
          outcome.handle.setSegments(model);
          outcome.handle.fitToBounds(model.stats.motionBounds);
          outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
          setState('ready');
        } else {
          setReason(outcome.reason);
          setState('no-webgl');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReason(err instanceof Error ? err.message : String(err));
        setState('no-webgl');
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <div style={bodyStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
      {state === 'no-webgl' ? (
        <p style={messageStyle}>
          3D view unavailable: {reason} The program parsed — stats below are live.
        </p>
      ) : null}
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

const bodyStyle: React.CSSProperties = {
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
