import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { controller } from './core/controller';
import { PhoneTransport, readSession } from './core/phone-transport';
import { store } from './core/store';
import type { PhoneSession } from './core/types';
import { BrandMark } from './ui/icons';
import { fragmentPairing, Pairing } from './ui/Pairing';
import { Shell, useTheme } from './ui/Shell';
import './ui/app.css';

function savedTheme(): 'system' | 'light' | 'dark' {
  try {
    const value = localStorage.getItem('kd-theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function PhoneApp() {
  const [phase, setPhase] = useState<'loading' | 'pair' | 'ready'>('loading');
  const [transport, setTransport] = useState<PhoneTransport | null>(null);
  useTheme();

  const begin = useCallback((session: PhoneSession) => {
    store.reset({
      host: 'phone',
      displayMode: 'fullscreen',
      theme: savedTheme(),
      session,
      scopes: session.client.scopes,
      pcOnline: session.online,
    });
    const next = new PhoneTransport(session, () => {
      controller.stop();
      store.reset({ theme: savedTheme() });
      setTransport(null);
      setPhase('pair');
    });
    controller.start(next);
    setTransport(next);
    setPhase('ready');
  }, []);

  useEffect(() => {
    store.set({ theme: savedTheme() });
    // A freshly scanned link always shows pairing, even on a phone that is already paired.
    if (fragmentPairing(location.hash) !== null) {
      setPhase('pair');
      return;
    }
    void readSession().then(
      (state) => (state.status === 'approved' ? begin(state.session) : setPhase('pair')),
      () => setPhase('pair'),
    );
  }, [begin]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void readSession()
        .then((state) => {
          if (state.status === 'approved') {
            transport?.updateSession(state.session);
            store.set({
              session: state.session,
              scopes: state.session.client.scopes,
              pcOnline: state.session.online,
            });
          } else {
            controller.stop();
            transport?.close();
            setPhase('pair');
          }
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [phase, transport]);

  if (phase === 'loading')
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="brand-mark" style={{ width: 56, height: 56, borderRadius: 16 }}>
          <BrandMark size={30} />
        </span>
      </div>
    );
  if (phase === 'pair') return <Pairing onApproved={begin} />;
  return <Shell phone={transport} />;
}

const element = document.getElementById('root');
if (element !== null)
  createRoot(element).render(
    <StrictMode>
      <PhoneApp />
    </StrictMode>,
  );

if ('serviceWorker' in navigator)
  void navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => undefined);
