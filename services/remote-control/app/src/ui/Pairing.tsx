import { useEffect, useRef, useState } from 'react';
import decodeQr from '../../../scripts/scanner-decoder-entry.js';
import { claimPairing, readSession, type SessionState } from '../core/phone-transport';
import { RemoteError } from '../core/transport';
import type { PhoneSession, Scope } from '../core/types';
import { useNow } from './hooks';
import { BrandMark, Icon } from './icons';
import { Banner, Toggle } from './primitives';

const PRODUCTION_ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9-]{12,24}$/;

/** Only a canonical KerfDesk pairing link is read. Scanned text is never opened or navigated to. */
export function pairingFromLink(value: string): { device: string; code: string } | null {
  if (value.length > 1024 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    const origin = url.origin === PRODUCTION_ORIGIN || url.origin === location.origin;
    const path = url.pathname === '/control' || url.pathname === '/app/';
    if (!origin || !path || url.search !== '' || url.username !== '' || url.password !== '')
      return null;
    return fragmentPairing(url.hash);
  } catch {
    return null;
  }
}
export function fragmentPairing(hash: string): { device: string; code: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const device = params.get('device') ?? '';
  const code = params.get('code') ?? '';
  return [...params].length === 2 && UUID.test(device) && CODE.test(code) ? { device, code } : null;
}

type Step = 'welcome' | 'scan' | 'details' | 'waiting';

export function Pairing({ onApproved }: { onApproved: (session: PhoneSession) => void }) {
  const initial = useRef(fragmentPairing(location.hash));
  const [step, setStep] = useState<Step>(initial.current === null ? 'welcome' : 'details');
  const [device, setDevice] = useState(
    initial.current?.device ?? new URLSearchParams(location.search).get('deviceId') ?? '',
  );
  const [code, setCode] = useState(initial.current?.code ?? '');
  const [label, setLabel] = useState(defaultLabel());
  const [edit, setEdit] = useState(true);
  const [control, setControl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The one-time code leaves the address bar immediately; it is never stored.
    if (location.hash !== '' || location.search !== '') history.replaceState(null, '', '/app/');
  }, []);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const scopes: Scope[] = [
        'read',
        ...(edit ? (['edit'] as const) : []),
        ...(control ? (['control'] as const) : []),
      ];
      const { expiresInMs } = await claimPairing({
        deviceId: device.trim(),
        code: code.trim(),
        clientLabel: label.trim() || 'Phone',
        requestedScopes: scopes,
      });
      setDeadline(performance.now() + expiresInMs);
      setStep('waiting');
    } catch (failure) {
      setError(failure instanceof RemoteError ? failure.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== 'waiting') return undefined;
    let live = true;
    const tick = async () => {
      if (!live) return;
      let state: SessionState;
      try {
        state = await readSession();
      } catch {
        state = { status: 'pending', expiresInMs: deadline - performance.now() };
      }
      if (!live) return;
      if (state.status === 'approved') onApproved(state.session);
      else if (state.status === 'unavailable' || performance.now() > deadline) {
        setError(
          'The PC didn’t approve this phone, or the code expired. Create a new code on the PC and try again.',
        );
        setStep('details');
      } else setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      live = false;
    };
  }, [step, deadline, onApproved]);

  return (
    <div className="pair">
      <div className="brand" style={{ flex: 'none' }}>
        <span className="brand-mark">
          <BrandMark />
        </span>
        <div className="brand-title">KerfDesk Remote</div>
      </div>
      {step === 'welcome' ? (
        <>
          <div className="pair-hero">
            <div className="pair-art">
              <Illustration />
            </div>
            <h1>Your workshop, in your pocket.</h1>
            <p>
              Edit designs, set up layers and run your machine from this phone. Everything goes
              through KerfDesk on your computer, and nothing happens until you approve this phone
              there.
            </p>
          </div>
          <div className="pair-actions">
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ minHeight: 56 }}
              onClick={() => setStep('scan')}
            >
              <Icon name="qr" /> Scan the code on your PC
            </button>
            <button type="button" className="btn btn-block" onClick={() => setStep('details')}>
              <Icon name="keyboard" /> Enter the code instead
            </button>
            <p className="note" style={{ textAlign: 'center' }}>
              On the PC: KerfDesk → Settings → Phone &amp; MCP → Add a phone.
            </p>
          </div>
        </>
      ) : null}
      {step === 'scan' ? (
        <Scanner
          onCancel={() => setStep('welcome')}
          onFound={(value) => {
            setDevice(value.device);
            setCode(value.code);
            setStep('details');
          }}
        />
      ) : null}
      {step === 'details' ? (
        <div className="stack" style={{ marginTop: 20 }}>
          <h1 className="screen-title" style={{ margin: 0 }}>
            Connect this phone
          </h1>
          {initial.current === null || device === '' ? (
            <>
              <label className="field">
                <span>Computer ID</span>
                <input
                  className="input"
                  value={device}
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setDevice(event.target.value)}
                  placeholder="Shown under Add a phone on the PC"
                />
              </label>
              <label className="field">
                <span>Pairing code</span>
                <input
                  className="input"
                  value={code}
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Exactly as shown, with capitals"
                />
              </label>
            </>
          ) : (
            <Banner tone="success">
              <Icon name="check" /> Code read from your PC.
            </Banner>
          )}
          <label className="field">
            <span>Name this phone</span>
            <input
              className="input"
              value={label}
              maxLength={64}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <div className="card access">
            <div className="card-title">What should this phone be able to do?</div>
            <Toggle
              label="See the workspace"
              hint="Always on. Shows artwork, layers and machine status."
              checked
              disabled
              onChange={() => undefined}
            />
            <Toggle
              label="Edit artwork and layers"
              hint="Move, draw, add text, change power and speed."
              checked={edit}
              onChange={setEdit}
            />
            <Toggle
              label="Control the machine"
              hint="Jog, home, Frame, Start, Pause and Abort. The machine will move."
              checked={control}
              onChange={setControl}
            />
          </div>
          {error === null ? null : <Banner tone="danger">{error}</Banner>}
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ minHeight: 56 }}
            disabled={busy || !UUID.test(device.trim()) || !CODE.test(code.trim())}
            onClick={() => void request()}
          >
            {busy ? <span className="spinner" /> : null} Ask the PC for approval
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setStep('welcome')}>
            Back
          </button>
        </div>
      ) : null}
      {step === 'waiting' ? (
        <Waiting deadline={deadline} onCancel={() => setStep('details')} />
      ) : null}
    </div>
  );
}

function Waiting({ deadline, onCancel }: { deadline: number; onCancel: () => void }) {
  useNow(500);
  const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  return (
    <div className="waiting">
      <div className="pulse">
        <Icon name="machine" size={56} />
      </div>
      <h1 className="screen-title" style={{ margin: 0 }}>
        Approve on your PC
      </h1>
      <p className="muted" style={{ maxWidth: 320, margin: 0 }}>
        KerfDesk on your computer is asking whether to allow this phone. Choose the access you want
        there.
      </p>
      <div className="countdown" aria-live="off">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </div>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Scanner({
  onFound,
  onCancel,
}: {
  onFound: (value: { device: string; code: string }) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    const detector =
      'BarcodeDetector' in window
        ? new (
            window as unknown as {
              BarcodeDetector: new (o: object) => {
                detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
              };
            }
          ).BarcodeDetector({ formats: ['qr_code'] })
        : null;
    const canvas = document.createElement('canvas');
    const read = async () => {
      const element = video.current;
      if (!live || element === null || element.readyState < 2) {
        timer = setTimeout(() => void read(), 200);
        return;
      }
      let text: string | null = null;
      try {
        if (detector !== null) text = (await detector.detect(element))[0]?.rawValue ?? null;
        else {
          const scale = Math.min(1, 720 / Math.max(element.videoWidth, element.videoHeight));
          canvas.width = Math.round(element.videoWidth * scale);
          canvas.height = Math.round(element.videoHeight * scale);
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context?.drawImage(element, 0, 0, canvas.width, canvas.height);
          const pixels = context?.getImageData(0, 0, canvas.width, canvas.height);
          text =
            pixels === undefined
              ? null
              : (decodeQr(pixels.data, pixels.width, pixels.height)?.data ?? null);
        }
      } catch {
        text = null;
      }
      const found = text === null ? null : pairingFromLink(text);
      if (found !== null) {
        navigator.vibrate?.(20);
        onFound(found);
        return;
      }
      if (text !== null) setProblem('That isn’t a KerfDesk pairing code.');
      timer = setTimeout(() => void read(), 200);
    };
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((value) => {
        if (!live) {
          value.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = value;
        if (video.current !== null) {
          video.current.srcObject = value;
          void video.current.play();
        }
        void read();
      })
      .catch(() => setProblem('The camera isn’t available. Enter the code instead.'));
    const stop = () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    document.addEventListener('visibilitychange', stop, { once: true });
    return stop;
  }, [onFound]);
  return (
    <div className="stack" style={{ marginTop: 20 }}>
      <h1 className="screen-title" style={{ margin: 0 }}>
        Point at the QR code
      </h1>
      <div className="scanner">
        <video ref={video} muted playsInline />
        <div className="frame" />
      </div>
      {problem === null ? (
        <p className="note">Images stay on this phone; only the code is read.</p>
      ) : (
        <Banner tone="warning">{problem}</Banner>
      )}
      <button type="button" className="btn btn-block" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function defaultLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Phone';
}

function Illustration() {
  return (
    <svg width="220" height="130" viewBox="0 0 220 130" aria-hidden="true">
      <rect
        x="10"
        y="18"
        width="128"
        height="82"
        rx="8"
        fill="var(--surface)"
        stroke="var(--border-strong)"
      />
      <rect x="20" y="28" width="108" height="62" rx="4" fill="var(--well)" />
      <path d="M38 76l18-26 14 18 10-12 20 20z" fill="var(--accent)" opacity=".8" />
      <rect x="58" y="104" width="32" height="6" rx="3" fill="var(--border-strong)" />
      <rect
        x="156"
        y="30"
        width="54"
        height="92"
        rx="12"
        fill="var(--surface)"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <rect x="163" y="42" width="40" height="56" rx="4" fill="var(--accent-tint)" />
      <path d="M170 82l9-12 7 8 5-6 9 10z" fill="var(--accent)" />
      <path
        d="M140 60c6-10 10-10 14 0"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeDasharray="3 4"
      />
    </svg>
  );
}
