import { useMemo, useState } from 'react';
import { Button } from '../kit';
import { settingsNoteStyle } from '../settings/settings-styles';
import { getAgedRemoteAccessStatus } from './remote-access-store';
import { oneTimePairingLink, pairingExpiryLabel, pairingQr } from './pairing-link';

export function PairingLinkCard({
  link,
  expiresInMs,
}: {
  readonly link: string;
  readonly expiresInMs: number;
}): JSX.Element {
  const qr = useMemo(() => pairingQr(link), [link]);
  return (
    <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
      {qr === null ? (
        <p style={settingsNoteStyle}>Copy the pairing link to open it on your phone.</p>
      ) : (
        <svg
          role="img"
          aria-label="One-time pairing QR code"
          width="224"
          height="224"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          style={{ maxWidth: '100%', height: 'auto' }}
          shapeRendering="crispEdges"
        >
          {/* The encoded symbol stays black on white in either theme for scanning. */}
          <rect width={qr.size} height={qr.size} fill="white" />
          <path d={qr.path} fill="black" />
        </svg>
      )}
      <p style={settingsNoteStyle}>
        Expires in <strong>{pairingExpiryLabel(expiresInMs)}</strong>. Works once.
      </p>
      <p style={settingsNoteStyle}>
        Scan with your phone’s camera, request access on the phone, then approve it on this PC.
      </p>
      <PairingLinkActions key={link} link={link} />
    </div>
  );
}

function PairingLinkActions({ link }: { readonly link: string }): JSX.Element {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = (): boolean => oneTimePairingLink(getAgedRemoteAccessStatus()) === link;
  const transfer = async (share: boolean): Promise<void> => {
    if (!current()) {
      setResult('This link is unavailable. Create a new pairing link.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      if (share) await navigator.share({ title: 'Pair with KerfDesk', url: link });
      else await navigator.clipboard.writeText(link);
      setResult(share ? 'Share sheet opened.' : 'Copied. Open this link on your phone.');
    } catch {
      setResult('Sharing is unavailable. Scan the QR code or use manual setup below.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button disabled={busy} onClick={() => void transfer(false)}>
          Copy pairing link
        </Button>
        {typeof navigator.share === 'function' ? (
          <Button disabled={busy} onClick={() => void transfer(true)}>
            Share pairing link
          </Button>
        ) : null}
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (!current()) {
              event.preventDefault();
              setResult('This link is unavailable. Create a new pairing link.');
            }
          }}
        >
          Open pairing link
        </a>
      </div>
      {result === null ? null : (
        <p role="status" style={settingsNoteStyle}>
          {result}
        </p>
      )}
    </div>
  );
}
