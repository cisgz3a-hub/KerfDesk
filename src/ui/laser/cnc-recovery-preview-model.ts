import { fingerprintGcode, fingerprintsEqual, type JobCheckpoint } from '../../core/recovery';
import {
  previewCncContourRunway,
  type CncContourRunwayPreviewResult,
} from '../../core/recovery/cnc-contour-runway-preview';
import { buildCncRecoveryEventManifest, type CncRecoveryEvent } from '../../core/recovery/cnc';
import type { Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';

export const CNC_RECOVERY_PREVIEW_PARAMETERS = {
  minRunwayMm: 5,
  accelerationMmPerSec2: 100,
  safetyMarginMm: 2,
} as const;

export type CncRecoveryEvidenceCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: 'matched' | 'diagnostic' | 'missing' | 'mismatch';
  readonly detail: string;
};

export type CncRecoveryPreviewEvent = {
  readonly id: string;
  readonly label: string;
};

export type CncRecoveryPreviewModel = {
  readonly canExecute: false;
  readonly unavailableReason: string | null;
  readonly checks: ReadonlyArray<CncRecoveryEvidenceCheck>;
  readonly events: ReadonlyArray<CncRecoveryPreviewEvent>;
  readonly selectedEventId: string | null;
  readonly geometry: CncContourRunwayPreviewResult | null;
};

export function buildCncRecoveryPreviewModel(
  project: Project,
  checkpoint: JobCheckpoint,
  requestedEventId?: string,
): CncRecoveryPreviewModel {
  const base = baseEvidenceChecks(checkpoint);
  if (checkpoint.machineKind !== 'cnc' || project.machine?.kind !== 'cnc') {
    return unavailable(base, 'Open the original CNC project to review its recovery geometry.');
  }
  const prepared = prepareOutput(project, {
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (!prepared.ok) {
    return unavailable(base, 'The current project cannot be compiled into a previewable CNC job.');
  }
  const emitted = emitPreparedGcode(prepared, {
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (!emitted.preflight.ok) {
    return unavailable(
      base,
      'The current project fails CNC preflight, so geometry is unavailable.',
    );
  }
  const programMatches = fingerprintsEqual(fingerprintGcode(emitted.gcode), checkpoint.fingerprint);
  const checks = [programIdentityCheck(programMatches), ...base];
  if (!programMatches) {
    return unavailable(
      checks,
      'The current project does not reproduce the interrupted program. No geometry is shown.',
    );
  }
  const manifest = buildCncRecoveryEventManifest(prepared.job);
  const candidates = manifest.events.filter(isPreviewCandidate);
  const events = candidates.map((event) => ({ id: event.id, label: eventLabel(event) }));
  const selectedEventId = selectEventId(events, requestedEventId);
  const geometry =
    selectedEventId === null
      ? null
      : previewCncContourRunway({
          job: prepared.job,
          manifest,
          uncertaintyEventId: selectedEventId,
          parameters: CNC_RECOVERY_PREVIEW_PARAMETERS,
        });
  return {
    canExecute: false,
    unavailableReason:
      events.length === 0
        ? 'This job has no single-tool native contour segment eligible for runway preview.'
        : null,
    checks,
    events,
    selectedEventId,
    geometry,
  };
}

function baseEvidenceChecks(checkpoint: JobCheckpoint): ReadonlyArray<CncRecoveryEvidenceCheck> {
  return [
    {
      id: 'acknowledgements',
      label: 'Controller acknowledgements',
      status: 'diagnostic',
      detail: `${checkpoint.ackedLines} of ${checkpoint.sendableLines} lines were acknowledged; this does not prove physical execution.`,
    },
    {
      id: 'semantic-line-map',
      label: 'Semantic line map and exact package',
      status: 'missing',
      detail: 'The interrupted checkpoint predates an emitter-owned event-to-line sidecar.',
    },
    {
      id: 'execution-fence',
      label: 'Controller execution fence',
      status: 'missing',
      detail: 'No controller-owned proof identifies the last physically completed contour segment.',
    },
    {
      id: 'machine-state',
      label: 'Position, spindle, tool, and workholding',
      status: 'missing',
      detail: 'No retained-session proof, physical RPM feedback, or inspection record is attached.',
    },
    {
      id: 'machine-profile',
      label: 'Hardware-qualified runway profile',
      status: 'missing',
      detail: 'The displayed acceleration and margin are illustrative, not machine qualification.',
    },
  ];
}

function programIdentityCheck(matches: boolean): CncRecoveryEvidenceCheck {
  return {
    id: 'program-identity',
    label: 'Interrupted program identity',
    status: matches ? 'matched' : 'mismatch',
    detail: matches
      ? 'The current project reproduces the checkpointed G-code fingerprint.'
      : 'The current project produces different G-code from the interrupted job.',
  };
}

function unavailable(
  checks: ReadonlyArray<CncRecoveryEvidenceCheck>,
  unavailableReason: string,
): CncRecoveryPreviewModel {
  return {
    canExecute: false,
    unavailableReason,
    checks,
    events: [],
    selectedEventId: null,
    geometry: null,
  };
}

function isPreviewCandidate(event: CncRecoveryEvent): boolean {
  return (
    event.intent === 'cut' &&
    event.recoverySupport === 'runway-v1' &&
    event.source.segmentIndex !== null &&
    event.source.segmentIndex > 0
  );
}

function eventLabel(event: CncRecoveryEvent): string {
  const segment = (event.source.segmentIndex ?? 0) + 1;
  return `${event.operationId} · pass ${event.source.passIndex + 1} · segment ${segment} · ${event.toolKey}`;
}

function selectEventId(
  events: ReadonlyArray<CncRecoveryPreviewEvent>,
  requestedEventId: string | undefined,
): string | null {
  if (requestedEventId !== undefined && events.some(({ id }) => id === requestedEventId)) {
    return requestedEventId;
  }
  return events[0]?.id ?? null;
}
