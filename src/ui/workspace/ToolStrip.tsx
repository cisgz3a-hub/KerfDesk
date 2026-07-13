// ToolStrip — vertical left-edge tool palette (ADR-051, Phase G). Sets the
// drawing tool-mode in the UI store; Select is always available (and Esc
// returns to it, wired in shortcuts.ts). Mounted as a left rail in App,
// mirroring the right-side panels. Toggle state shows via aria-pressed (the
// lf-btn pressed fill); the active name lives on each IconButton.

import { IconButton, type IconName } from '../kit';
import { TOOL_HELP, toolHelpId, type ToolHelpKey } from '../help/help-topics';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { useStore } from '../state/store';

type Tool = {
  readonly mode: ToolMode;
  readonly helpKey: ToolHelpKey;
  readonly icon: IconName;
};

const TOOLS: ReadonlyArray<Tool> = [
  { mode: { kind: 'select' }, helpKey: 'select', icon: 'cursor' },
  { mode: { kind: 'node' }, helpKey: 'node', icon: 'nodes' },
  { mode: { kind: 'measure' }, helpKey: 'measure', icon: 'ruler' },
  { mode: { kind: 'draw', shape: 'rect' }, helpKey: 'rect', icon: 'square' },
  { mode: { kind: 'draw', shape: 'ellipse' }, helpKey: 'ellipse', icon: 'circle' },
  { mode: { kind: 'draw', shape: 'polygon' }, helpKey: 'polygon', icon: 'pentagon' },
  { mode: { kind: 'draw', shape: 'star' }, helpKey: 'star', icon: 'star' },
  { mode: { kind: 'draw', shape: 'polyline' }, helpKey: 'polyline', icon: 'pen' },
  { mode: { kind: 'position-laser' }, helpKey: 'position-laser', icon: 'crosshair' },
];

export function ToolStrip(): JSX.Element {
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  const setLibraryDialogOpen = useUiStore((s) => s.setLibraryDialogOpen);
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
      {toolMode.kind === 'node' ? <NodeCommandBar /> : null}
      <button
        type="button"
        aria-label="Open design library"
        title="Insert ready-made line art from the bundled design library (ADR-105)."
        onClick={() => setLibraryDialogOpen(true)}
        style={libraryButtonStyle}
      >
        Lib
      </button>
    </aside>
  );
}

function NodeCommandBar(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedPathNode);
  const selectedNodes = useStore((state) => state.selectedPathNodes);
  const smooth = useStore((state) => state.smoothSelectedCurveNode);
  const corner = useStore((state) => state.cornerSelectedCurveNode);
  const convert = useStore((state) => state.convertSelectedCurveSegment);
  const setStart = useStore((state) => state.setSelectedCurveStart);
  const breakCurve = useStore((state) => state.breakSelectedCurve);
  const join = useStore((state) => state.joinSelectedCurveNodes);
  if (selected?.geometry !== 'curve' || selected.handle !== undefined) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === selected.objectId);
  const path =
    object !== undefined && 'paths' in object ? object.paths[selected.pathIndex] : undefined;
  const curve = path?.curves?.[selected.polylineIndex];
  if (curve === undefined) return null;
  const outgoing = curve.segments[selected.pointIndex];
  const canJoin =
    selectedNodes.filter((ref) => ref.geometry === 'curve' && ref.handle === undefined).length ===
    2;
  return (
    <div role="toolbar" aria-label="Curve node actions" style={nodeActionsStyle}>
      <NodeAction
        label="Smooth"
        title="Align the incoming and outgoing curve handles"
        onClick={smooth}
      />
      <NodeAction label="Corner" title="Align handles to the adjoining chords" onClick={corner} />
      <NodeAction
        label="Curve"
        title="Convert the outgoing segment to a cubic curve"
        disabled={outgoing === undefined || outgoing.kind === 'cubic'}
        onClick={() => convert('cubic')}
      />
      <NodeAction
        label="Line"
        title="Convert the outgoing segment to a straight line"
        disabled={outgoing === undefined || outgoing.kind === 'line'}
        onClick={() => convert('line')}
      />
      <NodeAction
        label="Start"
        title="Use this node as the closed path start point"
        disabled={!curve.closed || selected.pointIndex === 0}
        onClick={setStart}
      />
      <NodeAction
        label="Break"
        title="Break the closed path open at this node"
        disabled={!curve.closed}
        onClick={breakCurve}
      />
      <NodeAction
        label="Join"
        title="Join two selected open curve endpoints"
        disabled={!canJoin}
        onClick={join}
      />
    </div>
  );
}

function NodeAction(props: {
  readonly label: string;
  readonly title: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={nodeActionStyle}
    >
      {props.label}
    </button>
  );
}

function isActive(current: ToolMode, tool: ToolMode): boolean {
  if (current.kind === 'select') return tool.kind === 'select';
  if (current.kind === 'node') return tool.kind === 'node';
  if (current.kind === 'measure') return tool.kind === 'measure';
  if (current.kind === 'position-laser') return tool.kind === 'position-laser';
  if (current.kind === 'cnc-tabs') return false;
  return tool.kind === 'draw' && tool.shape === current.shape;
}

const libraryButtonStyle: React.CSSProperties = {
  marginTop: 'var(--lf-space-4)',
  fontSize: 11,
  padding: '6px 4px',
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--lf-space-4)',
  padding: 'var(--lf-space-4)',
  flexShrink: 0,
};

const nodeActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingTop: 4,
  borderTop: '1px solid var(--lf-border)',
};

const nodeActionStyle: React.CSSProperties = {
  minWidth: 48,
  padding: '3px 4px',
  fontSize: 10,
};
