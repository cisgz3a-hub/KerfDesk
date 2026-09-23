import { useId, useState } from 'react';
import { openMachineSetup, type CncStartupSetupField } from '../laser/device-setup';

/** Read-only setup value that explains its ownership before routing to its editor. */
export function SetupOwnedValueRow(props: {
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly setupField: CncStartupSetupField;
  readonly compact?: boolean;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const explanationId = useId();
  const handleEdit = (): void => {
    setIsExpanded(false);
    openMachineSetup({ kind: 'cnc', field: props.setupField });
  };
  return (
    <div style={containerStyle}>
      <button
        type="button"
        className="lf-setup-reference-button"
        aria-expanded={isExpanded}
        aria-controls={explanationId}
        aria-label={`${props.label}: ${props.value}. Managed in Machine Setup.`}
        title="Read-only here. Select to learn more or edit it in Machine Setup."
        style={props.compact ? compactReferenceButtonStyle : referenceButtonStyle}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span style={labelStyle}>{props.label}</span>
        <span className="lf-setup-reference-value" style={valueStyle}>
          {props.value}
        </span>
        {props.compact ? null : (
          <span aria-hidden="true" style={infoStyle}>
            Info
          </span>
        )}
      </button>
      {isExpanded ? (
        <div id={explanationId} role="note" style={explanationStyle}>
          <p style={explanationTextStyle}>{props.description}</p>
          <div style={actionsStyle}>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              title="Close this setup-value explanation."
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleEdit}
              title={`Open Machine Setup at ${props.label}.`}
            >
              Edit in Machine Setup
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle: React.CSSProperties = { minWidth: 0 };

const referenceButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 30,
  display: 'grid',
  gridTemplateColumns: 'var(--lf-setup-reference-columns, 100px minmax(0, 1fr) auto)',
  alignItems: 'center',
  gap: 8,
  padding: '4px 7px',
  textAlign: 'left',
  color: 'var(--lf-text-muted)',
  background: 'var(--lf-bg-0)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  cursor: 'pointer',
};

const compactReferenceButtonStyle: React.CSSProperties = {
  ...referenceButtonStyle,
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: '2px 6px',
  padding: '3px 5px',
};

const labelStyle: React.CSSProperties = { fontSize: 12 };

const valueStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'var(--lf-setup-reference-white-space, nowrap)' as React.CSSProperties['whiteSpace'],
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--lf-text-muted)',
};

const infoStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-faint)',
};

const explanationStyle: React.CSSProperties = {
  margin: '4px 0 6px 0',
  padding: 8,
  borderLeft: '2px solid var(--lf-border-strong)',
  background: 'var(--lf-bg-1)',
};

const explanationTextStyle: React.CSSProperties = {
  margin: '0 0 7px 0',
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--lf-text-muted)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 6,
};
