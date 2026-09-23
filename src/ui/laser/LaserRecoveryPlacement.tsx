// Where a recovered job will land (ADR-341 Amendment 3). Recovery replays the
// saved program in the controller's current work coordinates, so the rest of
// the job lands on the finished part only if the work origin is where it was.
// A controller reset clears a temporary G92 origin, and on Windows opening the
// port can reset an Arduino-class controller, so the review shows the saved and
// current origin side by side and can trace the remaining area. Information
// only: nothing here gates the recovery Start.

import { useState } from 'react';
import type { ExecutionArtifactV1, RecoveryCapsule } from '../state/recovery';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { describeJobOrigin, formatMm } from './job-review/job-review-format';
import {
  remainingRecoveryWorkBounds,
  type RecoveryWorkBounds,
} from './laser-recovery-picker-model';
import { useLaserRecoveryPreviewRoute } from './use-laser-recovery-preview-route';

/** Largest origin difference still read as the same origin (GRBL reports three decimals). */
export const RECOVERY_ORIGIN_TOLERANCE_MM = 0.05;

export type LaserRecoveryPlacementProps = {
  readonly capsule: RecoveryCapsule;
  /** The controller's current work offset in mm; null until it is reported. */
  readonly liveWorkOffsetMm: WorkCoordinateOffset | null | undefined;
  readonly restartLine: number | undefined;
  readonly disabled: boolean;
  readonly onFrameRemaining?: (bounds: RecoveryWorkBounds) => Promise<void>;
};

export function LaserRecoveryPlacement(props: LaserRecoveryPlacementProps): JSX.Element {
  const artifact = props.capsule.artifact;
  const saved = artifact.kind === 'exact-execution' ? savedWorkOffsetMm(artifact) : null;
  const live = props.liveWorkOffsetMm ?? null;
  return (
    <section aria-labelledby="laser-recovery-placement-title" style={sectionStyle}>
      <h3 id="laser-recovery-placement-title" style={titleStyle}>
        Placement and work origin
      </h3>
      <dl style={listStyle}>
        <Row label="Placement">{describeJobOrigin(artifact.jobOrigin)}</Row>
        <Row label="Origin then">
          {artifact.kind === 'exact-execution'
            ? describeOffset(saved, 'Not reported when the job started')
            : 'Not saved in this older record'}
        </Row>
        <Row label="Origin now">
          {describeOffset(
            live,
            'Not reported yet. Connect the controller and wait for its position.',
          )}
        </Row>
      </dl>
      <OriginComparison saved={saved} live={live} />
      {artifact.kind === 'exact-execution' && props.onFrameRemaining !== undefined ? (
        <FrameRemaining
          key={artifact.runId}
          artifact={artifact}
          restartLine={props.restartLine}
          disabled={props.disabled}
          onFrame={props.onFrameRemaining}
        />
      ) : null}
    </section>
  );
}

function OriginComparison(props: {
  readonly saved: WorkCoordinateOffset | null;
  readonly live: WorkCoordinateOffset | null;
}): JSX.Element | null {
  if (props.saved === null || props.live === null) return null;
  const dx = props.live.x - props.saved.x;
  const dy = props.live.y - props.saved.y;
  if (
    Math.abs(dx) <= RECOVERY_ORIGIN_TOLERANCE_MM &&
    Math.abs(dy) <= RECOVERY_ORIGIN_TOLERANCE_MM
  ) {
    return (
      <p role="status" style={noteStyle}>
        The work origin matches the one this job ran with.
      </p>
    );
  }
  return (
    <p role="note" style={warningStyle}>
      The work origin has moved X {formatOriginMm(dx)} mm, Y {formatOriginMm(dy)} mm since this job
      ran. Recovery replays the saved program from the current origin, so the rest of the job would
      land that far from the finished part. Set the origin back first. A controller reset clears a
      temporary origin; if the machine homes, home it before setting the origin again.
    </p>
  );
}

function FrameRemaining(props: {
  readonly artifact: ExecutionArtifactV1;
  readonly restartLine: number | undefined;
  readonly disabled: boolean;
  readonly onFrame: (bounds: RecoveryWorkBounds) => Promise<void>;
}): JSX.Element {
  const preview = useLaserRecoveryPreviewRoute(props.artifact);
  const [framing, setFraming] = useState(false);
  const bounds =
    preview.route === null || props.restartLine === undefined
      ? null
      : remainingRecoveryWorkBounds(preview.route, props.restartLine);
  const frame = async (): Promise<void> => {
    if (bounds === null || framing) return;
    setFraming(true);
    try {
      await props.onFrame(bounds);
    } finally {
      setFraming(false);
    }
  };
  return (
    <div style={frameRowStyle}>
      <button
        type="button"
        disabled={props.disabled || framing || bounds === null}
        onClick={() => void frame()}
        title="Trace the outline of everything recovery would still engrave from the chosen line, from the current origin, exactly as Frame does. It does not start the job."
      >
        {framing ? 'Framing…' : 'Frame remaining area'}
      </button>
      <span style={noteStyle}>
        {bounds === null
          ? 'The outline appears when the saved route is ready.'
          : `From line ${props.restartLine ?? ''}: X ${formatMm(bounds.minX)} to ${formatMm(bounds.maxX)}, Y ${formatMm(bounds.minY)} to ${formatMm(bounds.maxY)} mm.`}
      </span>
    </div>
  );
}

/** Origins in hundredths of a millimetre, finer than the 0.05 mm tolerance. */
function formatOriginMm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

/** The work offset observed when the run was archived, in mm. */
function savedWorkOffsetMm(artifact: ExecutionArtifactV1): WorkCoordinateOffset | null {
  const observation = artifact.archivedControllerObservation;
  const wco = observation.wco ?? null;
  if (wco === null) return null;
  const scale = observation.settings?.reportInches === true ? 25.4 : 1;
  return { x: wco.x * scale, y: wco.y * scale, z: wco.z * scale };
}

function describeOffset(offset: WorkCoordinateOffset | null, missing: string): string {
  return offset === null
    ? missing
    : `X ${formatOriginMm(offset.x)} · Y ${formatOriginMm(offset.y)} mm from machine zero`;
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={rowStyle}>
      <dt style={termStyle}>{props.label}</dt>
      <dd style={descriptionStyle}>{props.children}</dd>
    </div>
  );
}

const sectionStyle: React.CSSProperties = { marginTop: 14 };
const titleStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 5px' };
const listStyle: React.CSSProperties = { margin: 0 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 8,
  padding: '3px 0',
  fontSize: 12,
};
const termStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontWeight: 650 };
const descriptionStyle: React.CSSProperties = { margin: 0, overflowWrap: 'anywhere' };
const noteStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
  margin: '6px 0',
};
const warningStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--lf-warning)',
  margin: '6px 0',
  padding: '5px 9px',
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.45,
};
const frameRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 4,
};
