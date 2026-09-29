// Site-wide facts shared by every page. Keep URLs here, not in page copy, so a
// move (for example the app leaving the apex domain) is a one-line change.

const REPO_URL = 'https://github.com/cisgz3a-hub/KerfDesk';

export const site = {
  name: 'KerfDesk',
  tagline: 'Laser & CNC software',
  description:
    'KerfDesk is laser and CNC software for GRBL machines, free to use today. Design, assign operations, preview the toolpath and send the job from your browser or a desktop app.',
  // The KerfDesk web app. It lives at the apex domain today; the website must
  // not take that origin over, because installed PWAs, browser file and serial
  // permissions and the desktop camera bridge's trusted origin are all tied to it.
  appUrl: 'https://kerfdesk.com',
  // Functional GitHub links only (downloads, bug and security reports, the
  // License page). Don't link the source repository as a selling point.
  repoUrl: REPO_URL,
  releasesUrl: `${REPO_URL}/releases`,
  issuesUrl: `${REPO_URL}/issues`,
  securityReportUrl: `${REPO_URL}/security/advisories/new`,
  licenseUrl: `${REPO_URL}/blob/main/LICENSE`,
  noticesUrl: `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`,
  safetyGuideUrl: `${REPO_URL}/blob/main/docs/safety.md`,
  connectionGuideUrl: `${REPO_URL}/blob/main/docs/connection-troubleshooting.md`,
  studio: 'Ons Houtkombuis',
};

// Primary navigation, in order. `key` matches each page's `nav` field.
export const primaryNav = [
  { key: 'features', label: 'Features', href: '/features/' },
  { key: 'machines', label: 'Machines', href: '/machines/' },
  { key: 'docs', label: 'Get started', href: '/docs/' },
  { key: 'pricing', label: 'Pricing', href: '/pricing/' },
  { key: 'faq', label: 'FAQ', href: '/faq/' },
];

export const footerNav = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '/features/' },
      { label: 'Laser', href: '/laser/' },
      { label: 'CNC', href: '/cnc/' },
      { label: 'Machines', href: '/machines/' },
      { label: 'Download', href: '/download/' },
      { label: 'Pricing', href: '/pricing/' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { label: 'Get started', href: '/docs/' },
      { label: 'Safety', href: '/safety/' },
      { label: 'FAQ', href: '/faq/' },
      { label: 'Report a problem', href: `${REPO_URL}/issues` },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'About', href: '/about/' },
      { label: 'Privacy', href: '/privacy/' },
      { label: 'License', href: '/license/' },
    ],
  },
];
