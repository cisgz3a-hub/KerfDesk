import type { GcodeInspectorWorkerResult } from './gcode-inspector-worker-protocol';

export function InspectionPressureNotice(props: {
  readonly result: GcodeInspectorWorkerResult;
}): JSX.Element | null {
  if (props.result.parsed.kind !== 'ok') return null;
  const model = props.result.parsed.model;
  const notices: string[] = [];
  if (model.renderPressure !== null) {
    notices.push(
      `Large preview: all ${model.renderPressure.observed.toLocaleString()} segments are shown; ` +
        `drawing more than ${model.renderPressure.threshold.toLocaleString()} segments can use substantial memory and may respond slowly.`,
    );
  }
  return notices.length === 0 ? null : (
    <div role="status" style={pressureStyle}>
      {notices.join(' ')}
    </div>
  );
}

const pressureStyle: React.CSSProperties = {
  padding: '6px 12px',
  color: 'var(--lf-warning)',
  background: 'var(--lf-warning-wash)',
  fontSize: 'var(--lf-text-xs)',
};
