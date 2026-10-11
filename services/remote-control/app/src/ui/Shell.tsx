import { useEffect } from 'react';
import type { PhoneTransport } from '../core/phone-transport';
import { store, type Tab } from '../core/store';
import { DesignScreen } from './DesignScreen';
import { useApp } from './hooks';
import { BrandMark, Icon, type IconName } from './icons';
import { LayersScreen } from './LayersScreen';
import { AbortDock, MachineScreen } from './MachineScreen';
import { MoreScreen } from './MoreScreen';

export function useTheme(): void {
  const theme = useApp((state) => state.theme);
  const hostTheme = useApp((state) => state.hostTheme);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        theme === 'system' ? (hostTheme ?? (media.matches ? 'dark' : 'light')) : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#1c1a18' : '#ffffff');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, hostTheme]);
}

const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'design', label: 'Design', icon: 'design' },
  { tab: 'layers', label: 'Layers', icon: 'layers' },
  { tab: 'machine', label: 'Machine', icon: 'machine' },
  { tab: 'more', label: 'More', icon: 'more' },
];

export function Shell({ phone }: { phone: PhoneTransport | null }) {
  const tab = useApp((state) => state.tab);
  const host = useApp((state) => state.host);
  useTheme();
  return (
    <div className={`app ${host}`}>
      <TopBar />
      {tab === 'design' ? (
        <DesignScreen />
      ) : tab === 'layers' ? (
        <LayersScreen />
      ) : tab === 'machine' ? (
        <MachineScreen />
      ) : (
        <MoreScreen phone={phone} />
      )}
      <AbortDock />
      <TabBar />
      <Toasts />
    </div>
  );
}

function TopBar() {
  const workspace = useApp((state) => state.workspace);
  const online = useApp((state) => state.pcOnline);
  const socket = useApp((state) => state.socket);
  const host = useApp((state) => state.host);
  const pending = useApp((state) => state.pending > 0);
  const status = !online
    ? ['off', 'PC offline']
    : host === 'mcp' || socket
      ? ['live', 'Live with your PC']
      : ['warn', 'Connected · checking for changes'];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <div className="brand-text">
          <div className="brand-title">
            {workspace?.dirty === true ? (
              <span className="unsaved" title="Unsaved changes" />
            ) : null}{' '}
            {workspace === null
              ? 'KerfDesk'
              : workspace.name === 'Current workspace'
                ? 'Your workspace'
                : workspace.name}
          </div>
          <div className="brand-sub">
            <span className={`dot ${status[0]}`} />
            {status[1]}
            {workspace === null
              ? null
              : ` · ${workspace.mode === 'cnc' ? 'CNC' : 'Laser'} · ${workspace.totalArtwork} item${workspace.totalArtwork === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>
      {pending ? (
        <span
          className="spinner"
          aria-label="Sending to the PC"
          style={{ color: 'var(--accent-fg)' }}
        />
      ) : null}
    </header>
  );
}

function TabBar() {
  const tab = useApp((state) => state.tab);
  const host = useApp((state) => state.host);
  const running = useApp((state) => state.machine?.job.active === true);
  const alarm = useApp((state) => /alarm/i.test(state.machine?.controllerState ?? ''));
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((item) => (
        <button
          key={item.tab}
          type="button"
          className="tab"
          aria-current={tab === item.tab ? 'page' : undefined}
          onClick={() => store.set({ tab: item.tab, sheet: null })}
        >
          <span className="tab-icon">
            <Icon name={item.tab === 'more' && host === 'mcp' ? 'props' : item.icon} />
          </span>
          {item.tab === 'more' && host === 'mcp' ? 'Settings' : item.label}
          {item.tab === 'machine' && (running || alarm) ? (
            <span
              className="tab-badge"
              style={{ background: alarm ? 'var(--danger)' : 'var(--accent)' }}
            />
          ) : null}
        </button>
      ))}
    </nav>
  );
}

function Toasts() {
  const toasts = useApp((state) => state.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
