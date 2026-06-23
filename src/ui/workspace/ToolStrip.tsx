// ToolStrip — vertical left-edge tool palette (ADR-051, Phase G). Sets the
// drawing tool-mode in the UI store; Select is always available (and Esc
// returns to it, wired in shortcuts.ts). Mounted as a left rail in App,
// mirroring the right-side panels. Toggle state shows via aria-pressed (the
// lf-btn pressed fill); the active name lives on each IconButton.

import { IconButton, type IconName } from '../kit';
import { TOOL_HELP, toolHelpId, type ToolHelpKey } from '../help/help-topics';
import { useUiStore, type ToolMode } from '../state/ui-store';

type Tool = {
  readonly mode: ToolMode;
  readonly helpKey: ToolHelpKey;
  readonly icon: IconName;
};

const TOOLS: ReadonlyArray<Tool> = [
  { mode: { kind: 'select' }, helpKey: 'select', icon: 'cursor' },
  { mode: { kind: 'node' }, helpKey: 'node', icon: 'nodes' },
  { mode: { kind: 'draw', shape: 'rect' }, helpKey: 'rect', icon: 'square' },
  { mode: { kind: 'draw', shape: 'ellipse' }, helpKey: 'ellipse', icon: 'circle' },
  { mode: { kind: 'draw', shape: 'polygon' }, helpKey: 'polygon', icon: 'pentagon' },
  { mode: { kind: 'draw', shape: 'polyline' }, helpKey: 'polyline', icon: 'pen' },
];

export function ToolStrip(): JSX.Element {
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  return (
    <aside aria-label="Drawing tools" className="lf-rail" style={stripStyle}>
      {TOOLS.map((tool) => (
        <IconButton
          key={tool.helpKey}
          icon={tool.icon}
          label={TOOL_HELP[tool.helpKey].label}
          title={TOOL_HELP[tool.helpKey].tooltip}
          helpId={toolHelpId(tool.helpKey)}
          onClick={() => {
            if (tool.mode.kind === 'draw' && isActive(toolMode, tool.mode)) resetToolMode();
            else setToolMode(tool.mode);
          }}
          pressed={isActive(toolMode, tool.mode)}
        />
      ))}
    </aside>
  );
}

function isActive(current: ToolMode, tool: ToolMode): boolean {
  if (current.kind === 'select') return tool.kind === 'select';
  if (current.kind === 'node') return tool.kind === 'node';
  return tool.kind === 'draw' && tool.shape === current.shape;
}

const stripStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--lf-space-4)',
  padding: 'var(--lf-space-4)',
  flexShrink: 0,
};
