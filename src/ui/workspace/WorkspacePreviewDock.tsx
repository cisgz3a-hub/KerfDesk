import { useState } from 'react';
import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { Cut3DPreviewDialog } from '../relief-viewer';
import { PreviewControlsPanel, PreviewStatusOverlays } from './preview-overlays';
import { useCncCut3DSurface } from './use-cnc-cut3d-surface';
import { WorkspacePreviewChrome } from './WorkspacePreviewChrome';

// A layout sibling of the canvas: ResizeObserver measures the remaining stage,
// so fit-to-bed and pointer mapping use the drawable area above these controls.
export function WorkspacePreviewDock(props: {
  readonly previewMode: boolean;
  readonly project: Project;
  readonly toolpath: Toolpath | null;
  readonly estimate: LiveJobEstimate;
  readonly routeLabel: string;
  readonly cncRemovalGrid: RemovalGrid | null;
  readonly rasterPending: boolean;
}): JSX.Element | null {
  const [cut3DOpen, setCut3DOpen] = useState(false);
  const cut3DSurface = useCncCut3DSurface(props.cncRemovalGrid, cut3DOpen);
  if (!props.previewMode) return null;
  const grid = props.cncRemovalGrid;
  const machine = props.project.machine;
  const stockThicknessMm = machine?.kind === 'cnc' ? machine.stock.thicknessMm : 0;
  return (
    <section className="lf-preview-dock" aria-label="Preview playback">
      {props.toolpath === null ? (
        <p role="status">Preparing preview…</p>
      ) : (
        <>
          <PreviewStatusOverlays
            project={props.project}
            toolpath={props.toolpath}
            {...(grid === null ? {} : { resolution: grid.resolution })}
          />
          <PreviewControlsPanel
            toolpath={props.toolpath}
            estimate={props.estimate}
            routeLabel={props.routeLabel}
            disabled={props.toolpath.totalLength <= 0}
            {...(grid !== null ? { onOpen3D: () => setCut3DOpen(true) } : {})}
          />
        </>
      )}
      <WorkspacePreviewChrome previewMode rasterPending={props.rasterPending} />
      {cut3DOpen && grid !== null ? (
        <Cut3DPreviewDialog
          grid={grid}
          mesh={cut3DSurface.kind === 'ready' ? cut3DSurface.mesh : null}
          {...(cut3DSurface.kind === 'ready' ? { surfaceRevision: cut3DSurface.revision } : {})}
          {...(cut3DSurface.kind === 'unavailable'
            ? { unavailableReason: cut3DSurface.reason }
            : {})}
          stockThicknessMm={stockThicknessMm}
          onClose={() => setCut3DOpen(false)}
        />
      ) : null}
    </section>
  );
}
