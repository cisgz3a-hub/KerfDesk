import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
// ToolStrip — vertical left-edge tool palette (ADR-051, Phase G). Sets the
// drawing tool-mode in the UI store; Select is always available (and Esc
// returns to it, wired in shortcuts.ts). Mounted as a left rail in App,
// mirroring the right-side panels. Toggle state shows via aria-pressed (the
// lf-btn pressed fill); the active name lives on each IconButton.

import { Fragment, useRef } from 'react';
import { Icon, IconButton, type IconName } from '../kit';
import { TOOL_HELP, toolHelpId, type ToolHelpKey } from '../help/help-topics';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { useStore } from '../state/store';
import { curveCommandNode } from '../state/path-node-command-geometry';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import type { PathSegmentRef } from '../state/path-segment-actions';
import { openArtworkCreation } from '../layers/artwork-creation-store';
import { BooleanCompoundControls } from './BooleanCompoundControls';
import { NodeCoordinateControls } from './NodeCoordinateControls';
import { activateTracePartTool } from './trace-part-tool';
import './tool-strip.css';

type Tool = {
  readonly mode: ToolMode;
  readonly helpKey: ToolHelpKey;
  readonly icon: IconName;
};

const TOOLS: ReadonlyArray<Tool> = [
  { mode: { kind: 'select' }, helpKey: 'select', icon: 'cursor' },
  { mode: { kind: 'trace-parts' }, helpKey: 'trace-parts', icon: 'trace-parts' },
  { mode: { kind: 'node' }, helpKey: 'node', icon: 'nodes' },
  { mode: { kind: 'measure' }, helpKey: 'measure', icon: 'ruler' },
  { mode: { kind: 'text' }, helpKey: 'text', icon: 'text' },
  { mode: { kind: 'draw', shape: 'rect' }, helpKey: 'rect', icon: 'square' },
  { mode: { kind: 'draw', shape: 'ellipse' }, helpKey: 'ellipse', icon: 'circle' },
  { mode: { kind: 'draw', shape: 'polygon' }, helpKey: 'polygon', icon: 'pentagon' },
  { mode: { kind: 'draw', shape: 'star' }, helpKey: 'star', icon: 'star' },
  { mode: { kind: 'draw', shape: 'polyline' }, helpKey: 'polyline', icon: 'pen' },
  { mode: { kind: 'position-laser' }, helpKey: 'position-laser', icon: 'crosshair' },
];

export function ToolStrip(): JSX.Element {
  const nodeToolButtonRef = useRef<HTMLButtonElement>(null);
  const toolMode = useUiStore((s) => s.toolMode);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const resetToolMode = useUiStore((s) => s.resetToolMode);
  const setLibraryDialogOpen = useUiStore((s) => s.setLibraryDialogOpen);
  return (
    <aside aria-label="Drawing tools" className="lf-rail lf-toolstrip">
      <BooleanCompoundControls />
      <span className="lf-toolstrip__caption" aria-hidden="true">
        Create
      </span>
      <IconButton
        icon="plus"
        label="Create artwork"
        title="Create a constrained sketch, parametric part or editable relief"
        onClick={() => openArtworkCreation('choose')}
      />
      {toolMode.kind === 'node' ? <NodeCoordinateControls /> : null}
      {TOOLS.map((tool) => (
        <Fragment key={tool.helpKey}>
          {tool.helpKey === 'select' || tool.helpKey === 'text' ? (
            <span className="lf-toolstrip__caption" aria-hidden="true">
              {tool.helpKey === 'select' ? 'Edit' : 'Draw'}
            </span>
          ) : null}
          {tool.helpKey === 'position-laser' ? (
            <span className="lf-toolstrip__divider" aria-hidden="true" />
          ) : null}
          <IconButton
            icon={tool.icon}
            label={TOOL_HELP[tool.helpKey].label}
            title={TOOL_HELP[tool.helpKey].tooltip}
            helpId={toolHelpId(tool.helpKey)}
            {...(tool.helpKey === 'node' ? { buttonRef: nodeToolButtonRef } : {})}
            onClick={() => {
              if (tool.mode.kind === 'trace-parts') activateTracePartTool();
              else if (
                (tool.mode.kind === 'draw' || tool.mode.kind === 'node') &&
                isActive(toolMode, tool.mode)
              )
                resetToolMode();
              else setToolMode(tool.mode);
            }}
            pressed={isActive(toolMode, tool.mode)}
          />
          {tool.helpKey === 'measure' && toolMode.kind === 'node' ? (
            <NodeCommandBar nodeToolButtonRef={nodeToolButtonRef} />
          ) : null}
        </Fragment>
      ))}
      <span className="lf-toolstrip__divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="Open design library"
        title="Insert ready-made line art from the bundled design library (ADR-105)."
        onClick={() => setLibraryDialogOpen(true)}
        className="lf-btn lf-iconbtn lf-toolstrip__launcher"
      >
        <Icon name="library" size={20} />
      </button>
    </aside>
  );
}

function NodeCommandBar(props: {
  readonly nodeToolButtonRef: React.RefObject<HTMLButtonElement | null>;
}): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedPathNode);
  const selectedNodes = useStore((state) => state.selectedPathNodes);
  const smooth = useStore((state) => state.smoothSelectedCurveNode);
  const corner = useStore((state) => state.cornerSelectedCurveNode);
  const convert = useStore((state) => state.convertSelectedCurveSegment);
  const setStart = useStore((state) => state.setSelectedCurveStart);
  const join = useStore((state) => state.joinSelectedCurveNodes);
  if (selected === null || selected.handle !== undefined) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === selected.objectId);
  if (object !== undefined && isBooleanCompoundObject(object)) return null;
  const path =
    object !== undefined && 'paths' in object ? object.paths[selected.pathIndex] : undefined;
  const node = curveCommandNode(path, selected);
  if (node === null) return null;
  const canJoin = selectedNodes.filter((ref) => ref.handle === undefined).length === 2;
  return (
    <div role="toolbar" aria-label="Curve node actions" className="lf-toolstrip__node-actions">
      <NodeAction
        label="Smooth"
        title="Align the incoming and outgoing curve handles"
        onClick={smooth}
      />
      <NodeAction label="Corner" title="Align handles to the adjoining chords" onClick={corner} />
      <NodeAction
        label="Curve"
        title="Convert the outgoing segment to a cubic curve"
        disabled={node.outgoingKind === null || node.outgoingKind === 'cubic'}
        onClick={() => convert('cubic')}
      />
      <NodeAction
        label="Line"
        title="Convert the outgoing segment to a straight line"
        disabled={node.outgoingKind === null || node.outgoingKind === 'line'}
        onClick={() => convert('line')}
      />
      <NodeAction
        label="Start"
        title="Use this node as the closed path start point"
        disabled={!node.closed || selected.pointIndex === 0}
        onClick={setStart}
      />
      <NodeSegmentActions selected={selected} node={node} />
      <NodeAction
        label="Join"
        title="Join two selected open curve endpoints"
        disabled={!canJoin}
        onClick={() => {
          const outcome = join();
          if (outcome.kind !== 'unchanged') props.nodeToolButtonRef.current?.focus();
        }}
      />
    </div>
  );
}

// Break, Insert and Delete segment act on the selected node's outgoing segment,
// the same edits the B, M and D hover keys make.
function NodeSegmentActions(props: {
  readonly selected: PathNodeRef;
  readonly node: NonNullable<ReturnType<typeof curveCommandNode>>;
}): JSX.Element {
  const breakCurve = useStore((state) => state.breakSelectedCurve);
  const insertNode = useStore((state) => state.insertPathNode);
  const deleteSegment = useStore((state) => state.deletePathSegment);
  const { selected, node } = props;
  const noOutgoing = node.outgoingKind === null;
  return (
    <>
      <NodeAction
        label="Break"
        title={
          node.closed
            ? 'Break the closed path open at this node'
            : 'Split the open path in two at this node'
        }
        disabled={!node.closed && (selected.pointIndex === 0 || noOutgoing)}
        onClick={breakCurve}
      />
      <NodeAction
        label="Insert"
        title="Insert a node halfway along the outgoing segment (M over any segment)"
        disabled={noOutgoing}
        onClick={() => insertNode(outgoingSegment(selected), 'midpoint')}
      />
      <NodeAction
        label="Delete segment"
        title="Delete the outgoing segment, opening or splitting the path (D over any segment)"
        disabled={noOutgoing}
        onClick={() => deleteSegment(outgoingSegment(selected))}
      />
    </>
  );
}

function outgoingSegment(node: PathNodeRef): PathSegmentRef {
  return {
    objectId: node.objectId,
    pathIndex: node.pathIndex,
    curveIndex: node.polylineIndex,
    segmentIndex: node.pointIndex,
    t: 0.5,
  };
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
      className="lf-btn lf-toolstrip__node-action"
    >
      {props.label}
    </button>
  );
}

function isActive(current: ToolMode, tool: ToolMode): boolean {
  if (current.kind === 'draw') return tool.kind === 'draw' && tool.shape === current.shape;
  if (current.kind === 'cnc-tabs' || current.kind === 'laser-tabs') return false;
  if (current.kind === 'trim-shapes' || current.kind === 'extend-shapes') return false;
  if (current.kind === 'warp-deform') return false;
  return tool.kind === current.kind;
}
