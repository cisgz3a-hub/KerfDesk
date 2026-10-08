// Test-only prospective C1 contracts; the original strict aggregate stays unchanged.
import { vi } from 'vitest';
import type { Job } from '../core/job/job';
import {
  DEFAULT_OUTPUT_SCOPE,
  type CncCutType,
  type ImportedSvg,
  type OutputScope,
  type Project,
} from '../core/scene';
import { parseSvg } from '../io/svg/parse-svg';
import type { JobReviewModel } from '../ui/laser/job-review/job-review-model';
import {
  reviewArtworkSources,
  type ReviewArtworkSource,
} from '../ui/laser/job-review/review-artwork-sources';
import { useLaserStore } from '../ui/state/laser-store';
import * as workerClient from '../ui/laser/output-preparation-worker-client';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_LAYER_ID,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
  cncOmissionArtwork,
  cncOmissionProject,
} from './cnc-open-contours';
import {
  clearFillReviewState,
  prepareReview,
  resetFillReviewState,
  reviewModel,
  type ReviewBundle,
} from './fill-omission-review';

export type CncOpenContourSource = {
  readonly layerId: string;
  readonly cutType: CncCutType;
  readonly objectId: string;
  readonly count: number;
};
export type CncOmissionReviewModel = JobReviewModel & {
  readonly openCncContourOmissions?: {
    readonly objectIds: ReadonlyArray<string>;
    readonly contourCount: number;
    readonly sources: ReadonlyArray<ReviewArtworkSource>;
  };
};
type CncSourceSidecar = NonNullable<Job['cncCompilation']> & {
  readonly omittedOpenContourSources?: ReadonlyArray<CncOpenContourSource>;
};

export function cncSourceEvidence(job: Job): ReadonlyArray<CncOpenContourSource> | undefined {
  return (job.cncCompilation as CncSourceSidecar | undefined)?.omittedOpenContourSources;
}

export function cncReviewProject(
  objects: ReadonlyArray<ImportedSvg> = [
    CNC_OMISSION_CLOSED,
    CNC_OMISSION_OPEN_A,
    CNC_OMISSION_OPEN_B,
    cncOmissionArtwork('control', true, 230),
  ],
  cutType: CncCutType = 'pocket',
): Project {
  const project = cncOmissionProject(objects, cutType);
  return {
    ...project,
    device: { ...project.device, origin: 'rear-left', bedWidth: 500, bedHeight: 500 },
  };
}

export function canonicalCncArtwork(
  id: string,
  data: string,
  compatibilityClosed: boolean,
): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: id + '.svg',
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="500mm" viewBox="0 0 500 500"><path stroke="#000000" fill="none" d="' +
      data +
      '"/></svg>',
  });
  if (parsed.object === null) throw new Error('Expected real canonical CNC artwork');
  return {
    ...parsed.object,
    paths: parsed.object.paths.map((path) => ({
      ...path,
      operationIds: [CNC_OMISSION_LAYER_ID],
      polylines: path.polylines.map((polyline) => ({ ...polyline, closed: compatibilityClosed })),
    })),
  };
}

let restoreWorkerRoute: (() => void) | null = null;

export function resetCncOmissionReview(): void {
  restoreWorkerRoute?.();
  // jsdom has no compilation Worker. Keep the real preparation/compile/review
  // pipeline while running its snapshot locally; worker transport is not tested.
  const route = vi
    .spyOn(workerClient, 'outputPreparationShouldRunOffThread')
    .mockReturnValue(false);
  restoreWorkerRoute = () => route.mockRestore();
  resetFillReviewState();
  useLaserStore.setState({
    controllerSettings: {
      ...useLaserStore.getState().controllerSettings,
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: false,
    },
  });
}
export function clearCncOmissionReview(): void {
  restoreWorkerRoute?.();
  restoreWorkerRoute = null;
  clearFillReviewState();
}

export function prepareCncOmissionReview(
  project: Project = cncReviewProject(),
  scope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): Promise<ReviewBundle> {
  return prepareReview(project, scope);
}

export function cncReviewModel(
  bundle: ReviewBundle,
  overrides: Partial<Parameters<typeof reviewModel>[1]> = {},
): CncOmissionReviewModel {
  return reviewModel(bundle, overrides) as CncOmissionReviewModel;
}

// The integration tests require production to supply this data. Isolated
// navigation tests seed the known omissions in a genuinely prepared CNC job so
// model/compiler failures cannot conceal independent selection/race defects.
export function seededCncNavigationModel(
  bundle: ReviewBundle,
  ids: ReadonlyArray<string> = [CNC_OMISSION_OPEN_A.id, CNC_OMISSION_OPEN_B.id],
): CncOmissionReviewModel {
  const wanted = new Set(ids);
  const objects = bundle.prepared.prepared.project.scene.objects.filter((object) =>
    wanted.has(object.id),
  );
  return {
    ...cncReviewModel(bundle),
    openCncContourOmissions: {
      objectIds: [...ids],
      contourCount: ids.length,
      sources: reviewArtworkSources(objects),
    },
  };
}

export function changedCncArtwork(project: Project, id: string): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        object.id === id
          ? { ...object, transform: { ...object.transform, x: object.transform.x + 80 } }
          : object,
      ),
    },
  };
}
