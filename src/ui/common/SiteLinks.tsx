// The status bar's links to the pricing and policy pages (ADR-524 Amendment 3),
// so a visitor who lands on the web app finds them without opening a menu. The
// desktop app lists them under Help instead, so it shows none. status-bar.css
// hides them on a narrow bar, where the Update action needs the room.

import { usePlatformOptional } from '../app/platform-context';
import { PRICING_URL, PRIVACY_URL, REFUNDS_URL, TERMS_URL } from './site-page-urls';

const LINKS = [
  { href: PRICING_URL, label: 'Pricing' },
  { href: TERMS_URL, label: 'Terms' },
  { href: PRIVACY_URL, label: 'Privacy' },
  { href: REFUNDS_URL, label: 'Refunds' },
] as const;

export function SiteLinks(): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform?.id === 'electron') return null;
  return (
    <nav className="lf-status-bar__site-links" aria-label="KerfDesk pricing and policies">
      {LINKS.map(({ href, label }) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ))}
    </nav>
  );
}
