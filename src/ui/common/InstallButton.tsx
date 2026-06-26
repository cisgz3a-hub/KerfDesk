// Install button (ADR-060). Captures Chromium's deferred install prompt
// (beforeinstallprompt) and exposes an explicit "Install app" button so
// installing feels deliberate rather than relying on the address-bar icon.
// Hidden until the browser offers a prompt, and again once installed or when
// the prompt isn't available (already installed / unsupported browser).

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
};

export function InstallButton(): JSX.Element | null {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event): void => {
      // Stop Chromium's mini-infobar; we drive installation from the button.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setDeferredPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (deferredPrompt === null) return null;
  return (
    <button
      type="button"
      className="lf-btn"
      title="Install LaserForge as an app that launches from your taskbar and runs offline"
      onClick={() => {
        void deferredPrompt.prompt();
        setDeferredPrompt(null);
      }}
    >
      Install app
    </button>
  );
}
