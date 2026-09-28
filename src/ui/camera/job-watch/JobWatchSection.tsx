// JobWatchSection — the Camera panel's Watch the job section (ADR-490):
// record a timelapse of each job, and check a finished laser job's burn
// against its path. Both are remembered per computer; while either is on the
// camera keeps running with the panel closed, so it is there when a job starts.

import { noteStyle, rowStyle, sectionStyle } from '../panel/panel-styles';
import { BurnCheckResult } from './BurnCheckResult';
import { TIMELAPSE_INTERVALS_SECONDS } from './job-watch-settings';
import { useJobWatchStore } from './job-watch-store';
import { TimelapseResult } from './TimelapseResult';

export function JobWatchSection(): JSX.Element {
  const settings = useJobWatchStore((s) => s.settings);
  const setSettings = useJobWatchStore((s) => s.setSettings);
  const timelapse = useJobWatchStore((s) => s.timelapse);
  const burnCheck = useJobWatchStore((s) => s.burnCheck);

  return (
    <section style={sectionStyle} aria-label="Watch the job">
      <strong style={titleStyle}>Watch the job</strong>
      <div style={rowStyle}>
        <label style={checkStyle}>
          <input
            type="checkbox"
            checked={settings.timelapse}
            title="Keep a picture every few seconds while a job runs, and one of the result, to play back or save as a video."
            onChange={(event) => setSettings({ timelapse: event.target.checked })}
          />
          Record a timelapse
        </label>
        <label style={checkStyle}>
          every
          <select
            aria-label="Timelapse interval"
            title="How often the timelapse keeps a picture. A long job keeps at most 480, spaced evenly over the whole job."
            value={settings.intervalSeconds}
            disabled={!settings.timelapse}
            onChange={(event) => setSettings({ intervalSeconds: Number(event.target.value) })}
          >
            {TIMELAPSE_INTERVALS_SECONDS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={settings.burnCheck}
          title="Compare pictures from before and after a laser job with its path, and mark where the camera saw no change."
          onChange={(event) => setSettings({ burnCheck: event.target.checked })}
        />
        Check the burn when a laser job finishes
      </label>
      {settings.timelapse || settings.burnCheck ? (
        <p style={noteStyle}>
          The camera stays on while these are ticked. Pictures are taken wherever the head is;
          nothing moves the machine.
          {settings.burnCheck
            ? ' The burn check needs a camera fixed over the bed and calibrated.'
            : ''}
        </p>
      ) : null}
      {timelapse !== null ? <TimelapseResult timelapse={timelapse} /> : null}
      <BurnCheckResult view={burnCheck} />
    </section>
  );
}

const titleStyle: React.CSSProperties = { fontSize: 12 };
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
