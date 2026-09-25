// Node tool toolbar (ADR-376). With a node selected it offers the node's
// actions and those of the segment leaving it; with a segment picked by
// clicking it, that segment's. The same edits have keys while the pointer is
// over the artwork, and each tooltip names its key.

import { explicitCurveSubpath } from '../../core/geometry/curve-segment-geometry';
import { curveNodeCount, type PathSegment, type Project } from '../../core/scene';
import {
  canonicalNodeIndex,
  canonicalSubpath,
  nodeEditableObject,
} from '../state/path-curve-object-edit';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import type { PathSegmentRef } from '../state/path-segment-ref';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { resolveSelectedSegment, useNodeEditStore } from './node-edit-store';

type NodeToolButtonRef = React.RefObject<HTMLButtonElement | null>;

type NodeInfo = {
  readonly nodeIndex: number;
  readonly closed: boolean;
  readonly openEnd: boolean;
  readonly outgoing: PathSegment | undefined;
};

export function NodeActionBar(props: {
  readonly nodeToolButtonRef: NodeToolButtonRef;
}): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedPathNode);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const clicked = useNodeEditStore((state) => state.selectedSegment);
  if (selected !== null) {
    if (selected.handle !== undefined) return null;
    return <NodeActions node={selected} nodeToolButtonRef={props.nodeToolButtonRef} />;
  }
  const segment = resolveSelectedSegment(project, clicked);
  if (segment === null || clicked === null || segment.objectId !== selectedObjectId) return null;
  return <SegmentActions segment={segment} t={clicked.t} project={project} />;
}

function NodeActions(props: {
  readonly node: PathNodeRef;
  readonly nodeToolButtonRef: NodeToolButtonRef;
}): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selectedNodes = useStore((state) => state.selectedPathNodes);
  const setSmoothness = useStore((state) => state.setPathNodeSmoothness);
  const convert = useStore((state) => state.convertPathSegment);
  const setStart = useStore((state) => state.setSelectedCurveStart);
  const breakAt = useStore((state) => state.breakPathAtNode);
  const join = useStore((state) => state.joinSelectedCurveNodes);
  const align = useStore((state) => state.alignSelectedPathNodes);
  const { node } = props;
  const info = nodeInfo(project, node);
  if (info === null) return null;
  const anchors = selectedNodes.filter((ref) => ref.handle === undefined);
  const outgoing: PathSegmentRef = {
    objectId: node.objectId,
    pathIndex: node.pathIndex,
    polylineIndex: node.polylineIndex,
    segmentIndex: info.nodeIndex,
  };
  return (
    <div role="toolbar" aria-label="Curve node actions" className="lf-toolstrip__node-actions">
      <NodeAction
        label="Smooth"
        title="Align the incoming and outgoing curve handles (S)"
        onClick={() => setSmoothness(node, 'smooth')}
      />
      <NodeAction
        label="Corner"
        title="Align handles to the adjoining chords (C)"
        onClick={() => setSmoothness(node, 'corner')}
      />
      <NodeAction
        label="Curve"
        title="Convert the outgoing segment to a cubic curve"
        disabled={info.outgoing === undefined || info.outgoing.kind === 'cubic'}
        onClick={() => convert(outgoing, 'cubic')}
      />
      <NodeAction
        label="Line"
        title="Convert the outgoing segment to a straight line"
        disabled={info.outgoing === undefined || info.outgoing.kind === 'line'}
        onClick={() => convert(outgoing, 'line')}
      />
      <NodeAction
        label="Start"
        title="Use this node as the closed path start point"
        disabled={node.geometry !== 'curve' || !info.closed || info.nodeIndex === 0}
        onClick={setStart}
      />
      <NodeAction
        label="Break"
        title="Break the path open at this node (B)"
        disabled={info.openEnd}
        onClick={() => breakAt(node)}
      />
      <NodeAction
        label="Join"
        title="Join two selected open curve endpoints"
        disabled={anchors.filter((ref) => ref.geometry === 'curve').length !== 2}
        onClick={() => {
          const outcome = join();
          if (outcome.kind !== 'unchanged') props.nodeToolButtonRef.current?.focus();
        }}
      />
      {anchors.length >= 2 ? (
        <NodeAction
          label="Align"
          title="Line the selected nodes up across their smaller spread, on the one selected last (A)"
          onClick={align}
        />
      ) : null}
    </div>
  );
}

function SegmentActions(props: {
  readonly segment: PathSegmentRef;
  readonly t: number;
  readonly project: Project;
}): JSX.Element {
  const insert = useStore((state) => state.insertPathNodeAtMidpoint);
  const remove = useStore((state) => state.deletePathSegment);
  const removeObjects = useStore((state) => state.removeSceneObjects);
  const trim = useStore((state) => state.trimPathSegment);
  const convert = useStore((state) => state.convertPathSegment);
  const align = useStore((state) => state.alignPathSegmentAngle);
  const { segment } = props;
  const kind = segmentKind(props.project, segment);
  // Converting keeps the segment where it was, so it stays picked for the next button.
  const convertKeepingPick = (to: 'line' | 'cubic'): void => {
    if (!convert(segment, to)) return;
    useNodeEditStore.getState().selectSegment(segment, useStore.getState().project, props.t);
  };
  return (
    <div role="toolbar" aria-label="Segment actions" className="lf-toolstrip__node-actions">
      <NodeAction
        label="Add"
        title="Add a node halfway along the segment (M; I adds one at the pointer)"
        onClick={() => insert(segment)}
      />
      <NodeAction
        label="Delete"
        title="Delete the segment, opening or splitting the path (D or Delete)"
        onClick={() => {
          if (remove(segment) === 'last-segment') removeObjects([segment.objectId]);
        }}
      />
      <NodeAction
        label="Trim"
        title="Cut the clicked part back to where other lines cross it (T)"
        onClick={() => {
          if (trim(segment, props.t) !== 'no-crossing') return;
          useToastStore
            .getState()
            .pushToast(
              'Nothing crosses that segment, so there is nowhere to trim it back to.',
              'warning',
            );
        }}
      />
      <NodeAction
        label="Curve"
        title="Convert the segment to a cubic curve (C or S)"
        disabled={kind === 'cubic'}
        onClick={() => convertKeepingPick('cubic')}
      />
      <NodeAction
        label="Line"
        title="Convert the segment to a straight line (L)"
        disabled={kind === 'line'}
        onClick={() => convertKeepingPick('line')}
      />
      <NodeAction
        label="Align"
        title="Turn the artwork so this segment is level, upright or at 45° (A)"
        onClick={() => align(segment)}
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
      className="lf-btn lf-toolstrip__node-action"
    >
      {props.label}
    </button>
  );
}

function nodeInfo(project: Project, node: PathNodeRef): NodeInfo | null {
  const object = nodeEditableObject(project, node.objectId);
  const nodeIndex = object === null ? null : canonicalNodeIndex(object, node);
  const subpath =
    object === null ? null : canonicalSubpath(object, node.pathIndex, node.polylineIndex);
  if (nodeIndex === null || subpath === null) return null;
  const lastNode = curveNodeCount(subpath) - 1;
  return {
    nodeIndex,
    closed: subpath.closed,
    openEnd: !subpath.closed && (nodeIndex === 0 || nodeIndex === lastNode),
    outgoing: explicitCurveSubpath(subpath).segments[nodeIndex],
  };
}

function segmentKind(project: Project, ref: PathSegmentRef): PathSegment['kind'] | null {
  const object = nodeEditableObject(project, ref.objectId);
  const subpath =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (subpath === null) return null;
  return explicitCurveSubpath(subpath).segments[ref.segmentIndex]?.kind ?? null;
}
