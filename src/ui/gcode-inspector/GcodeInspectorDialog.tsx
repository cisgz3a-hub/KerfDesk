// GcodeInspectorDialog — the modal frame around InspectorView (ADR-255,
// WORKFLOW.md F-M1). Used for opened FILES; the same view also renders
// inline as a main-canvas mode (CanvasGcodeView).

import { useMemo } from 'react';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type { MachineKind } from '../../core/scene';
import { Dialog } from '../kit/Dialog';
import { InspectorView } from './InspectorView';

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
  const lines = useMemo(() => props.text.split(/\r\n|\n|\r/), [props.text]);
  return (
    <Dialog
      ariaLabel={`G-code Inspector: ${props.programName}`}
      size="xl"
      panelClassName="lf-dialog--gcode-inspector"
      onClose={props.onClose}
    >
      <header style={headerStyle}>
        <strong>{props.programName}</strong>
        <button
          type="button"
          className="lf-btn"
          title="Close the Inspector (Esc)"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>
      {result.kind === 'ok' ? (
        <InspectorView model={result.model} lines={lines} />
      ) : (
        <p style={messageStyle}>{result.reason}</p>
      )}
      <footer style={footerStyle}>
        {result.kind === 'ok' ? <StatsStrip model={result.model} /> : <span />}
        {props.machineKind === 'cnc' && props.onOpen2dSimulator !== undefined ? (
          <button
            type="button"
            className="lf-btn"
            title="Open this program in the 2D simulator (F-CNC10)"
            onClick={props.onOpen2dSimulator}
          >
            Open in 2D simulator
          </button>
        ) : null}
      </footer>
    </Dialog>
  );
}

export function StatsStrip(props: { readonly model: GcodeRenderModel }): JSX.Element {
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

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
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
