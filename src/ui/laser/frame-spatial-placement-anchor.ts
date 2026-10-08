import {
  registrationBoxBounds,
  selectedOutputPlacementBounds,
} from '../../io/gcode/prepare-output';
import { cncSideInputScene, cncSideOutputProject } from '../../core/cnc/cnc-two-sided-setup';
import { anchorPointForOrigin } from '../../core/job/job-origin';
import type { JobBounds } from '../../core/job/job-bounds';
import type { JobPlacementSettings } from '../../core/job';
import type { OutputScope, Project, Vec2 } from '../../core/scene';
import type { CncTwoSidedSetup } from '../../core/scene/cnc-two-sided-setup';
import type { Scene } from '../../core/scene/scene';

export type FrameSpatialPlacementBinding =
  | { readonly kind: 'known'; readonly anchor: Vec2 }
  | { readonly kind: 'unresolved' };

type PlacementBounds =
  | { readonly kind: 'known'; readonly bounds: JobBounds | null }
  | {
      readonly kind: 'unresolved';
    };

type PlacementBoundsEntry = {
  readonly device: Project['device'];
  readonly machine: Project['machine'];
  readonly side: CncTwoSidedSetup | undefined;
  readonly selectionOrigin: boolean;
  readonly result: PlacementBounds;
};

// Selection saves a new Project around unchanged source inputs. Cache before
// side filtering creates new wrappers; keep only the last numeric result per
// weak Scene, never compiled jobs or a map of selection scopes.
const placementBounds = new WeakMap<Scene, PlacementBoundsEntry>();

export function frameSpatialPlacementBinding(
  project: Project,
  scope: OutputScope,
  placement: JobPlacementSettings,
): FrameSpatialPlacementBinding | undefined {
  if (!scope.cutSelectedGraphics || placement.startFrom === 'absolute') return undefined;
  const result = cachedPlacementBounds(project, scope.useSelectionOrigin);
  if (result.kind === 'unresolved') return result;
  if (scope.useSelectionOrigin && result.bounds === null) return undefined;
  // The preparation pipeline uses zero offset when neither fixture nor full
  // scene produces bounds; bind that same fallback rather than inventing one.
  const anchor =
    result.bounds === null
      ? { x: 0, y: 0 }
      : anchorPointForOrigin(result.bounds, placement.anchor, project.device.origin);
  return Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
    ? { kind: 'known', anchor }
    : { kind: 'unresolved' };
}

function cachedPlacementBounds(project: Project, selectionOrigin: boolean): PlacementBounds {
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided : undefined;
  const cached = placementBounds.get(project.scene);
  if (
    cached !== undefined &&
    cached.device === project.device &&
    cached.machine === project.machine &&
    cached.side === side &&
    cached.selectionOrigin === selectionOrigin
  )
    return cached.result;
  let result: PlacementBounds;
  try {
    const scene = cncSideInputScene(project, project.scene);
    const sideProject = cncSideOutputProject(project, scene);
    result = {
      kind: 'known',
      bounds: selectionOrigin
        ? registrationBoxBounds(sideProject)
        : selectedOutputPlacementBounds(sideProject),
    };
  } catch {
    // Keep complete source dependencies until geometry can be resolved. Actual
    // preparation still reports its factual source error through its own path.
    result = { kind: 'unresolved' };
  }
  placementBounds.set(project.scene, {
    device: project.device,
    machine: project.machine,
    side,
    selectionOrigin,
    result,
  });
  return result;
}
