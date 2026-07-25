// StatusBar — WORKFLOW.md F-A16. Bottom bar with cursor position, selection
// summary, object / layer counts, device name, bed dimensions, and the
// right-aligned Update button when a new version is ready (ADR-227). Job
// estimate is Phase C. Also hosts the canvas motion status slot (see
// `status-bar-slots.ts`) so machine-status text lands here instead of on the
// canvas.

import { transformedBBox, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { selectedOpenFillContourCount } from './fill-diagnostics';
import { DesktopPreviewUpdateButton } from './DesktopPreviewUpdateButton';
import { PwaUpdateButton } from './PwaUpdateButton';
import { CANVAS_MOTION_SLOT_ID } from './status-bar-slots';

export function StatusBar(): JSX.Element {
  const project = useStore((s) => s.project);
  const cursorMm = useStore((s) => s.cursorMm);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const objectCount = project.scene.objects.length;
  const groupCount = project.scene.groups?.length ?? 0;
  const lockedCount = project.scene.objects.filter((object) => object.locked === true).length;
  const layerCount = project.scene.layers.length;
  const outputLayerCount = project.scene.layers.filter((l) => l.output).length;
  const selectedFillWarning = fillWarning(project, selectedObjectId, additionalSelectedIds);
  return (
    <footer aria-label="Status bar" style={barStyle}>
      <Segment>
        {cursorMm === null
          ? 'Cursor: —'
          : `Cursor: X ${cursorMm.x.toFixed(1)}, Y ${cursorMm.y.toFixed(1)} mm`}
      </Segment>
      <Segment>{describeSelection(project, selectedObjectId, additionalSelectedIds)}</Segment>
      {selectedFillWarning !== null && <Segment>{selectedFillWarning}</Segment>}
      <Segment>Objects: {objectCount}</Segment>
      {groupCount > 0 && <Segment>Groups: {groupCount}</Segment>}
      {lockedCount > 0 && <Segment>Locked: {lockedCount}</Segment>}
      <Segment>
        Layers: {layerCount} ({outputLayerCount} output)
      </Segment>
      <Segment>Device: {project.device.name}</Segment>
      <Segment>
        Bed: {project.device.bedWidth} × {project.device.bedHeight} mm
      </Segment>
      <Segment>Zoom: {Math.round(zoomFactor * 100)}%</Segment>
      {/* Mount point for the canvas motion overlay's machine-status line, which
          the workspace portals in rather than floating over the drawing area.
          display:contents keeps the empty slot from becoming a flex item (and
          adding a phantom gap), and lets the portalled text sit in the bar's
          own flex flow. */}
      <span id={CANVAS_MOTION_SLOT_ID} style={slotStyle} />
      <DesktopPreviewUpdateButton />
      <PwaUpdateButton />
    </footer>
  );
}

function describeSelection(
  project: ReturnType<typeof useStore.getState>['project'],
  selectedId: string | null,
  additional: ReadonlySet<string>,
): string {
  if (selectedId === null) return 'Nothing selected';
  const obj = project.scene.objects.find((o) => o.id === selectedId);
  if (obj === undefined) return 'Nothing selected';
  const count = 1 + additional.size;
  if (count > 1) return `${count} selected`;
  const bbox = transformedBBox(obj);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  return `1 selected · ${w.toFixed(1)} × ${h.toFixed(1)} mm · X ${bbox.minX.toFixed(1)}, Y ${bbox.minY.toFixed(1)}`;
}

function fillWarning(
  project: Project,
  selectedId: string | null,
  additional: ReadonlySet<string>,
): string | null {
  const count = selectedOpenFillContourCount(project, selectedId, additional);
  if (count === 0) return null;
  const noun = count === 1 ? 'contour' : 'contours';
  return `Fill warning: ${count} open ${noun} will not fill`;
}

function Segment({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <span style={segStyle}>{children}</span>;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflowX: 'auto',
  overflowY: 'hidden',
  gap: 16,
  alignItems: 'center',
  padding: '4px 12px',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  borderTop: '1px solid var(--lf-border)',
};
const segStyle: React.CSSProperties = { whiteSpace: 'nowrap' };
const slotStyle: React.CSSProperties = { display: 'contents' };
