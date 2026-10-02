// Site-wide facts shared by every page. Keep URLs here, not in page copy, so a
// move (for example the app leaving the apex domain) is a one-line change.
//
// No page links to GitHub. The source repository is private, so a visitor can't
// open it (ADR-524 Amendment 1). Desktop downloads go through the KerfDesk
// download page, and help and problem reports go through the support page.

const APP_URL = 'https://kerfdesk.com';
const SUPPORT_URL = `${APP_URL}/support.html`;

export const site = {
  name: 'KerfDesk',
  tagline: 'Laser & CNC software',
  description:
    'KerfDesk is laser and CNC software for GRBL machines, in a Free and a Pro edition. Design, assign operations, preview the toolpath and send the job from your browser or a desktop app.',
  // The KerfDesk web app. It lives at the apex domain today; the website must
  // not take that origin over, because installed PWAs, browser file and serial
  // permissions and the desktop camera bridge's trusted origin are all tied to it.
  appUrl: APP_URL,
  // The app's own download page (public/download.html). It checks the publisher
  // signature on the release metadata before it shows a link, and every installer
  // it links is served from downloadHost. This site has no scripts, so it can't
  // run that check or find the newest version itself: its desktop buttons open
  // that page instead of naming a version or linking an installer directly.
  downloadPageUrl: `${APP_URL}/download.html`,
  // The app's canvas-free phone pairing guide, shipped alongside buy/download.
  phoneSetupUrl: `${APP_URL}/phone.html`,
  downloadHost: 'dl.kerfdesk.com',
  // Help > Get Help and Help > Report a Problem in the app open this page. It
  // names the current contact route, including the support email address.
  supportUrl: SUPPORT_URL,
  // Cloudflare Email Routing forwards it to the owner (live 29 September 2026).
  supportEmail: 'support@kerfdesk.com',
  reportUrl: `${SUPPORT_URL}#report`,
  // The full third-party notices file that ships with the app.
  noticesUrl: `${APP_URL}/third-party-notices.txt`,
  // The licensing service the app uses for Pro trials and activation.
  licensingHost: 'license.kerfdesk.com',
  studio: 'Ons Houtkombuis',
};

// Primary navigation, in order. `key` matches each page's `nav` field.
export const primaryNav = [
  { key: 'features', label: 'Features', href: '/features/' },
  { key: 'machines', label: 'Machines', href: '/machines/' },
  { key: 'docs', label: 'Get started', href: '/docs/' },
  { key: 'phone', label: 'Phone & MCP', href: '/phone/' },
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
      { label: 'Phone & MCP', href: '/phone/' },
      { label: 'Safety', href: '/safety/' },
      { label: 'FAQ', href: '/faq/' },
      { label: 'Support', href: SUPPORT_URL },
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
