// JobSafetyControls — prominent Pause / Resume / controller-abort cluster pinned
// to the top Numeric Edits bar during ANY live machine motion, so the operator
// can request a controller abort without hunting through the machine rail
// (which can be collapsed, F12-hidden, or unmounted by a tab switch). Abort is
// the driver-specific reset/de-energize path for a job, probe, home, jog, or
// frame; it is not a physical E-stop and cannot guarantee de-energization.
// Pause/Resume only apply to a streaming job. Renders nothing when nothing is
// moving.
//
// This covers not just streaming jobs but an in-flight probe/home
// (controllerOperation) and jog/frame (motionOperation) — a probe cycle
// previously had no reachable software abort (G41/F63/F86).

import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { cncResumeBlockMessage } from '../state/cnc-pause-resume-policy';
import { SOFTWARE_ABORT_LABEL, SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';

const PAUSE_TITLE =
  'Feed hold — pause motion now. Buffered moves may finish; use the physical E-stop if unsafe.';
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
  // or a jog/frame — must expose the controller abort here.
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
        style={abortBtnStyle}
        onClick={() => void stopJob().catch(() => undefined)}
        title={SOFTWARE_ABORT_TITLE}
      >
        {SOFTWARE_ABORT_LABEL}
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
const abortBtnStyle: React.CSSProperties = {
  minHeight: 30,
  paddingInline: 14,
  fontWeight: 800,
  letterSpacing: 0.5,
};
