import { useContext, useEffect, useState } from 'react';
import { DesktopDownloadContext, type DesktopDownloadResult } from './desktop-download-context';
import { Dialog } from '../kit';
import './desktop-welcome.css';

type DownloadState = DesktopDownloadResult | { readonly status: 'loading' };

export function DesktopWelcomeDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const [download, setDownload] = useState<DownloadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const resolveDownload = useContext(DesktopDownloadContext);
  useEffect(() => {
    const controller = new AbortController();
    setDownload({ status: 'loading' });
    void resolveDownload({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setDownload(result);
    });
    return () => controller.abort();
  }, [attempt, resolveDownload]);

  return (
    <Dialog
      ariaLabel="Choose your KerfDesk workspace"
      size="xl"
      panelClassName="lf-desktop-welcome"
      initialFocus="surface"
      onClose={onClose}
    >
      <aside className="lf-desktop-welcome__art" aria-label="KerfDesk: made for makers">
        <img src="/startup-craft.webp" alt="" />
        <div className="lf-desktop-welcome__wordmark">
          Kerf<span>Desk</span>
        </div>
        <div className="lf-desktop-welcome__art-copy">
          <span className="lf-desktop-welcome__eyebrow">MADE FOR MAKERS</span>
          <p>
            From first sketch
            <br />
            to finished piece.
          </p>
          <span>One workspace for your laser and CNC.</span>
        </div>
      </aside>
      <section className="lf-desktop-welcome__content">
        <button
          className="lf-desktop-welcome__close"
          type="button"
          onClick={onClose}
          aria-label="Close and continue with Free"
          title="Close this window and continue using the Free browser workspace"
        >
          ×
        </button>
        <span className="lf-desktop-welcome__eyebrow">YOUR NEXT PROJECT STARTS HERE</span>
        <h2>Choose your workspace.</h2>
        <p className="lf-desktop-welcome__intro">
          Create in your browser, or make room for more with the desktop app.
        </p>
        <DesktopDownloadCard
          download={download}
          onClose={onClose}
          retry={() => setAttempt((value) => value + 1)}
        />
        <section className="lf-desktop-welcome__free" aria-label="Browser Free edition">
          <div>
            <h3>Keep creating in your browser</h3>
            <span>Drawing, basic tracing, laser &amp; 2D CNC tools.</span>
          </div>
          <button
            type="button"
            className="lf-desktop-welcome__continue"
            onClick={onClose}
            title="Continue using Free browser tools without an account or installation"
          >
            Continue with Free <span aria-hidden="true">→</span>
          </button>
          <p>No account. No time limit. No installation.</p>
        </section>
        <p className="lf-desktop-welcome__footnote">
          You can get the desktop app later from the Free / Pro button.
        </p>
      </section>
    </Dialog>
  );
}

type DesktopDownloadCardProps = {
  readonly download: DownloadState;
  readonly onClose: () => void;
  readonly retry: () => void;
};

function DesktopDownloadCard({ download, onClose, retry }: DesktopDownloadCardProps): JSX.Element {
  return (
    <section className="lf-desktop-welcome__desktop" aria-label="Windows desktop edition">
      <div className="lf-desktop-welcome__card-title">
        <span className="lf-desktop-welcome__monitor" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="13" rx="2" />
            <path d="M8 21h8M12 16v5" />
          </svg>
        </span>
        <div>
          <h3>KerfDesk for Windows</h3>
          <span>Free workspace. More possibilities with Pro.</span>
        </div>
      </div>
      <ul className="lf-desktop-welcome__features" aria-label="Desktop Pro highlights">
        <li>V-carve &amp; 3D relief</li>
        <li>Advanced tracing</li>
        <li>Camera alignment</li>
        <li>Box generator &amp; more</li>
      </ul>
      <p className="lf-desktop-welcome__licence">Pro tools unlock with a desktop licence.</p>
      {download.status === 'ready' ? (
        <a
          className="lf-desktop-welcome__download"
          href={download.url}
          download={download.fileName}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          title="Download the Windows app, which starts in Free until you unlock Pro"
        >
          <DownloadIcon /> Download for Windows <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <button
          className="lf-desktop-welcome__download"
          type="button"
          disabled
          title="A desktop download becomes available after its release metadata is verified"
        >
          <DownloadIcon />
          {download.status === 'loading'
            ? 'Checking download…'
            : download.status === 'unavailable'
              ? 'Download coming soon'
              : 'Download unavailable'}
        </button>
      )}
      <div className="lf-desktop-welcome__availability" role="status" aria-live="polite">
        {download.status === 'ready' ? (
          <>
            Windows 10 / 11 · 64-bit · v{download.version}
            {download.codeSigning === 'unsigned' ? (
              <p>
                Unsigned installer · Updates need your approval. Windows may show an unknown
                publisher warning.
              </p>
            ) : null}
          </>
        ) : download.status === 'unavailable' ? (
          <>No public desktop build yet. Start in Free today.</>
        ) : download.status === 'error' ? (
          <>
            We couldn’t check the download.{' '}
            <button
              type="button"
              onClick={retry}
              title="Check again for a verified Windows download"
            >
              Try again
            </button>
          </>
        ) : (
          <>Windows 10 / 11 · 64-bit</>
        )}
      </div>
    </section>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </svg>
  );
}
