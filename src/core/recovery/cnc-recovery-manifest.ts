import type { CncGroup, CncPass, Job } from '../job';
import type { CncCutType } from '../scene';

export const CNC_RECOVERY_MANIFEST_SCHEMA_VERSION = 1;

export type CncRecoveryIntent = 'clearance' | 'entry' | 'cut' | 'exit';
export type CncRecoverySupport = 'runway-v1' | 'manual-only';

export type CncRecoveryEvent = {
  readonly id: string;
  readonly operationId: string;
  readonly passId: string;
  readonly intent: CncRecoveryIntent;
  readonly recoverySupport: CncRecoverySupport;
  readonly toolKey: string;
  readonly source: {
    readonly groupIndex: number;
    readonly passIndex: number;
    readonly segmentIndex: number | null;
    readonly passKind: CncPass['kind'];
  };
};

export type CncRecoveryEventManifest = {
  readonly schemaVersion: typeof CNC_RECOVERY_MANIFEST_SCHEMA_VERSION;
  readonly events: ReadonlyArray<CncRecoveryEvent>;
};

export type CncRecoveryLineSpan = {
  readonly eventId: string;
  readonly firstRawLine: number;
  readonly lastRawLine: number;
};

export type CncRecoveryLineMapResult =
  | { readonly kind: 'ok'; readonly spans: ReadonlyArray<CncRecoveryLineSpan> }
  | {
      readonly kind: 'error';
      readonly reason:
        | 'invalid-line-count'
        | 'invalid-manifest-schema'
        | 'invalid-span'
        | 'unknown-event'
        | 'overlap'
        | 'missing-cut-event';
    };

const RUNWAY_V1_CUT_TYPES: ReadonlyArray<CncCutType> = [
  'profile-outside',
  'profile-inside',
  'profile-on-path',
  'pocket',
  'engrave',
];

/** Builds semantic identities only; it does not make any execution claim. */
export function buildCncRecoveryEventManifest(job: Job): CncRecoveryEventManifest {
  const events: CncRecoveryEvent[] = [];
  const canUseSingleToolRunway = jobAllowsSingleToolRunway(job);
  let operationNumber = 0;
  for (let groupIndex = 0; groupIndex < job.groups.length; groupIndex += 1) {
    const group = job.groups[groupIndex];
    if (group?.kind !== 'cnc') continue;
    operationNumber += 1;
    const operationId = `cnc-op-${operationNumber}`;
    const toolKey = group.toolId ?? `diameter-${formatIdentityNumber(group.toolDiameterMm)}`;
    for (let passIndex = 0; passIndex < group.passes.length; passIndex += 1) {
      const pass = group.passes[passIndex];
      if (pass === undefined) continue;
      const canUseRunway = canUseSingleToolRunway && RUNWAY_V1_CUT_TYPES.includes(group.cutType);
      events.push(
        ...eventsForPass(operationId, toolKey, groupIndex, passIndex, pass, canUseRunway),
      );
    }
  }
  return { schemaVersion: CNC_RECOVERY_MANIFEST_SCHEMA_VERSION, events };
}

/** Validates a future emitter-provided raw-line sidecar without interpreting G-code. */
export function validateCncRecoveryLineSpans(
  manifest: CncRecoveryEventManifest,
  spans: ReadonlyArray<CncRecoveryLineSpan>,
  rawLineCount: number,
): CncRecoveryLineMapResult {
  if (manifest.schemaVersion !== CNC_RECOVERY_MANIFEST_SCHEMA_VERSION) {
    return { kind: 'error', reason: 'invalid-manifest-schema' };
  }
  if (!Number.isInteger(rawLineCount) || rawLineCount < 1) {
    return { kind: 'error', reason: 'invalid-line-count' };
  }
  const eventIds = new Set(manifest.events.map((event) => event.id));
  const ordered = [...spans].sort((a, b) => a.firstRawLine - b.firstRawLine);
  const mappedEventIds = new Set<string>();
  let previousLastLine = 0;
  for (const span of ordered) {
    if (!eventIds.has(span.eventId)) return { kind: 'error', reason: 'unknown-event' };
    if (!isValidSpan(span, rawLineCount)) return { kind: 'error', reason: 'invalid-span' };
    if (span.firstRawLine <= previousLastLine) return { kind: 'error', reason: 'overlap' };
    mappedEventIds.add(span.eventId);
    previousLastLine = span.lastRawLine;
  }
  if (manifest.events.some((event) => event.intent === 'cut' && !mappedEventIds.has(event.id))) {
    return { kind: 'error', reason: 'missing-cut-event' };
  }
  return { kind: 'ok', spans: ordered };
}

function eventsForPass(
  operationId: string,
  toolKey: string,
  groupIndex: number,
  passIndex: number,
  pass: CncPass,
  canUseRunway: boolean,
): ReadonlyArray<CncRecoveryEvent> {
  const passId = `${operationId}/pass-${passIndex + 1}`;
  const fixedSource = { groupIndex, passIndex, segmentIndex: null, passKind: pass.kind };
  const fixedEvent = (intent: 'clearance' | 'entry' | 'exit'): CncRecoveryEvent => ({
    id: `${passId}/${intent}`,
    operationId,
    passId,
    intent,
    recoverySupport: 'manual-only',
    toolKey,
    source: fixedSource,
  });
  const cutEvents = Array.from({ length: cutSegmentCount(pass) }, (_, segmentIndex) => ({
    id: `${passId}/cut-${segmentIndex + 1}`,
    operationId,
    passId,
    intent: 'cut' as const,
    recoverySupport: recoverySupport(pass, canUseRunway),
    toolKey,
    source: { groupIndex, passIndex, segmentIndex, passKind: pass.kind },
  }));
  return [fixedEvent('clearance'), fixedEvent('entry'), ...cutEvents, fixedEvent('exit')];
}

function recoverySupport(pass: CncPass, canUseRunway: boolean): CncRecoverySupport {
  if (!canUseRunway) return 'manual-only';
  return pass.kind === 'contour' ? 'runway-v1' : 'manual-only';
}

function cutSegmentCount(pass: CncPass): number {
  if (pass.kind === 'contour') return Math.max(0, pass.polyline.length - 1);
  if (pass.kind === 'path3d') return Math.max(0, pass.points.length - 1);
  return 1;
}

function jobAllowsSingleToolRunway(job: Job): boolean {
  const cncGroups: CncGroup[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') return false;
    cncGroups.push(group);
  }
  if (cncGroups.length === 0) return false;
  const toolKeys = new Set(cncGroups.map(physicalToolKey));
  return toolKeys.size === 1;
}

function physicalToolKey(group: CncGroup): string {
  const diameter = formatIdentityNumber(group.toolDiameterMm);
  return group.toolId === undefined
    ? `diameter-${diameter}`
    : `${group.toolId}/diameter-${diameter}`;
}

function isValidSpan(span: CncRecoveryLineSpan, rawLineCount: number): boolean {
  return (
    Number.isInteger(span.firstRawLine) &&
    Number.isInteger(span.lastRawLine) &&
    span.firstRawLine >= 1 &&
    span.lastRawLine >= span.firstRawLine &&
    span.lastRawLine <= rawLineCount
  );
}

function formatIdentityNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'invalid';
}
