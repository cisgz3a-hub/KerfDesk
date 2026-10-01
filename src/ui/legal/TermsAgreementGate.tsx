// Holds KerfDesk back until the user agrees to the terms and to machine safety
// on first use (ADR-564). Nothing of the app mounts before that answer, so no
// project, machine connection, licence check or other prompt starts first. It
// is asked once per browser or computer, only at opening, and never while a job
// runs, because nothing can run before the app has opened.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { installDesktopCloseReceiver } from '../app/desktop-close-runtime';
import { browserLocalStorage } from '../state/browser-local-storage';
import {
  CURRENT_TERMS,
  readTermsAgreement,
  recordEarlierTermsKept,
  recordTermsAgreement,
  termsAgreementStep,
} from './terms-agreement';
import { ChangedTermsDialog, FirstUseAgreementDialog } from './TermsAgreementDialog';

export function TermsAgreementGate({ children }: { readonly children: ReactNode }): JSX.Element {
  const [step, setStep] = useState(() =>
    termsAgreementStep(readTermsAgreement(browserLocalStorage()), navigator),
  );
  const agree = useCallback(() => {
    recordTermsAgreement(browserLocalStorage(), CURRENT_TERMS.version);
    setStep('none');
  }, []);
  const keepEarlier = useCallback(() => {
    const storage = browserLocalStorage();
    const record = readTermsAgreement(storage);
    if (record !== null) recordEarlierTermsKept(storage, record, CURRENT_TERMS.version);
    setStep('none');
  }, []);
  if (step === 'first') return <HeldForAgreement onAgree={agree} />;
  return (
    <>
      {children}
      {step === 'changed' ? (
        <ChangedTermsDialog terms={CURRENT_TERMS} onAgree={agree} onKeep={keepEarlier} />
      ) : null}
    </>
  );
}

// While the app is held back, the gate answers the desktop window's close
// request itself: nothing can be running or unsaved yet, so KerfDesk closes
// without warning that its controls are unavailable.
function HeldForAgreement({ onAgree }: { readonly onAgree: () => void }): JSX.Element {
  useEffect(() => installDesktopCloseReceiver(window), []);
  return <FirstUseAgreementDialog terms={CURRENT_TERMS} onAgree={onAgree} />;
}
