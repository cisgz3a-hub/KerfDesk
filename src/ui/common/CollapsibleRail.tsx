import { Icon, IconButton } from '../kit';

export const COLLAPSED_RAIL_WIDTH_PX = 48;

export function RailPanelHeading(props: {
  readonly title: string;
  readonly onCollapse: () => void;
  readonly collapseDisabled?: boolean;
  readonly collapseDisabledReason?: string;
}): JSX.Element {
  const label = `Collapse ${props.title} panel`;
  return (
    <div style={headingRowStyle}>
      <h2 className="lf-heading" style={headingStyle}>
        {props.title}
      </h2>
      <IconButton
        icon="chevron-right"
        size="sm"
        label={label}
        title={props.collapseDisabledReason ?? label}
        {...(props.collapseDisabled === undefined ? {} : { disabled: props.collapseDisabled })}
        onClick={props.onCollapse}
      />
    </div>
  );
}

export function CollapsedRail(props: {
  readonly title: string;
  readonly ariaLabel: string;
  readonly onExpand: () => void;
}): JSX.Element {
  const label = `Expand ${props.title} panel`;
  return (
    <aside aria-label={props.ariaLabel} className="lf-rail" style={collapsedRailStyle}>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        style={expandButtonStyle}
        aria-label={label}
        title={label}
        onClick={props.onExpand}
      >
        <Icon name="chevron-left" size={14} />
        <span style={verticalLabelStyle}>{props.title}</span>
      </button>
    </aside>
  );
}

const headingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 8,
};
// flex: 1 keeps the title claiming the free space so the tutorial button and
// the collapse chevron stay pinned together at the rail's trailing edge.
const headingStyle: React.CSSProperties = {
  margin: 0,
  flex: 1,
  fontSize: 'var(--lf-text-lg)',
  fontWeight: 600,
};
const collapsedRailStyle: React.CSSProperties = {
  width: COLLAPSED_RAIL_WIDTH_PX,
  flexShrink: 0,
  padding: 4,
  boxSizing: 'border-box',
  overflow: 'hidden',
};
const expandButtonStyle: React.CSSProperties = {
  width: 32,
  height: '100%',
  padding: '8px 0',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: 8,
};
const verticalLabelStyle: React.CSSProperties = {
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
  whiteSpace: 'nowrap',
  fontSize: 12,
};
