// JobSafetyControls — prominent Pause / Resume / Emergency-Stop cluster pinned
// to the top Numeric Edits bar during ANY live machine motion, so the operator
// can hold or kill it without hunting through the machine rail (which can be
// collapsed, F12-hidden, or unmounted by a tab switch). E-STOP is a GRBL soft
// reset (Ctrl-X) that aborts the job, probe, home, jog, or frame and forces the
// beam/spindle off — the one control that must always be reachable. Pause/Resume
// only apply to a streaming job. Renders nothing when nothing is moving.
//
// This covers not just streaming jobs but an in-flight probe/home
// (controllerOperation) and jog/frame (motionOperation) — a probe cycle
// previously had no software stop at all (G41/F63/F86).

import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { cncResumeBlockMessage } from '../state/cnc-pause-resume-policy';

const ESTOP_TITLE =
  'Emergency stop: soft-reset the controller (Ctrl-X) and force the beam or spindle off immediately.';
const PAUSE_TITLE =
  'Feed hold — pause motion now. Buffered moves may finish; use E-STOP if unsafe.';
const RESUME_TITLE = 'Release the feed hold and continue the job.';

export function JobSafetyControls(): JSX.Element | null {
  const streamer = useLaserStore((s) => s.streamer);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const pauseJob = useLaserStore((s) => s.pauseJob);
  const resumeJob = useLaserStore((s) => s.resumeJob);
  const stopJob = useLaserStore((s) => s.stopJob);
  const activeJobMachineKind = useLaserStore((s) => s.activeJobMachineKind);
  // Any live motion — a streaming/held job, a probe/home controller operation,
  // or a jog/frame — must expose the E-STOP here.
  const liveMotion =
    isActiveJob(streamer) || controllerOperation !== null || motionOperation !== null;
  if (!liveMotion) return null;
  // Resume honours the same CNC recovery gate as the in-rail control: a router
  // job that lost proof the spindle kept turning must not silently resume.
  const resumeBlockMessage = cncResumeBlockMessage(activeJobMachineKind);
  return (
    <div role="group" aria-label="Job safety controls" style={clusterStyle}>
      {streamer?.status === 'streaming' && (
        <button
          type="button"
          className="lf-btn"
          style={holdBtnStyle}
          onClick={() => void pauseJob().catch(() => undefined)}
          title={PAUSE_TITLE}
        >
          Pause
        </button>
      )}
      {streamer?.status === 'paused' && (
        <button
          type="button"
          className="lf-btn"
          style={holdBtnStyle}
          disabled={resumeBlockMessage !== null}
          onClick={() => void resumeJob().catch(() => undefined)}
          title={resumeBlockMessage ?? RESUME_TITLE}
        >
          Resume
        </button>
      )}
      <button
        type="button"
        className="lf-btn lf-btn--danger"
        style={estopBtnStyle}
        onClick={() => void stopJob().catch(() => undefined)}
        title={ESTOP_TITLE}
      >
        E-STOP
      </button>
    </div>
  );
}

const clusterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};
const holdBtnStyle: React.CSSProperties = {
  minHeight: 30,
  fontWeight: 700,
};
const estopBtnStyle: React.CSSProperties = {
  minHeight: 30,
  paddingInline: 14,
  fontWeight: 800,
  letterSpacing: 0.5,
};
