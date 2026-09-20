import { useLaserStore } from '../state/laser-store';
import { JobActionControls } from './JobActionControls';
import { StartBlockerNotice } from './StartBlockerNotice';
import { jobControlsBusy } from './job-controls-busy';
import { runStartJobFlow } from './start-job-flow';
import './WorkspaceJobActions.css';

/** Mount once outside the sidebar scroller so Frame/Start stay reachable in either tab. */
export function WorkspaceJobActions(): JSX.Element {
  const disabled = useLaserStore((s) => s.connection.kind !== 'connected' || s.autofocusBusy);
  const busy = useLaserStore((s) =>
    jobControlsBusy(s.streamer?.status, s.motionOperation, s.controllerOperation),
  );
  return (
    <section className="lf-workspace-job-actions" aria-label="Job actions">
      <JobActionControls
        docked
        disabled={disabled}
        streaming={busy}
        onStartJob={() => void runStartJobFlow()}
      />
      <div className="lf-job-dock__notices">
        <StartBlockerNotice />
      </div>
    </section>
  );
}
