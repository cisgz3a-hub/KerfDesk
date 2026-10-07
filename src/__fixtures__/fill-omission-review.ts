import type { StatusReport } from '../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  type ImportedSvg,
  type OutputScope,
  type Project,
} from '../core/scene';
import { parseSvg } from '../io/svg/parse-svg';
import { curveSubpathBounds } from '../core/scene/curve-path';
import { useCameraStore } from '../ui/state/camera-store';
import { captureLaserModeStartSnapshot } from '../ui/state/laser-mode-start-evidence';
import { useLaserStore } from '../ui/state/laser-store';
import { initialLaserState } from '../ui/state/laser-store-helpers';
import { currentOutputScope } from '../ui/state/output-scope-state';
import { useStore } from '../ui/state/store';
import { resetStore } from '../ui/state/test-helpers';
import { useUiStore } from '../ui/state/ui-store';
import { frameVerificationForProject } from '../ui/laser/frame-verification-testing';
import { prepareCurrentStartJob } from '../ui/laser/start-job-source';
import {
  buildJobReviewModel,
  type JobReviewModel,
  type PreparedCurrentStart,
} from '../ui/laser/job-review/job-review-model';
import { useJobReviewStore } from '../ui/laser/job-review/job-review-store';

export type FillOmissionReview = JobReviewModel;
export type ReviewBundle = {
  readonly project: Project;
  readonly prepared: PreparedCurrentStart;
  readonly outputScope: OutputScope;
};

const operation = createLayer({ id: 'operation', color: '#000000', mode: 'line' });
const controlOperation = createLayer({ id: 'control', color: '#ff0000', mode: 'line' });
const offOperation = {
  ...createLayer({ id: 'off', color: '#000000', mode: 'fill' }),
  output: false,
};
const nearCurve = 'M10 10 C20 10 20 20 10 20 L10.25 10.25';
const farCurve = 'M50 10 C60 10 60 20 50 20 L52 10';
const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 500,
  bedHeight: 500,
};
const idle: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
export function resetFillReviewState(): void {
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idle,
    controllerSessionEpoch: 7,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettings: {
      maxPowerS: device.maxPowerS,
      minPowerS: device.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
  });
  useUiStore.setState({
    zoomFactor: 1,
    panX: 0,
    panY: 0,
    cutsLayersView: 'run-order',
    railPanelVisibility: { layers: false, machine: true },
    railPanelFocusRequest: null,
  });
}

export function clearFillReviewState(): void {
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  resetStore();
}

export async function prepareReview(
  project: Project,
  scope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): Promise<ReviewBundle> {
  const selected = scope.cutSelectedGraphics ? scope.selectedObjectIds : ['control'];
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    outputScopeSettings: {
      cutSelectedGraphics: scope.cutSelectedGraphics,
      useSelectionOrigin: scope.useSelectionOrigin,
    },
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  const app = useStore.getState();
  const outputScope = currentOutputScope(app);
  useLaserStore.setState({
    frameVerification: frameVerificationForProject(project, { outputScope }),
  });
  const prepared = await prepareCurrentStartJob(
    app,
    useLaserStore.getState(),
    useCameraStore.getState(),
  );
  if (!prepared.ok)
    throw new Error('Expected a prepared executable control: ' + prepared.messages.join(' / '));
  return { project, prepared, outputScope };
}

export function reviewModel(
  bundle: ReviewBundle,
  overrides: Partial<Parameters<typeof buildJobReviewModel>[0]> = {},
): FillOmissionReview {
  return buildJobReviewModel({
    project: bundle.project,
    prepared: bundle.prepared,
    outputScope: bundle.outputScope,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(useLaserStore.getState()),
    overrides: null,
    ...overrides,
  });
}

export function reviewProject(
  omitted: ReadonlyArray<ImportedSvg> = [
    fillArtwork('omitted-a', nearCurve + ' ' + farCurve, true),
    fillArtwork('omitted-b', nearCurve),
  ],
): Project {
  const control = parsedArtwork(
    'control',
    'M230 230 H238 V238 H230 Z',
    controlOperation.id,
    '#ff0000',
  );
  const disabled = fillArtwork('disabled-fill', nearCurve, false, offOperation.id);
  const outline = parsedArtwork('ordinary-line', nearCurve, operation.id);
  return {
    ...createProject(device),
    scene: {
      objects: [...omitted, control, disabled, outline],
      layers: [operation, controlOperation, offOperation],
      groups: [],
    },
  };
}

export function fillArtwork(
  id: string,
  data: string,
  legacyFlagOnly = false,
  operationId = operation.id,
): ImportedSvg {
  const source = parsedArtwork(id, data, operationId);
  return {
    ...source,
    ...(id === 'omitted-b' ? { transform: { ...source.transform, x: 90, y: 20 } } : {}),
    operationOverride: {
      byOperation: { [operationId]: { mode: 'fill', fillStyle: 'scanline', hatchSpacingMm: 1 } },
    },
    paths: source.paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((polyline) => ({ ...polyline, closed: legacyFlagOnly })),
    })),
  };
}

function parsedArtwork(
  id: string,
  data: string,
  operationId: string,
  color = '#000000',
): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: id + '.svg',
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="500mm" viewBox="0 0 500 500"><path fill="none" stroke="' +
      color +
      '" d="' +
      data +
      '"/></svg>',
  });
  if (parsed.object === null) throw new Error('Expected real parsed curve artwork');
  const bounds = parsed.object.paths.flatMap((path) => path.curves?.map(curveSubpathBounds) ?? []);
  if (bounds.length === 0) throw new Error('Expected canonical artwork bounds');
  return {
    ...parsed.object,
    // An imported SVG also owns its page viewport. This fixture selects the
    // actual contour artwork, so use its canonical bounds for a decisive
    // selection-fit check with the executable control far away.
    bounds: {
      minX: Math.min(...bounds.map((value) => value.minX)),
      minY: Math.min(...bounds.map((value) => value.minY)),
      maxX: Math.max(...bounds.map((value) => value.maxX)),
      maxY: Math.max(...bounds.map((value) => value.maxY)),
    },
    paths: parsed.object.paths.map((path) => ({ ...path, operationIds: [operationId] })),
  };
}

export function changedArtwork(project: Project, id: string): Project {
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
