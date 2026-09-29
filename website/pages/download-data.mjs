// Copy for the download page that is long enough to crowd download.mjs. Every
// sentence traces to public/download.html, WORKFLOW.md F-DESK1/F-DESK2,
// PROJECT.md "Delivery targets", ADR-060, ADR-248, ADR-249 and (for the
// real-machine answer) ADR-322 and the README status table on origin/main.

import { statusPill } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';

// Asset names come from electron-builder.preview.yml (artifactName) and
// public/download.html; `<version>` is the prerelease tag without its leading v.
export const DESKTOP_FILES = [
  {
    computer: 'Windows PC',
    needs: 'Windows 10 or 11, 64-bit (x64)',
    file: 'KerfDesk-<version>-windows-x64-setup.exe',
  },
  {
    computer: 'Mac with Intel',
    needs: 'macOS 12 or newer, Intel (x64)',
    file: 'KerfDesk-<version>-macos-x64.dmg',
  },
  {
    computer: 'Mac with Apple Silicon',
    needs: 'macOS 12 or newer, Apple Silicon (arm64)',
    file: 'KerfDesk-<version>-macos-arm64.dmg',
  },
];

// Companion files named in WORKFLOW.md F-DESK1 step 2.
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
  'No account, sign-in or license key',
  'Opens straight to the workspace',
  'Your projects are saved as files on your own computer',
  'No analytics, error reporting or cloud sync',
];

export const UPDATE_ITEMS = [
  {
    icon: 'globe',
    title: 'Web app',
    body: 'The newest version that passes KerfDesk’s automated checks is published at kerfdesk.com automatically. The app never reloads itself. When an update is ready, an Update button appears in the status bar. The new version loads when you click it, or the next time you open KerfDesk after closing all its tabs and windows. The button stays available during a job, so update while your machine is idle.',
  },
  {
    icon: 'monitor-down',
    title: 'Desktop Preview',
    body: 'A new Preview comes out only when a new Preview version is tagged, not with every web app update. When one exists, a small Download update link appears in the status bar. It opens that version’s page on GitHub in your browser. KerfDesk never downloads or installs an update on its own. Finish any machine work, close KerfDesk, then install the new version yourself.',
  },
];

export function downloadFaq(site) {
  return [
    {
      id: 'what-preview-means',
      question: 'What does “Preview” mean?',
      answer:
        'Previews are early, non-production desktop builds. They are free to download and use, but testing on real Windows and Mac computers isn’t finished yet. Passing builds and automated tests show the package is intact. Installing, file access, USB access and machine behavior still need testing on real computers. There is no signed, stable desktop release yet.',
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
      question: 'Do I need an account or a license key?',
      answer:
        'No. There is no account, sign-in, activation or license key. KerfDesk opens straight to the workspace.',
    },
    {
      id: 'cost',
      question: 'Does it cost anything?',
      answer: html`<p>
        Not today. KerfDesk is free to use, with no account, trial timer or subscription. Paid
        licenses are planned for the future, but prices, terms and timing aren’t set, and nothing is
        for sale today. See <a href="/pricing/">pricing</a>.
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
        Open an issue on <a href="${site.issuesUrl}">GitHub</a>. If you find a security problem,
        <a href="${site.securityReportUrl}">report it privately</a> instead, and please don’t post
        exploit details in a public issue.
      </p>`,
    },
  ];
}
