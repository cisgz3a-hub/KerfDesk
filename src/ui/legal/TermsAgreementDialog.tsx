// The two questions of the first-use agreement (ADR-564). The first time
// KerfDesk opens, it shows the terms' machine-safety section in full and asks
// for two separate ticks, one for the terms and one for machine safety (terms
// 1.3 and 2.5). A later version that reduces users' rights is offered once,
// and declining it keeps the earlier terms (24.3).

import { Fragment, useState } from 'react';
import { PRIVACY_URL, TERMS_URL } from '../common/site-page-urls';
import { Button, Dialog, DialogActions } from '../kit';
import type { PublishedTerms } from './terms-agreement';
import { TERMS_SAFETY_HEADING, TERMS_SAFETY_SECTION, type TermsText } from './terms-text.generated';

export function FirstUseAgreementDialog({
  terms,
  onAgree,
}: {
  readonly terms: PublishedTerms;
  readonly onAgree: () => void;
}): JSX.Element {
  const [termsTicked, setTermsTicked] = useState(false);
  const [safetyTicked, setSafetyTicked] = useState(false);
  return (
    <Dialog size="lg" title="Before you use KerfDesk" onClose={stayOpen} initialFocus="surface">
      <div data-terms-agreement="first" style={bodyStyle}>
        <p style={paragraphStyle}>
          KerfDesk is made by Johannes Stephanus Stolk, trading as KerfDesk. Please read the{' '}
          <ExternalLink href={TERMS_URL}>Terms of Service</ExternalLink> (version {terms.version}
          {terms.lastUpdated === null ? '' : `, ${terms.lastUpdated}`}) and their machine-safety
          section below. The <ExternalLink href={PRIVACY_URL}>Privacy Notice</ExternalLink> explains
          how we handle personal information.
        </p>
        <section aria-labelledby="terms-safety-heading" tabIndex={0} style={safetyBoxStyle}>
          <h3 id="terms-safety-heading" style={safetyHeadingStyle}>
            {TERMS_SAFETY_HEADING}
          </h3>
          {TERMS_SAFETY_SECTION.map((block, index) =>
            block.kind === 'paragraph' ? (
              <p key={index} style={safetyParagraphStyle}>
                <TermsTextView text={block.text} />
              </p>
            ) : (
              <ul key={index} style={safetyListStyle}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <TermsTextView text={item} />
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
        <label style={checkStyle}>
          <input
            type="checkbox"
            checked={termsTicked}
            onChange={(event) => setTermsTicked(event.target.checked)}
          />
          <span>
            I have read and agree to the Terms of Service, and I have read the Privacy Notice.
          </span>
        </label>
        <label style={checkStyle}>
          <input
            type="checkbox"
            checked={safetyTicked}
            onChange={(event) => setSafetyTicked(event.target.checked)}
          />
          <span>
            I have read the machine-safety section of the terms (section 2), understand the risks,
            and will operate my machine safely.
          </span>
        </label>
        <p style={mutedStyle}>If you do not agree, close KerfDesk and do not use it.</p>
        <DialogActions>
          <Button variant="primary" disabled={!termsTicked || !safetyTicked} onClick={onAgree}>
            Agree and continue
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

export function ChangedTermsDialog({
  terms,
  onAgree,
  onKeep,
}: {
  readonly terms: PublishedTerms;
  readonly onAgree: () => void;
  readonly onKeep: () => void;
}): JSX.Element {
  return (
    <Dialog size="md" title="Our terms have changed" onClose={onKeep} initialFocus="surface">
      <div data-terms-agreement="changed" style={bodyStyle}>
        <p style={paragraphStyle}>
          Version {terms.version} of the Terms of Service
          {terms.lastUpdated === null ? '' : `, published ${terms.lastUpdated},`} reduces some of
          your rights, so it applies to you only once you agree to it (section 24.3). If you do not
          agree, the terms you agreed to before keep applying to you.
        </p>
        <p style={paragraphStyle}>
          <ExternalLink href={TERMS_URL}>Read the new terms</ExternalLink>
        </p>
        <DialogActions>
          <Button variant="primary" onClick={onAgree}>
            I agree to the new terms
          </Button>
          <Button onClick={onKeep}>Keep my earlier terms</Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

// The first-use question has no Close: Escape does nothing.
const stayOpen = (): void => undefined;

function ExternalLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function TermsTextView({ text }: { readonly text: ReadonlyArray<TermsText> }): JSX.Element {
  return (
    <>
      {text.map((part, index) => {
        if (typeof part === 'string') return <Fragment key={index}>{part}</Fragment>;
        if ('strong' in part) return <strong key={index}>{part.strong}</strong>;
        return (
          <ExternalLink key={index} href={part.link}>
            {part.link}
          </ExternalLink>
        );
      })}
    </>
  );
}

const bodyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const paragraphStyle: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5 };
const safetyBoxStyle: React.CSSProperties = {
  maxHeight: '38vh',
  overflowY: 'auto',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
  background: 'var(--lf-bg-0)',
  padding: '8px 12px',
  fontSize: 12,
  lineHeight: 1.5,
};
const safetyHeadingStyle: React.CSSProperties = { margin: '0 0 6px', fontSize: 13 };
const safetyParagraphStyle: React.CSSProperties = { margin: '0 0 8px' };
const safetyListStyle: React.CSSProperties = { margin: '0 0 8px', paddingLeft: 20 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  fontSize: 13,
  lineHeight: 1.4,
};
const mutedStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
