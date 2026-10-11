import { controller } from '../core/controller';
import { formatDuration } from '../core/numbers';
import { canControl, store } from '../core/store';
import { Canvas } from '../ui/Canvas';
import { useApp } from '../ui/hooks';
import { BrandMark, Icon } from '../ui/icons';
import { Shell, useTheme } from '../ui/Shell';

type Mode = 'inline' | 'fullscreen' | 'pip';

export function McpRoot({ requestMode }: { requestMode: (mode: Mode) => Promise<void> }) {
  const mode = useApp((state) => state.displayMode);
  useTheme();
  if (mode === 'fullscreen') return <Shell phone={null} />;
  if (mode === 'pip') return <PipView onExpand={() => void requestMode('fullscreen')} />;
  return <InlineCard requestMode={requestMode} />;
}

/** Inline: one glanceable card, two actions, no tabs or nested scrolling (host UI guidelines). */
function InlineCard({ requestMode }: { requestMode: (mode: Mode) => Promise<void> }) {
  const workspace = useApp((state) => state.workspace);
  const machine = useApp((state) => state.machine);
  const allowed = useApp(canControl);
  useTheme();
  const machineLabel =
    machine === null
      ? null
      : machine.connection !== 'connected'
        ? 'Machine not connected'
        : machine.job.active
          ? `Running · ${Math.round(machine.job.progressPercent ?? 0)}%`
          : (machine.controllerState ?? 'Connected');
  return (
    <div className="app mcp" style={{ height: 'auto' }}>
      <div className="inline-card">
        <div className="inline-head">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div className="brand-text" style={{ flex: 1 }}>
            <div className="brand-title">
              {workspace === null ? 'KerfDesk' : 'Your KerfDesk workspace'}
            </div>
            <div className="brand-sub">
              {workspace === null
                ? 'Connecting…'
                : `${workspace.mode === 'cnc' ? 'CNC' : 'Laser'} · ${workspace.totalArtwork} items · ${workspace.totalOperations} layers`}
              {workspace?.dirty === true ? ' · unsaved' : ''}
            </div>
          </div>
          {machineLabel === null ? null : (
            <span className={`chip ${machine?.job.active === true ? 'accent' : ''}`}>
              {machineLabel}
            </span>
          )}
        </div>
        <div className="inline-thumb">
          <Canvas interactive={false} />
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              store.set({ tab: 'design' });
              void requestMode('fullscreen');
            }}
          >
            <Icon name="design" size={20} /> Open editor
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              store.set({ tab: 'machine' });
              void requestMode(
                machine?.job.active === true && store.get().availableModes.includes('pip')
                  ? 'pip'
                  : 'fullscreen',
              );
            }}
          >
            <Icon name="machine" size={20} />{' '}
            {allowed && machine?.job.active === true ? 'Watch job' : 'Machine'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Picture-in-picture: progress and Abort while the conversation continues. */
function PipView({ onExpand }: { onExpand: () => void }) {
  const machine = useApp((state) => state.machine);
  const allowed = useApp(canControl);
  const job = machine?.job;
  return (
    <div className="app mcp" style={{ height: 'auto' }}>
      <div className="inline-card">
        <div className="inline-head">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div style={{ flex: 1 }}>
            <div className="brand-title">
              {job?.active === true
                ? `${job.state === 'paused' ? 'Paused' : 'Running'} · ${Math.round(job.progressPercent ?? 0)}%`
                : (machine?.controllerState ?? 'Machine')}
            </div>
            <div className="brand-sub">{formatDuration(job?.remainingSeconds)} left</div>
          </div>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Open the full panel"
            onClick={onExpand}
          >
            <Icon name="fit" />
          </button>
        </div>
        {allowed && machine?.connection === 'connected' ? (
          <button type="button" className="abort-btn" onClick={() => void controller.abort()}>
            <Icon name="stop" size={22} /> Abort
          </button>
        ) : null}
      </div>
    </div>
  );
}
