// Copy for the download page that is long enough to crowd download.mjs. Every
// sentence traces to public/download.html and public/desktop-downloads.mjs (the
// download page itself), docs/desktop-preview-distribution.md, ADR-523,
// ADR-483 Amendment 1 (the Mac Preview needs macOS 13), WORKFLOW.md
// F-DESK1/F-DESK2, PROJECT.md "Delivery targets", ADR-060 and (for the
// real-machine answer) ADR-322 and the README status table on main. Editions
// and prices come from commerce.config.mjs (ADR-524 Amendment 1).

import { statusPill } from '../lib/components.mjs';
import { formatPrice } from '../lib/commerce.mjs';
import { html } from '../lib/html.mjs';

// Installer names from public/desktop-release-manifest.mjs; `<version>` is the
// release tag without its leading v.
export const DESKTOP_FILES = [
  {
    computer: 'Windows PC',
    needs: 'Windows 10 or 11, 64-bit (x64)',
    file: 'KerfDesk-<version>-windows-x64-setup.exe',
  },
  {
    computer: 'Mac with Intel',
    needs: 'macOS 13 or newer, Intel (x64)',
    file: 'KerfDesk-<version>-macos-x64.dmg',
  },
  {
    computer: 'Mac with Apple Silicon',
    needs: 'macOS 13 or newer, Apple Silicon (arm64)',
    file: 'KerfDesk-<version>-macos-arm64.dmg',
  },
];

// The companion files each Preview publishes beside its installers.
export const COMPANION_FILES = [
  {
    file: 'KerfDesk-<version>-SHA256SUMS.txt',
    body: 'SHA-256 checksums for the downloads',
  },
  {
    file: 'KerfDesk-<version>-release-manifest.json',
    body: 'a release manifest that records the exact source commit',
  },
  {
    file: 'KerfDesk-<version>-sbom.cdx.json',
    body: 'a software bill of materials (SBOM) listing what the build contains',
  },
];

export const WEB_APP_POINTS = [
  'Open it and start working',
  'Install it from your browser to open it in its own window',
  'Keeps working offline after your first visit',
  'New versions reach it first',
];

export const SAME_APP_POINTS = [
  'KerfDesk Free, with no time limit',
  'No account or sign-in',
  'Your projects are saved as files on your own computer',
  'No analytics, error reporting or cloud sync',
];

export function updateItems(site) {
  return [
    {
      icon: 'globe',
      title: 'Web app',
      body: 'The newest version that passes KerfDesk’s automated checks is published at kerfdesk.com automatically. The app never reloads itself. When an update is ready, an Update button appears in the status bar. The new version loads when you click it, or the next time you open KerfDesk after closing all its tabs and windows. The button stays available during a job, so update while your machine is idle.',
    },
    {
      icon: 'monitor-down',
      title: 'Desktop Preview',
      body: html`A new Preview comes out only when a new Preview version is tagged, not with every
        web app update. When one exists, a small Download update link appears in the status bar. It
        opens the <a href="${site.downloadPageUrl}">download page</a> for that version in your
        browser. KerfDesk never downloads or installs a Preview on its own. Finish any machine work,
        close KerfDesk, then install the new version yourself.`,
    },
    {
      icon: 'refresh-cw',
      title: 'Signed Windows edition',
      body: 'Once it’s released, it checks for updates inside the app and installs only versions your license’s updates cover. An update installs after you quit KerfDesk yourself, never during a job, and it never forces a restart.',
    },
  ];
}

export function downloadFaq(site, commerce) {
  const [plan] = commerce.plans;
  return [
    {
      id: 'what-preview-means',
      question: 'What does “Preview” mean?',
      answer:
        'Previews are early, non-production desktop builds. They are free to download, but testing on real Windows and Mac computers isn’t finished yet. Passing builds and automated tests show the package is intact. Installing, file access, USB access and machine behavior still need testing on real computers. Previews are unsigned, and Mac Previews aren’t notarized by Apple.',
    },
    {
      id: 'browsers',
      question: 'Which browsers can run the web app?',
      answer:
        'Chrome, Edge, Brave or Arc. KerfDesk uses the browser’s file access and Web Serial features, which only Chromium-based browsers have. Firefox and Safari can’t open or save project files, and they can’t connect to a machine. In some versions of Brave, you may need to switch on Web Serial in Shields or flags first.',
    },
    {
      id: 'install-web-app',
      question: 'How do I install the web app?',
      answer:
        'Open KerfDesk in Chrome, Edge, Brave or Arc. When your browser offers to install it, an Install app button appears in the KerfDesk toolbar. The installed app opens in its own window and works offline.',
    },
    {
      id: 'offline',
      question: 'Does KerfDesk work offline?',
      answer:
        'Yes, once the web app has loaded online one time. After that, design, preview and machine control run on your computer with no internet connection. Optional lesson pictures are saved only after you view them online, so ones you haven’t opened yet may not show offline. Driving a machine over USB with the network switched off is confirmed in software but hasn’t been tested on hardware yet.',
    },
    {
      id: 'account',
      question: 'Do I need an account?',
      answer: html`<p>
        No. There’s no sign-up or sign-in, and KerfDesk Free needs nothing else.
        ${plan &&
        html`${plan.name} is unlocked with a license, and each device can try ${plan.name} free for
        ${plan.trialDays} days first, with no card
        needed${commerce.trialOpen ? '' : ', once the desktop app is released'}.`}
      </p>`,
    },
    {
      id: 'cost',
      question: 'Does it cost anything?',
      answer: html`<p>
        KerfDesk Free costs nothing and has no time limit.
        ${plan &&
        html`${plan.name} costs ${formatPrice(plan.price, commerce.currency)} plus tax, paid once,
        with a year of updates.`}
        Purchase isn’t open yet. See <a href="${site.pricingUrl}">pricing</a>.
      </p>`,
    },
    {
      id: 'real-machine',
      question: 'Has KerfDesk been used on a real machine?',
      answer: html`<p>
          Yes, informally. KerfDesk has been used to run jobs on a Creality Falcon A1 Pro with
          GRBL-family firmware. Those runs weren’t a repeatable qualification, and they don’t prove
          the quality of finished work. ${statusPill('hardware-verified')}
        </p>
        <p>
          Image engraving and the CNC tools are covered by code and automated tests only. Neither
          has had a recorded test on a real machine. ${statusPill('shipped-code-and-tests')}
        </p>
        <p><a href="/machines/">See what has and hasn’t been tested</a>.</p>`,
    },
    {
      id: 'report-problem',
      question: 'Where do I report a problem?',
      answer: html`<p>
        Email <a href="mailto:${site.supportEmail}">${site.supportEmail}</a>. The
        <a href="${site.reportUrl}">KerfDesk support page</a> lists what to include in a report. If
        you find a security problem, please don’t post the details anywhere public.
      </p>`,
    },
  ];
}
