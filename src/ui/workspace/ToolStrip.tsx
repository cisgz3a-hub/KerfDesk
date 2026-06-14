// ToolStrip — vertical left-edge tool palette (ADR-051, Phase G). Sets the
// drawing tool-mode in the UI store; Select is always available (and Esc
// returns to it, wired in shortcuts.ts). Mounted as a left rail in App,
// mirroring the right-side panels. Toggle state shows via aria-pressed (the
// lf-btn pressed fill); the active name lives on each IconButton.

import { IconButton, type IconName } from '../kit';
import { useUiStore, type ToolMode } from '../state/ui-store';

type Tool = {
  readonly mode: ToolMode;
  readonly icon: IconName;
  readonly label: string;
};

const TOOLS: ReadonlyArray<Tool> = [
  { mode: { kind: 'select' }, icon: 'cursor', label: 'Select / transform (Esc)' },
  { mode: { kind: 'draw', shape: 'rect' }, icon: 'square', label: 'Draw rectangle' },
  { mode: { kind: 'draw', shape: 'ellipse' }, icon: 'circle', label: 'Draw ellipse' },
  { mode: { kind: 'draw', shape: 'polygon' }, icon: 'pentagon', label: 'Draw polygon' },
  { mode: { kind: 'draw', shape: 'polyline' }, icon: 'pen', label: 'Draw polyline (pen)' },
];

export function ToolStrip(): JSX.Element {
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  return (
    <aside aria-label="Drawing tools" className="lf-rail" style={stripStyle}>
      {TOOLS.map((tool) => (
        <IconButton
          key={tool.label}
          icon={tool.icon}
          label={tool.label}
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
  return tool.kind === 'draw' && tool.shape === current.shape;
}

const stripStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--lf-space-4)',
  padding: 'var(--lf-space-4)',
  flexShrink: 0,
};
