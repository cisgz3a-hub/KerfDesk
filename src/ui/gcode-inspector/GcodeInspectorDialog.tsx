// GcodeInspectorDialog — the modal frame around InspectorView (ADR-255,
// WORKFLOW.md F-M1). Used for opened FILES; the same view also renders
// inline as a main-canvas mode (CanvasGcodeView).

import type { GcodeRenderModel } from '../../core/gcode-view';
import type { MachineKind } from '../../core/scene';
import { Dialog } from '../kit/Dialog';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { InspectionPressureNotice } from './InspectionPressureNotice';
import { InspectorView } from './InspectorView';
import { MainThreadInspectionNotice } from './MainThreadInspectionNotice';
import { useGcodeInspection } from './use-gcode-inspection';

export type GcodeInspectorDialogProps = {
  readonly programName: string;
  readonly source: GcodeInspectionSource;
  readonly machineKind: MachineKind;
  /** CNC-only handoff to the existing F-CNC10 2D simulator (flow retained). */
  readonly onOpen2dSimulator?: () => void;
  readonly onClose: () => void;
};

export function GcodeInspectorDialog(props: GcodeInspectorDialogProps): JSX.Element {
  const state = useGcodeInspection(props.source);
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
      {state.kind === 'loading' ? (
        <p style={messageStyle}>{inspectionProgressLabel(state.phase, state.queuePosition)}</p>
      ) : null}
      {state.kind === 'ready' ? (
        state.result.parsed.kind === 'ok' ? (
          <>
            {state.mainThreadFallback ? <MainThreadInspectionNotice /> : null}
            <InspectionPressureNotice result={state.result} />
            <InspectorView model={state.result.parsed.model} lines={state.result.lines} />
          </>
        ) : (
          <p style={messageStyle}>{state.result.parsed.reason}</p>
        )
      ) : null}
      {state.kind === 'error' ? <p style={messageStyle}>{state.reason}</p> : null}
      <footer style={footerStyle}>
        {state.kind === 'ready' && state.result.parsed.kind === 'ok' ? (
          <StatsStrip model={state.result.parsed.model} />
        ) : (
          <span />
        )}
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

function inspectionProgressLabel(
  phase: 'queued' | 'reading' | 'parsing' | 'fallback',
  queuePosition: number,
): string {
  if (phase === 'fallback') {
    return 'Background preview worker unavailable — parsing on the main UI thread may make the app unresponsive.';
  }
  if (phase === 'queued' && queuePosition > 0) {
    return `Preview queued — ${queuePosition} request(s) ahead. Close to cancel.`;
  }
  if (phase === 'reading') return 'Reading G-code in worker… Close to cancel.';
  if (phase === 'parsing') return 'Building preview in worker… Close to cancel.';
  return 'Preparing preview in worker… Close to cancel.';
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
      {segmentCount} shown segments · {size} · cut {mm(stats.cutMm)} mm · travel{' '}
      {mm(stats.travelMm)} mm · {events.length} events
      {findings > 0 ? ` · ${findings} findings` : ''}
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
