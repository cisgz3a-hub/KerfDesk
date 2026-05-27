// StatusBar — WORKFLOW.md F-A16. Bottom bar with cursor position, selection
// summary, object / layer counts, device name, bed dimensions. Job estimate
// is Phase C.

import { transformedBBox } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function StatusBar(): JSX.Element {
  const project = useStore((s) => s.project);
  const cursorMm = useStore((s) => s.cursorMm);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const objectCount = project.scene.objects.length;
  const layerCount = project.scene.layers.length;
  const outputLayerCount = project.scene.layers.filter((l) => l.output).length;
  return (
    <footer aria-label="Status bar" style={barStyle}>
      <Segment>
        {cursorMm === null
          ? 'Cursor: —'
          : `Cursor: X ${cursorMm.x.toFixed(1)}, Y ${cursorMm.y.toFixed(1)} mm`}
      </Segment>
      <Segment>{describeSelection(project, selectedObjectId, additionalSelectedIds)}</Segment>
      <Segment>Objects: {objectCount}</Segment>
      <Segment>
        Layers: {layerCount} ({outputLayerCount} output)
      </Segment>
      <Segment>Device: {project.device.name}</Segment>
      <Segment>
        Bed: {project.device.bedWidth} × {project.device.bedHeight} mm
      </Segment>
      <Segment>Zoom: {Math.round(zoomFactor * 100)}%</Segment>
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

function Segment({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <span style={segStyle}>{children}</span>;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'center',
  padding: '4px 12px',
  background: '#222',
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  borderTop: '1px solid #111',
};
const segStyle: React.CSSProperties = { whiteSpace: 'nowrap' };
