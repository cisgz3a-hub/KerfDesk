// StatusBar — WORKFLOW.md F-A16. Bottom bar with cursor position, selection
// summary, object / operation counts, device name, bed dimensions, and the
// right-aligned Update button when a new version is ready (ADR-227). In the web
// app the action rail also links the pricing and policy pages (ADR-524
// Amendment 3). Job estimate is Phase C. Also hosts the canvas motion status slot (see
// `status-bar-slots.ts`) so machine-status text lands here instead of on the
// canvas.

import { transformedBBox, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useLengthUnit } from '../state/display-units';
import {
  formatDisplayLength,
  formatDisplayLengthFixed,
  type DisplayLengthUnit,
} from '../display-length';
import { selectedOpenFillContourCount } from './fill-diagnostics';
import { DesktopPreviewUpdateButton } from './DesktopPreviewUpdateButton';
import { PwaUpdateButton } from './PwaUpdateButton';
import { SiteLinks } from './SiteLinks';
import { EditionStatusButton } from '../licensing/EditionStatusButton';
import { UpdateReadyButton } from '../licensing/UpdateReadyButton';
import { CANVAS_MOTION_SLOT_ID } from './status-bar-slots';
import './status-bar.css';
import { useScrollOverflowCue } from './use-scroll-overflow-cue';

export function StatusBar({ children }: { readonly children?: React.ReactNode }): JSX.Element {
  const project = useStore((s) => s.project);
  const cursorMm = useStore((s) => s.cursorMm);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const unit = useLengthUnit();
  const objectCount = project.scene.objects.length;
  const groupCount = project.scene.groups?.length ?? 0;
  const lockedCount = project.scene.objects.filter((object) => object.locked === true).length;
  const layerCount = project.scene.layers.length;
  const outputLayerCount = project.scene.layers.filter((l) => l.output).length;
  const selectedFillWarning = fillWarning(project, selectedObjectId, additionalSelectedIds);
  const telemetryRef = useScrollOverflowCue<HTMLDivElement>();
  return (
    <footer aria-label="Status bar" className="lf-status-bar" style={barStyle}>
      <div
        ref={telemetryRef}
        className="lf-status-bar__telemetry"
        style={telemetryStyle}
        title="Workspace status. When the line runs past the edge, scroll it sideways with the mouse wheel or, once focused, the arrow keys."
        role="group"
        tabIndex={0}
        aria-label="Workspace status details"
        onKeyDown={retainStatusScrollKeys}
      >
        <Segment>
          {cursorMm === null
            ? 'Cursor: —'
            : `Cursor: X ${fixed(cursorMm.x, unit)}, Y ${fixed(cursorMm.y, unit)} ${unit}`}
        </Segment>
        <Segment>
          {describeSelection(project, selectedObjectId, additionalSelectedIds, unit)}
        </Segment>
        {selectedFillWarning !== null && <Segment>{selectedFillWarning}</Segment>}
        <Segment>Objects: {objectCount}</Segment>
        {groupCount > 0 && <Segment>Groups: {groupCount}</Segment>}
        {lockedCount > 0 && <Segment>Locked: {lockedCount}</Segment>}
        <Segment>
          Operations: {layerCount} ({outputLayerCount} output)
        </Segment>
        <Segment>Device: {project.device.name}</Segment>
        <Segment>
          Bed: {formatDisplayLength(project.device.bedWidth, unit)} ×{' '}
          {formatDisplayLength(project.device.bedHeight, unit)} {unit}
        </Segment>
        <Segment>Zoom: {Math.round(zoomFactor * 100)}%</Segment>
        {/* Mount point for the canvas motion overlay's machine-status line, which
            the workspace portals in rather than floating over the drawing area.
            display:contents keeps the empty slot from becoming a flex item (and
            adding a phantom gap), and lets the portalled text sit in telemetry. */}
        <span id={CANVAS_MOTION_SLOT_ID} style={slotStyle} />
      </div>
      <div className="lf-status-bar__actions" style={actionsStyle}>
        {children}
        <SiteLinks />
        <EditionStatusButton />
        <UpdateReadyButton />
        <DesktopPreviewUpdateButton />
        <PwaUpdateButton />
      </div>
    </footer>
  );
}

function retainStatusScrollKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
  // Let the browser scroll this focused group without invoking canvas nudge
  // or machine Z-focus shortcuts at the window level.
  if (STATUS_SCROLL_KEYS.has(event.key)) event.stopPropagation();
}

const STATUS_SCROLL_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ' ',
]);

function describeSelection(
  project: ReturnType<typeof useStore.getState>['project'],
  selectedId: string | null,
  additional: ReadonlySet<string>,
  unit: DisplayLengthUnit,
): string {
  if (selectedId === null) return 'Nothing selected';
  const obj = project.scene.objects.find((o) => o.id === selectedId);
  if (obj === undefined) return 'Nothing selected';
  const count = 1 + additional.size;
  if (count > 1) return `${count} selected`;
  const bbox = transformedBBox(obj);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  return `1 selected · ${fixed(w, unit)} × ${fixed(h, unit)} ${unit} · X ${fixed(bbox.minX, unit)}, Y ${fixed(bbox.minY, unit)}`;
}

// One decimal of a millimetre, or three of an inch (ADR-629).
function fixed(mm: number, unit: DisplayLengthUnit): string {
  return formatDisplayLengthFixed(mm, unit, 1);
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
  return (
    <span className="lf-status-bar__segment" style={segStyle}>
      {children}
    </span>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflowX: 'hidden',
  overflowY: 'hidden',
  gap: 8,
  alignItems: 'center',
  padding: '2px 8px',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text-muted)',
  fontFamily: 'var(--lf-font)',
  fontSize: 'var(--lf-text-xs)',
  lineHeight: 1.4,
  flexShrink: 0,
  borderTop: '1px solid var(--lf-border)',
};
const telemetryStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 auto',
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  gap: 10,
  alignItems: 'center',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flex: '0 0 auto',
  flexShrink: 0,
  gap: 8,
  alignItems: 'center',
};
const segStyle: React.CSSProperties = { whiteSpace: 'nowrap' };
const slotStyle: React.CSSProperties = { display: 'contents' };
