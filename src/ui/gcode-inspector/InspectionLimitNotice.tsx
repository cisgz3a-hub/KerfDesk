import type { GcodeInspectorWorkerResult } from './gcode-inspector-worker-protocol';

export function InspectionLimitNotice(props: {
  readonly result: GcodeInspectorWorkerResult;
}): JSX.Element | null {
  if (props.result.parsed.kind !== 'ok') return null;
  const model = props.result.parsed.model;
  const notices: string[] = [];
  if (model.renderLimit !== null) {
    notices.push(
      `Preview shows the first ${model.renderLimit.maximum.toLocaleString()} of ` +
        `${model.renderLimit.observed.toLocaleString()} segments; statistics cover only those shown.`,
    );
  }
  if (props.result.lines.length < props.result.sourceLineCount) {
    notices.push(
      `Source pane shows the first ${props.result.lines.length.toLocaleString()} of ` +
        `${props.result.sourceLineCount.toLocaleString()} lines.`,
    );
  }
  return notices.length === 0 ? null : (
    <div role="status" style={limitStyle}>
      {notices.join(' ')}
    </div>
  );
}

const limitStyle: React.CSSProperties = {
  padding: '6px 12px',
  color: 'var(--lf-warning)',
  background: 'var(--lf-warning-wash)',
  fontSize: 'var(--lf-text-xs)',
};
