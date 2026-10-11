import { useEffect, useState } from 'react';
import { store } from '../core/store';
import type { PhoneTransport } from '../core/phone-transport';
import { useApp } from './hooks';
import { Icon } from './icons';
import { Banner, Segmented, Toggle } from './primitives';

const MCP_URL = 'https://kerfdesk-phone-control.cisgz3a.workers.dev/mcp';
type InstallPrompt = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
});

export function MoreScreen({ phone }: { phone: PhoneTransport | null }) {
  const session = useApp((state) => state.session);
  const scopes = useApp((state) => state.scopes);
  const online = useApp((state) => state.pcOnline);
  const socket = useApp((state) => state.socket);
  const theme = useApp((state) => state.theme);
  const host = useApp((state) => state.host);
  const [copied, setCopied] = useState(false);
  return (
    <div className="screen">
      <div className="stack">
        <h1 className="screen-title">{host === 'mcp' ? 'Settings' : 'More'}</h1>
        <div className="card">
          <div className="card-title">
            <Icon name="machine" size={20} /> {session?.deviceLabel ?? 'KerfDesk computer'}
            <span className="spacer" />
            <span className={`chip ${online ? 'success' : 'danger'}`}>
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          {session === null ? null : (
            <p className="muted small" style={{ margin: 0 }}>
              This phone: {session.client.label}
              {socket ? ' · live' : ''}
            </p>
          )}
          <div className="btn-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="chip success">View</span>
            <span className={`chip ${scopes.includes('edit') ? 'success' : ''}`}>
              {scopes.includes('edit') ? 'Edit' : 'No editing'}
            </span>
            <span className={`chip ${scopes.includes('control') ? 'success' : ''}`}>
              {scopes.includes('control') ? 'Machine control' : 'No machine control'}
            </span>
          </div>
          <p className="note">
            Access is chosen on the PC. To change it, revoke this connection there and pair again.
          </p>
        </div>
        <div className="card">
          <div className="card-title">Appearance</div>
          <Segmented
            label="Theme"
            value={theme}
            options={[
              { value: 'system', label: host === 'mcp' ? 'Match app' : 'Automatic' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(value) => {
              store.set({ theme: value });
              try {
                localStorage.setItem('kd-theme', value);
              } catch {
                /* Private browsing. */
              }
            }}
          />
        </div>
        {phone === null ? null : <AlertsCard phone={phone} />}
        {phone === null ? null : <InstallCard />}
        {host === 'phone' ? (
          <div className="card">
            <div className="card-title">
              <Icon name="sparkle" size={20} /> Use KerfDesk in ChatGPT or Claude
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Add this MCP server URL as a custom connector, sign in, then approve it on the PC with
              a new pairing code.
            </p>
            <div className="row" style={{ minHeight: 0, gap: 8 }}>
              <code className="grow" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                {MCP_URL}
              </code>
              <button
                type="button"
                className="btn btn-soft"
                onClick={async () => {
                  await navigator.clipboard?.writeText(MCP_URL).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : null}
        {phone === null ? null : (
          <button
            type="button"
            className="btn btn-block"
            style={{ color: 'var(--danger-fg)' }}
            onClick={async () => {
              await phone.revoke();
              location.replace('/app/');
            }}
          >
            Disconnect this phone
          </button>
        )}
        <p className="note" style={{ textAlign: 'center' }}>
          Requests pass through KerfDesk’s Cloudflare service.{' '}
          <a href="https://kerfdesk.com/privacy/">Privacy</a> ·{' '}
          <a href="/third-party-notices.txt">Notices</a>
        </p>
      </div>
    </div>
  );
}

function AlertsCard({ phone }: { phone: PhoneTransport }) {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  useEffect(() => {
    if (!supported) return;
    void phone.pushKey().then(setKey);
    void navigator.serviceWorker.ready.then(async (registration) =>
      setEnabled((await registration.pushManager.getSubscription()) !== null),
    );
  }, [phone, supported]);
  if (!supported || key === null) return null;
  const toggle = async (next: boolean) => {
    const registration = await navigator.serviceWorker.ready;
    if (!next) {
      const existing = await registration.pushManager.getSubscription();
      await existing?.unsubscribe();
      await phone.savePush(null);
      setEnabled(false);
      return;
    }
    if ((await Notification.requestPermission()) !== 'granted' || key === undefined) return;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64url(key),
    });
    const saved = await phone.savePush(subscription.toJSON());
    setEnabled(saved);
    if (!saved) store.toast('Alerts couldn’t be turned on.', 'error');
  };
  return (
    <div className="card">
      <div className="card-title">
        <Icon name="bell" size={20} /> Job alerts
      </div>
      <Toggle
        label="Tell me when a job finishes or stops"
        checked={enabled}
        disabled={key === undefined}
        onChange={(value) => void toggle(value)}
      />
      <p className="note">Alerts are a convenience. Always watch a running machine.</p>
    </div>
  );
}

function InstallCard() {
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const [prompt, setPrompt] = useState(installPrompt);
  if (standalone) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div className="card">
      <div className="card-title">
        <Icon name="phone" size={20} /> Add to your Home Screen
      </div>
      {prompt !== null ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={async () => {
            await prompt.prompt();
            installPrompt = null;
            setPrompt(null);
          }}
        >
          Install KerfDesk Remote
        </button>
      ) : (
        <Banner tone="info">
          {ios
            ? 'Tap Share, then “Add to Home Screen”.'
            : 'Use your browser menu: “Install app” or “Add to Home screen”.'}
        </Banner>
      )}
    </div>
  );
}

function base64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
