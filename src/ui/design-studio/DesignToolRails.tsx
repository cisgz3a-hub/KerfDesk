// DesignToolRails — the Design Studio's left palette (ADR-271, DS-2).
//
// LightBurn's layout, deliberately: a Creation rail for making geometry above a
// Modifiers rail for combining and altering it, separated by a labelled rule so
// the two halves read as two jobs rather than one long list of buttons.
//
// A planned-but-unbuilt tool is still shown and still selectable — it is not
// disabled and nothing is refused (rule 7). Selecting one arms it and the
// status bar says the tool is not finished yet, which is information, not a
// gate. Showing the finished shape of the tool set from day one also stops the
// rail from visibly reshuffling as stages land.

import { DesignToolIcon } from './design-icons';
import { designToolsForRail, type DesignToolDefinition, type DesignToolRail } from './design-tool';
import { useDesignStudioStore } from './design-studio-store';

export function DesignToolRails(): JSX.Element {
  return (
    <aside style={railStyle} aria-label="Design tools">
      <ToolGroup rail="create" heading="Create" />
      <div style={dividerStyle} role="presentation" />
      <ToolGroup rail="modify" heading="Modify" />
    </aside>
  );
}

function ToolGroup(props: {
  readonly rail: DesignToolRail;
  readonly heading: string;
}): JSX.Element {
  return (
    <div style={groupStyle} role="group" aria-label={`${props.heading} tools`}>
      <span style={headingStyle}>{props.heading}</span>
      {designToolsForRail(props.rail)
        // Only tools that actually do something are rendered. Showing the finished
        // shape of the tool set read as a rail of dead buttons, which is worse than
        // a short rail that works.
        .filter((tool) => tool.planned !== true)
        .map((tool) => (
          <ToolButton key={tool.kind} tool={tool} />
        ))}
    </div>
  );
}

function ToolButton(props: { readonly tool: DesignToolDefinition }): JSX.Element {
  const activeTool = useDesignStudioStore((state) => state.session?.tool ?? 'select');
  const setTool = useDesignStudioStore((state) => state.setTool);
  const isActive = activeTool === props.tool.kind;
  const planned = props.tool.planned === true ? ' — not built yet' : '';
  return (
    <button
      type="button"
      onClick={() => setTool(props.tool.kind)}
      aria-pressed={isActive}
      aria-label={props.tool.label}
      title={`${props.tool.label} (${props.tool.shortcut.toUpperCase()})${planned}\n${props.tool.hint}`}
      style={{
        ...buttonStyle,
        ...(isActive ? activeStyle : null),
        ...(props.tool.planned === true ? plannedStyle : null),
      }}
    >
      <DesignToolIcon kind={props.tool.kind} />
    </button>
  );
}

const railStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  overflowY: 'auto',
  borderRight: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  flexShrink: 0,
};

const groupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
};

const headingStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--lf-text-muted)',
  paddingBottom: 2,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--lf-border)',
  margin: '2px 4px',
};

const buttonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  padding: 0,
};

const activeStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};

// Visually quieter, never disabled — the tool still arms and still explains
// itself; only its finished behaviour is missing.
const plannedStyle: React.CSSProperties = { opacity: 0.45 };
