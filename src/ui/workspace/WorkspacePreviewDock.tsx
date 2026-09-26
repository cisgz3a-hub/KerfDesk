import { useMemo, useState } from 'react';
import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { Cut3DPreviewDialog } from '../relief-viewer';
import { PreviewControlsPanel, PreviewStatusOverlays } from './preview-overlays';
import { assumedTipAngleNotice } from './preview-assumed-tip-angle';
import { useCncCut3DSurface, type CncCut3DSurfaceState } from './use-cnc-cut3d-surface';
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
  readonly cncRemovalGridPending?: boolean;
  readonly rasterPending: boolean;
}): JSX.Element | null {
  const [cut3DOpen, setCut3DOpen] = useState(false);
  const gridPending = props.cncRemovalGridPending === true;
  const grid = useHeldGrid(props.cncRemovalGrid, gridPending);
  const cut3DSurface = useCncCut3DSurface(grid, cut3DOpen);
  const { project, toolpath } = props;
  const tipAngleNotice = useMemo(
    () => (toolpath === null ? null : assumedTipAngleNotice(project, toolpath)),
    [project, toolpath],
  );
  if (!props.previewMode) return null;
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
            {...(grid === null || tipAngleNotice === null ? {} : { tipAngleNotice })}
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
        <Cut3DDialogSlot
          grid={grid}
          surface={cut3DSurface}
          gridPending={gridPending}
          tipAngleNotice={tipAngleNotice}
          stockThicknessMm={stockThicknessMm}
          onClose={() => setCut3DOpen(false)}
        />
      ) : null}
    </section>
  );
}

function Cut3DDialogSlot(props: {
  readonly grid: RemovalGrid;
  readonly surface: CncCut3DSurfaceState;
  readonly gridPending: boolean;
  readonly tipAngleNotice: string | null;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { surface } = props;
  return (
    <Cut3DPreviewDialog
      grid={props.grid}
      mesh={surface.kind === 'ready' ? surface.mesh : null}
      {...(surface.kind === 'ready' ? { updating: props.gridPending || surface.updating } : {})}
      {...(surface.kind === 'unavailable' ? { unavailableReason: surface.reason } : {})}
      {...(props.tipAngleNotice === null ? {} : { tipAngleNotice: props.tipAngleNotice })}
      stockThicknessMm={props.stockThicknessMm}
      onClose={props.onClose}
    />
  );
}

// While playback or a scrub prepares the next grid, the open Cut 3D keeps the
// last one instead of unmounting, so its canvas and camera survive (ADR-425).
function useHeldGrid(grid: RemovalGrid | null, pending: boolean): RemovalGrid | null {
  const [held, setHeld] = useState<RemovalGrid | null>(grid);
  if (grid !== null && grid !== held) setHeld(grid);
  return grid ?? (pending ? held : null);
}
